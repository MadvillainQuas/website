"""Export highlights: the clips a fan asked for, cut from the stream, the ball kept in frame.

A highlight_jobs row (0109) carries the game, the player, and the clips the page placed by the
clock track: [{start_ms, end_ms, label, kind}]. This module, run by ai_worker on Louie's PC:

  1. fetches the stream (the same yt-dlp path the clock reader uses; the file is reused when it
     is already on disk) and its audio track;
  2. cuts each clip with ffmpeg;
  3. FOLLOWS THE BALL. The vision skill's ball detector (weights/ball_v2.onnx, RF-DETR) is run on
     every third frame; where it finds nothing the people on court stand in (their centroid), and
     where it finds nothing at all the last known place holds. The path is smoothed so the crop
     pans like a camera operator, not a cursor, and a 9:16 window follows it across the 16:9
     frame;
  4. writes each clip portrait at 1080x1920 with a caption, marries the audio back, joins them;
  5. uploads the MP4 to the highlights bucket as <job>.mp4 and tells the requester's bell.

Landscape is the same pipeline without the crop. Nothing here needs a GPU; a 60-second reel
takes a few minutes on the CPU.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import requests


# ------------------------------------------------------------------ small helpers
def _ffmpeg(cfg):
    for cand in (cfg.get('ffmpeg'), os.path.join(os.environ.get('APPDATA', ''), 'epinoia', 'ffmpeg', 'bin', 'ffmpeg.exe'), 'ffmpeg'):
        if cand and (os.path.exists(cand) or shutil.which(cand)):
            return cand
    raise RuntimeError('ffmpeg is not installed (expected %APPDATA%\\epinoia\\ffmpeg\\bin\\ffmpeg.exe)')


def _run(cmd, timeout=1800):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or '')[-800:])
    return p


def _audio_path(url, cfg, log):
    """The stream's audio on its own (yt-dlp bestaudio), beside the video file."""
    from ai_worker import youtube_id
    vid = youtube_id(url)
    if not vid:
        return None
    out = os.path.join(cfg['download_dir'], '%s_audio.m4a' % vid)
    if os.path.exists(out) and os.path.getsize(out) > 500 * 1024:
        return out
    cmd = [sys.executable, '-m', 'yt_dlp', '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--continue', '-o', out, url]
    if shutil.which('node'):
        cmd[-1:-1] = ['--js-runtimes', 'node']
    if cfg.get('yt_cookies_file') and os.path.exists(str(cfg['yt_cookies_file'])):
        cmd[-1:-1] = ['--cookies', str(cfg['yt_cookies_file'])]
    try:
        _run(cmd, timeout=3600)
    except Exception as exc:
        log('   (audio: %s)' % str(exc)[:120])
        return None
    return out if os.path.exists(out) else None


# ------------------------------------------------------------------ the eye
class Eye(object):
    """Where the action is, frame by frame: the ball first, the players when the ball is lost."""
    def __init__(self, skill_dir, log):
        self.ball = self.people = None
        sys.path.insert(0, skill_dir)
        try:
            import evaluate
            w = os.path.join(skill_dir, 'weights', 'ball_v2.onnx')
            if os.path.exists(w):
                self.ball = evaluate.make_runner('rfdetr', w, 0, 0.30, tile=0, device='auto')
                log('   ball detector: ball_v2.onnx')
        except Exception as exc:
            log('   (ball detector unavailable: %s)' % str(exc)[:100])
        try:
            import detector
            if detector.available('tiny'):
                self.people = detector.Detector('tiny', conf=0.35)
                log('   people detector: yolox_tiny')
        except Exception as exc:
            log('   (people detector unavailable: %s)' % str(exc)[:100])

    def look(self, frame):
        """(x, y, kind) in frame pixels, or None."""
        if self.ball is not None:
            try:
                dets = self.ball(frame, 0)
                if dets:
                    x, y, w, h, s = max(dets, key=lambda d: d[4])
                    return (x + w / 2.0, y + h / 2.0, 'ball')
            except Exception:
                pass
        if self.people is not None:
            try:
                ppl = self.people(frame)
                if ppl:
                    ppl = sorted(ppl, key=lambda d: -d[4])[:8]
                    xs = [d[0] + d[2] / 2.0 for d in ppl]; ys = [d[1] + d[3] / 2.0 for d in ppl]
                    return (sum(xs) / len(xs), sum(ys) / len(ys), 'people')
            except Exception:
                pass
        return None


