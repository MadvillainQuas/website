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
                # TILED, at the size the model was trained on. tile=0 squeezes the whole 1280-wide
                # frame into the 512 input and a 26-pixel ball becomes a smudge the model never
                # scores -- on a real clip that gave 33 detections in 320 looks. A 640 tile keeps
                # the ball at the size it learnt; a 640 crop around the predicted ball is ONE tile.
                self.ball = evaluate.make_runner('rfdetr', w, 0, 0.10, tile=640, device='auto')
                # a 720p broadcast shows a 12-pixel ball; the model learnt ~26. Upscaling by 1.5
                # before looking more than doubled the frames it scored the ball in (probe,
                # Reading v London): 9/24 above 0.2 against 4/24 at native size.
                self.scale = 1.5
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

    def look(self, frame, around=None, people=True):
        import cv2
        """Every ball candidate as (cx, cy, conf) in frame pixels, and where the players are
        (cx, cy) or None. With `around` (x, y) only a 640-square about that point is searched --
        one tile, the cheap case while the ball is being followed; without it the whole frame is
        swept. The choice between candidates is the tracker's, not the detector's: the most
        confident box in one frame is often a head, a spare ball or the scorebug."""
        balls, ppl = [], None
        H, W = frame.shape[:2]
        if self.ball is not None:
            try:
                sc = getattr(self, 'scale', 1.0)
                if around is not None:
                    side = int(640 / sc)                       # one 640 tile after upscaling
                    x0 = int(max(0, min(W - side, around[0] - side / 2.0)))
                    y0 = int(max(0, min(H - side, around[1] - side / 2.0)))
                    crop = frame[y0:y0 + side, x0:x0 + side]
                    if sc != 1.0:
                        crop = cv2.resize(crop, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC)
                    dets = [(x / sc + x0, y / sc + y0, w / sc, h / sc, c) for (x, y, w, h, c) in (self.ball(crop, 0) or [])]
                else:
                    img = frame if sc == 1.0 else cv2.resize(frame, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC)
                    dets = [(x / sc, y / sc, w / sc, h / sc, c) for (x, y, w, h, c) in (self.ball(img, 0) or [])]
                for x, y, w, h, c in dets:
                    if c >= 0.12 and w > 3 and h > 3 and w < W * 0.12 and h < H * 0.2:
                        balls.append((x + w / 2.0, y + h / 2.0, float(c)))
                balls.sort(key=lambda d: -d[2])
                balls = balls[:5]
            except Exception:
                pass
        if people and self.people is not None:
            try:
                pp = self.people(frame)
                if pp:
                    pp = sorted(pp, key=lambda d: -d[4])[:8]
                    xs = [d[0] + d[2] / 2.0 for d in pp]; ys = [d[1] + d[3] / 2.0 for d in pp]
                    ppl = (sum(xs) / len(xs), sum(ys) / len(ys))
            except Exception:
                pass
        return balls, ppl