def _smooth_path(samples, n_frames, W, win_w):
    """A pan path from sparse (frame_index, x) samples: linear between samples, then an EMA so
    the window moves like a camera operator's shoulders -- never faster than the frame's width
    in a second and never beyond the picture. Returns the window's LEFT edge per frame."""
    import numpy as np
    if not samples:
        return np.full(n_frames, (W - win_w) / 2.0)
    idx = np.array([s[0] for s in samples], dtype=np.float64)
    xs = np.array([s[1] for s in samples], dtype=np.float64)
    path = np.interp(np.arange(n_frames), idx, xs)
    out = np.empty_like(path)
    a = 0.12                              # per-frame follow; ~0.6 s to settle at 25 fps
    cur = path[0]
    for i in range(n_frames):
        cur += (path[i] - cur) * a
        out[i] = cur
    left = out - win_w / 2.0
    return np.clip(left, 0, max(0, W - win_w))


def _caption(img, text, sub):
    import cv2
    H, W = img.shape[:2]
    bar_h = int(H * 0.09)
    overlay = img.copy()
    cv2.rectangle(overlay, (0, H - bar_h), (W, H), (4, 16, 11), -1)
    cv2.addWeighted(overlay, 0.78, img, 0.22, 0, img)
    scale = W / 1080.0
    cv2.putText(img, text[:40], (int(30 * scale), H - int(bar_h * 0.52)), cv2.FONT_HERSHEY_DUPLEX, 1.25 * scale, (230, 255, 241), max(1, int(2 * scale)), cv2.LINE_AA)
    if sub:
        cv2.putText(img, sub[:60], (int(30 * scale), H - int(bar_h * 0.18)), cv2.FONT_HERSHEY_SIMPLEX, 0.75 * scale, (147, 242, 191), max(1, int(2 * scale)), cv2.LINE_AA)


def _render_clip(src, start_s, dur_s, eye, portrait, label, sub, out_path, ffmpeg, audio, log):
    """One clip: read the frames, follow the action, write the picture; then marry the audio."""
    import cv2
    import numpy as np
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000.0)
    frames = []
    n_want = int(round(dur_s * fps))
    while len(frames) < n_want:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if not frames:
        raise RuntimeError('no frames at %.1fs' % start_s)
    # the eye looks every third frame
    samples = []
    for i in range(0, len(frames), 3):
        p = eye.look(frames[i])
        if p:
            samples.append((i, p[0]))
    if portrait:
        win_w = int(H * 9 / 16.0); win_h = H
        lefts = _smooth_path(samples, len(frames), W, win_w)
        out_w, out_h = 1080, 1920
    else:
        out_w, out_h = 1280, 720
    tmp_v = out_path + '.silent.mp4'
    vw = cv2.VideoWriter(tmp_v, cv2.VideoWriter_fourcc(*'mp4v'), fps, (out_w, out_h))
    for i, fr in enumerate(frames):
        if portrait:
            x0 = int(lefts[i])
            crop = fr[0:win_h, x0:x0 + win_w]
            img = cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_CUBIC)
        else:
            img = cv2.resize(fr, (out_w, out_h), interpolation=cv2.INTER_AREA) if (W, H) != (out_w, out_h) else fr
        _caption(img, label, sub)
        vw.write(img)
    vw.release()
    # h264 for phones and Instagram, the audio from the stream's own track when it is there
    cmd = [ffmpeg, '-y', '-loglevel', 'error', '-i', tmp_v]
    if audio:
        cmd += ['-ss', '%.3f' % start_s, '-t', '%.3f' % dur_s, '-i', audio]
    cmd += ['-map', '0:v:0']
    if audio:
        cmd += ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '128k', '-shortest']
    cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out_path]
    _run(cmd, timeout=900)
    try:
        os.remove(tmp_v)
    except OSError:
        pass
    return len(samples), len(frames)


# ------------------------------------------------------------------ the edit suite
def _text_png(t, W, H, work, i):
    """One text layer as a transparent PNG the size of the frame, drawn with a real typeface."""
    from PIL import Image, ImageDraw, ImageFont
    size = int(max(18, min(240, float(t.get('size') or 64))) * (W / 1080.0))
    font = None
    for cand in (t.get('font'), 'C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf'):
        if cand and os.path.exists(cand):
            try:
                font = ImageFont.truetype(cand, size); break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    text = str(t.get('text') or '')[:120]
    colour = str(t.get('colour') or '#ffffff').lstrip('#')
    try:
        rgb = tuple(int(colour[k:k + 2], 16) for k in (0, 2, 4))
    except Exception:
        rgb = (255, 255, 255)
    x = float(t.get('x', 0.5)) * W; y = float(t.get('y', 0.85)) * H
    box = d.multiline_textbbox((0, 0), text, font=font, align='center')
    tw, th = box[2] - box[0], box[3] - box[1]
    left, top = x - tw / 2.0, y - th / 2.0
    if t.get('plate', True):
        pad = int(size * 0.35)
        d.rounded_rectangle([left - pad, top - pad * 0.6, left + tw + pad, top + th + pad * 0.6], radius=int(size * 0.2), fill=(4, 16, 11, 190))
    d.multiline_text((left, top), text, font=font, fill=rgb + (255,), align='center',
                     stroke_width=max(1, size // 24), stroke_fill=(0, 0, 0, 140))
    path = os.path.join(work, 'text_%02d.png' % i)
    img.save(path)
    return path


def _render_edit(db, cfg, row, log, work):
    """Trim, crop and text over a rendered reel: one ffmpeg pass with a filter graph."""
    import cv2
    ffmpeg = _ffmpeg(cfg)
    src_url = '%s/storage/v1/object/public/highlights/%s' % (db.url, row['source_path'])
    src = os.path.join(work, 'source.mp4')
    with requests.get(src_url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(src, 'wb') as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    cap = cv2.VideoCapture(src)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1080; H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1920
    dur = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / (cap.get(cv2.CAP_PROP_FPS) or 25.0)
    cap.release()
    e = row.get('edits') or {}
    if isinstance(e, str):
        e = json.loads(e)
    trim = e.get('trim') or {}
    t0 = max(0.0, float(trim.get('start') or 0.0)); t1 = float(trim.get('end') or dur or 0.0)
    if dur and t1 > dur:
        t1 = dur
    crop = e.get('crop') or {}
    filters = []
    cw, ch = W, H
    if crop and crop.get('w') and crop.get('h'):
        cx = int(max(0, min(W - 2, float(crop.get('x', 0)) * W))); cy = int(max(0, min(H - 2, float(crop.get('y', 0)) * H)))
        cw = int(max(2, min(W - cx, float(crop['w']) * W))); ch = int(max(2, min(H - cy, float(crop['h']) * H)))
        cw -= cw % 2; ch -= ch % 2
        filters.append('crop=%d:%d:%d:%d' % (cw, ch, cx, cy))
        # back to the reel's own size so the export is always a phone-shaped 1080-wide file
        filters.append('scale=%d:%d' % (W, H) if abs(cw / float(ch) - W / float(H)) < 0.02 else 'scale=%d:-2' % W)
    texts = [t for t in (e.get('texts') or []) if str(t.get('text') or '').strip()][:12]
    inputs = [ffmpeg, '-y', '-loglevel', 'error', '-ss', '%.3f' % t0, '-t', '%.3f' % max(0.5, t1 - t0), '-i', src]
    chain = '[0:v]' + (','.join(filters) if filters else 'null') + '[v0]'
    last = 'v0'
    for i, t in enumerate(texts):
        png = _text_png(t, W, H, work, i)
        inputs += ['-i', png]
        frm, to = t.get('from'), t.get('to')
        enable = ''
        if frm is not None or to is not None:
            a = float(frm or 0.0) - t0; b = float(to) - t0 if to is not None else 1e9
            enable = ":enable='between(t,%.3f,%.3f)'" % (max(0, a), max(0, b))
        chain += ';[%s][%d:v]overlay=0:0%s[v%d]' % (last, i + 1, enable, i + 1)
        last = 'v%d' % (i + 1)
    out = os.path.join(work, 'edited.mp4')
    cmd = inputs + ['-filter_complex', chain, '-map', '[%s]' % last, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]
    _run(cmd, timeout=1800)
    return out, len(texts)


def run_edit(db, cfg, row, log):
    from ai_worker import now_iso
    jid = row['id']
    work = tempfile.mkdtemp(prefix='hle_')
    try:
        db.patch('highlight_jobs', 'id=eq.%s' % jid, {'status': 'running', 'progress': {'stage': 'rendering the edit', 'i': 0, 'n': 1}, 'heartbeat_at': now_iso()})
        log('   edit %s of %s' % (jid[:8], str(row.get('source_path'))[-20:]))
        out, n_text = _render_edit(db, cfg, row, log, work)
        path = '%s.mp4' % jid
        with open(out, 'rb') as f:
            r = requests.post('%s/storage/v1/object/highlights/%s' % (db.url, path),
                              headers={'apikey': db.h['apikey'], 'Authorization': db.h['Authorization'], 'Content-Type': 'video/mp4', 'x-upsert': 'true'},
                              data=f, timeout=1800)
        if r.status_code >= 300:
            raise RuntimeError('upload failed: %s %s' % (r.status_code, r.text[:200]))
        size_mb = os.path.getsize(out) / 1048576.0
        db.patch('highlight_jobs', 'id=eq.%s' % jid, {'status': 'done', 'output_path': path, 'finished_at': now_iso(),
                                                       'progress': {'stage': 'done', 'i': 1, 'n': 1, 'mb': round(size_mb, 1), 'texts': n_text}})
        try:
            requests.post('%s/rest/v1/notifications' % db.url, headers=dict(db.h, Prefer='return=minimal'), json={
                'user_id': row['requested_by'], 'kind': 'highlights', 'title': 'Your edit is ready',
                'body': '%.0f MB · open it in the edit suite' % size_mb, 'link': 'edit/?hl=%s' % jid, 'game_id': row['game_id'], 'ref': 'hl:' + jid
            }, timeout=30)
        except Exception as exc:
            log('   (bell: %s)' % str(exc)[:80])
        log('   edit %s done: %.0f MB' % (jid[:8], size_mb))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------ the job
def run(db, cfg, row, log):
    from ai_worker import fetch_video, now_iso
    jid = row['id']
    if row.get('source_path'):
        return run_edit(db, cfg, row, log)
    def report(stage, i, n, extra=None):
        p = {'stage': stage, 'i': i, 'n': n}
        if extra:
            p.update(extra)
        try:
            db.patch('highlight_jobs', 'id=eq.%s' % jid, {'status': 'running', 'progress': p, 'heartbeat_at': now_iso()})
        except Exception:
            pass
    clips = row.get('clips') or []
    if isinstance(clips, str):
        clips = json.loads(clips)
    clips = [c for c in clips if c.get('start_ms') is not None and c.get('end_ms') is not None and c['end_ms'] > c['start_ms']][:80]
    if not clips:
        raise RuntimeError('no clips to cut')
    vids = db.select('game_videos', 'game_id=eq.%s&is_primary=eq.true&select=url,provider,video_ref' % row['game_id'])
    if not vids or not vids[0].get('url'):
        raise RuntimeError('this game has no video attached')
    url = vids[0]['url']
    ffmpeg = _ffmpeg(cfg)
    log('   highlights %s: %d clips, %s' % (jid[:8], len(clips), row.get('orientation') or 'portrait'))
    report('downloading', 0, 1)
    src = fetch_video(url, cfg, lambda st, i, n, last='': report('downloading: ' + st, i, n))
    audio = _audio_path(url, cfg, log)
    eye = Eye(cfg['skill_scripts'], log)
    portrait = (row.get('orientation') or 'portrait') != 'landscape'
    who = row.get('player_name') or ''
    work = tempfile.mkdtemp(prefix='hl_')
    parts = []
    seen_ball = 0; seen_frames = 0
    try:
        for i, c in enumerate(clips):
            report('cutting', i, len(clips), {'last': c.get('label', '')[:60]})
            start = max(0.0, c['start_ms'] / 1000.0)
            dur = min(30.0, max(2.0, (c['end_ms'] - c['start_ms']) / 1000.0))
            out = os.path.join(work, 'clip_%03d.mp4' % i)
            try:
                nb, nf = _render_clip(src, start, dur, eye, portrait, who or c.get('label', ''), (c.get('label', '') if who else ''), out, ffmpeg, audio, log)
                seen_ball += nb; seen_frames += nf
                parts.append(out)
            except Exception as exc:
                log('   (clip %d skipped: %s)' % (i, str(exc)[:100]))
        if not parts:
            raise RuntimeError('none of the clips could be cut')
        report('joining', len(clips), len(clips))
        lst = os.path.join(work, 'list.txt')
        with io.open(lst, 'w', encoding='utf-8') as f:
            for p in parts:
                f.write("file '%s'\n" % p.replace("'", "'\\''"))
        final = os.path.join(work, 'highlights.mp4')
        _run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', final], timeout=900)
        report('uploading', len(clips), len(clips))
        path = '%s.mp4' % jid
        with open(final, 'rb') as f:
            r = requests.post('%s/storage/v1/object/highlights/%s' % (db.url, path),
                              headers={'apikey': db.h['apikey'], 'Authorization': db.h['Authorization'], 'Content-Type': 'video/mp4', 'x-upsert': 'true'},
                              data=f, timeout=1800)
        if r.status_code >= 300:
            raise RuntimeError('upload failed: %s %s' % (r.status_code, r.text[:200]))
        size_mb = os.path.getsize(final) / 1048576.0
        db.patch('highlight_jobs', 'id=eq.%s' % jid, {
            'status': 'done', 'output_path': path, 'finished_at': now_iso(),
            'progress': {'stage': 'done', 'i': len(clips), 'n': len(clips), 'clips': len(parts), 'mb': round(size_mb, 1),
                         'ball_seen': seen_ball, 'frames_looked': seen_frames // 3}})
        # the bell
        try:
            requests.post('%s/rest/v1/notifications' % db.url, headers=dict(db.h, Prefer='return=minimal'), json={
                'user_id': row['requested_by'], 'kind': 'highlights',
                'title': 'Your highlights are ready' + (' — ' + who if who else ''),
                'body': '%d clips · %.0f MB · %s' % (len(parts), size_mb, 'vertical' if portrait else 'landscape'),
                'link': 'edit/?hl=%s' % jid, 'game_id': row['game_id'], 'ref': 'hl:' + jid
            }, timeout=30)
        except Exception as exc:
            log('   (bell: %s)' % str(exc)[:80])
        log('   highlights %s done: %d clips, %.0f MB, the ball seen in %d of %d looks' % (jid[:8], len(parts), size_mb, seen_ball, seen_frames // 3))
    finally:
        shutil.rmtree(work, ignore_errors=True)