class _Tracker(object):
    """One ball position per sample, or None where the ball is honestly not seen. A constant-
    velocity guess, a gate that widens while the ball is lost, and a rule that a NEW track must
    be seen twice running before it is believed -- which is what stops a single confident false
    positive dragging the camera across the floor."""
    def __init__(self, W, H, fps, stride):
        self.W, self.H = W, H
        self.gate0 = 0.075 * W * max(1.0, stride / 3.0)
        self.stride = max(1, stride)
        self.x = self.y = None
        self.vx = self.vy = 0.0
        self.last_i = None
        self.lost = 0
        self.pending = None          # a candidate seen once, waiting to be seen again

    def alive(self):
        return self.x is not None

    def predict(self, i):
        if self.x is None:
            return None
        dt = float(i - self.last_i) / self.stride
        return (self.x + self.vx * dt, self.y + self.vy * dt)

    def gate(self):
        return self.gate0 * min(3.5, 1.0 + 0.6 * self.lost)

    def accepts(self, i, balls):
        p = self.predict(i)
        if p is None:
            return False
        g = self.gate()
        return any(((b[0] - p[0]) ** 2 + (b[1] - p[1]) ** 2) ** 0.5 <= g for b in balls)

    def _acquire(self, i, balls):
        """A strong candidate that agrees with one seen at the previous sample."""
        strong = [b for b in balls if b[2] >= 0.30]
        if self.pending is not None:
            for b in strong:
                if ((b[0] - self.pending[0]) ** 2 + (b[1] - self.pending[1]) ** 2) ** 0.5 <= self.gate0 * 1.5:
                    self.x, self.y, self.vx, self.vy = b[0], b[1], 0.0, 0.0
                    self.last_i = i; self.lost = 0; self.pending = None
                    return (i, self.x, self.y)
        self.pending = strong[0] if strong else None
        return None

    def step(self, i, balls):
        if self.x is None:
            return self._acquire(i, balls)
        dt = float(i - self.last_i) / self.stride
        px, py = self.x + self.vx * dt, self.y + self.vy * dt
        g = self.gate()
        best, best_s = None, None
        for b in balls:
            d = ((b[0] - px) ** 2 + (b[1] - py) ** 2) ** 0.5
            if d > g:
                continue
            sc = b[2] - 0.5 * d / g
            if best is None or sc > best_s:
                best, best_s = b, sc
        if best is not None:
            nvx, nvy = (best[0] - self.x) / max(dt, 1e-6), (best[1] - self.y) / max(dt, 1e-6)
            # damped velocity: a shot arc is fast, a bounce reverses; neither should be extrapolated hard
            self.vx, self.vy = 0.5 * self.vx + 0.5 * nvx, 0.5 * self.vy + 0.5 * nvy
            self.x, self.y = best[0], best[1]
            self.last_i = i; self.lost = 0
            return (i, self.x, self.y)
        self.lost += 1
        self.vx *= 0.6; self.vy *= 0.6
        if self.lost >= 5:                       # ~0.25 s at a 3-frame stride on 60 fps: let it go
            self.x = None
            self.pending = None
            return self._acquire(i, balls)
        return None


def _follow(frames, eye, W, H, fps, stride, log=None):
    """Where the ball is through a clip: [(frame_index, x, y)] for the samples it was seen at,
    plus [(frame_index, x)] of the players' centre for the fallback. While the ball is being
    followed the eye looks only around where it should be (one tile); when it is lost, the
    whole frame is swept."""
    tr = _Tracker(W, H, fps, stride)
    samples, people = [], []
    sweeps = 0
    k = 0
    for i in range(0, len(frames), stride):
        k += 1
        around = tr.predict(i)
        if around is None and k % 2:
            # lost: a full sweep costs eight tiles, so it is made at half the cadence
            if k % 4 == 1:
                _, ppl = eye.look(frames[i], None, people=True) if eye.ball is None else (None, None)
                if eye.people is not None and eye.ball is not None:
                    try:
                        pp = eye.people(frames[i])
                        if pp:
                            pp = sorted(pp, key=lambda d: -d[4])[:8]
                            ppl = (sum(d[0] + d[2] / 2.0 for d in pp) / len(pp), sum(d[1] + d[3] / 2.0 for d in pp) / len(pp))
                    except Exception:
                        ppl = None
                if ppl:
                    people.append((i, ppl[0]))
            continue
        balls, ppl = eye.look(frames[i], around, people=(around is None or k % 4 == 0))
        if around is not None and not tr.accepts(i, balls):
            balls, ppl = eye.look(frames[i], None, people=True)
            sweeps += 1
        elif around is None:
            sweeps += 1
        pos = tr.step(i, balls)
        if pos:
            samples.append(pos)
        if ppl:
            people.append((i, ppl[0]))
    # a track that lasted under four looks (~0.2 s) is a head, a shoe or a scorebug digit
    kept, run_ = [], []
    for smp in samples:
        if run_ and smp[0] - run_[-1][0] > stride:
            if len(run_) >= 4:
                kept.extend(run_)
            run_ = []
        run_.append(smp)
    if len(run_) >= 4:
        kept.extend(run_)
    if log:
        log('   followed: %d of %d looks had the ball, %d kept in tracks (%d full sweeps)' % (len(samples), (len(frames) + stride - 1) // stride, len(kept), sweeps))
    return kept, people


def _gauss(a, sigma):
    """Zero-phase Gaussian smoothing with edge reflection: nothing lags, nothing overshoots."""
    import numpy as np
    if sigma <= 0.5 or len(a) < 3:
        return a.copy()
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.pad(a, r, mode='reflect')
    return np.convolve(pad, k, mode='valid')


def _smooth_path(samples, n_frames, W, win_w, fps=25.0, stride=3, people=None):
    """The window's LEFT edge per frame, from sparse ball positions [(frame_index, x)] and,
    where the ball was lost, where the players were.

    The order of operations is the camera operator's: interpolate the target through short
    gaps (long gaps fall back to the players), smooth it with a zero-phase Gaussian so the
    stride's stepping is gone, hold the window still while the ball stays inside a central
    band (a real operator does not chase every dribble), smooth the resulting moves, cap the
    pan speed, and finally nudge the window wherever the ball would have left the frame."""
    import numpy as np
    centre = (W - win_w) / 2.0 + win_w / 2.0
    frames = np.arange(n_frames, dtype=np.float64)
    if not samples and not people:
        return np.full(n_frames, (W - win_w) / 2.0)
    # 1. the target: ball where seen; through gaps under 1.5 s linearly; longer gaps -> players
    tgt = np.full(n_frames, np.nan)
    for i, x in samples:
        if 0 <= i < n_frames:
            tgt[i] = x
    idx = np.where(~np.isnan(tgt))[0]
    if len(idx):
        filled = np.interp(frames, idx, tgt[idx])
        maxgap = int(1.5 * fps)
        for a, b in zip(idx[:-1], idx[1:]):
            if b - a > maxgap:
                filled[a + 1:b] = np.nan
        filled[:idx[0]] = np.nan if idx[0] > maxgap else filled[idx[0]]
        filled[idx[-1] + 1:] = np.nan if n_frames - 1 - idx[-1] > maxgap else filled[idx[-1]]
    else:
        filled = tgt
    if people:
        pp = np.full(n_frames, np.nan)
        for i, x in people:
            if 0 <= i < n_frames:
                pp[i] = x
        pidx = np.where(~np.isnan(pp))[0]
        if len(pidx):
            pfill = np.interp(frames, pidx, pp[pidx])
            hole = np.isnan(filled)
            filled[hole] = pfill[hole]
    if np.isnan(filled).all():
        return np.full(n_frames, (W - win_w) / 2.0)
    # whatever is still unknown holds the nearest known value
    kidx = np.where(~np.isnan(filled))[0]
    filled = np.interp(frames, kidx, filled[kidx])
    # 2. the stepping of a 3-frame stride, and detector jitter, go here
    target = _gauss(filled, 0.30 * fps)
    # 3. the dead band: the window rests while the ball stays within the middle of it
    band = 0.17 * win_w
    cam = np.empty(n_frames)
    cur = float(target[0])
    for i in range(n_frames):
        t = target[i]
        if t > cur + band:
            cur = t - band
        elif t < cur - band:
            cur = t + band
        cam[i] = cur
    # 4. the moves themselves are eased, and never faster than the width of the frame in 1.4 s
    cam = _gauss(cam, 0.28 * fps)
    vmax = W / (1.4 * fps)
    for i in range(1, n_frames):
        d = cam[i] - cam[i - 1]
        if abs(d) > vmax:
            cam[i] = cam[i - 1] + vmax * (1 if d > 0 else -1)
    # 5. the ball must stay in the picture: where the smoothed window would lose it, pull the
    #    window over, then ease that correction too (twice, since easing can reopen a little)
    margin = 0.06 * win_w
    lo = filled - (win_w / 2.0 - margin)
    hi = filled + (win_w / 2.0 - margin)
    for _ in range(2):
        fix = np.clip(cam, lo, hi)
        cam = _gauss(fix, 0.15 * fps)
        for i in range(1, n_frames):
            d = cam[i] - cam[i - 1]
            if abs(d) > vmax:
                cam[i] = cam[i - 1] + vmax * (1 if d > 0 else -1)
    left = cam - win_w / 2.0
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
    # about twelve looks a second whatever the frame rate; the tracker decides which box is the ball
    STRIDE = max(2, int(round(fps / 12.0)))
    track, people = _follow(frames, eye, W, H, fps, STRIDE, log)
    samples = [(t[0], t[1]) for t in track]
    if portrait:
        win_w = int(H * 9 / 16.0); win_h = H
        lefts = _smooth_path(samples, len(frames), W, win_w, fps=fps, stride=STRIDE, people=people)
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
