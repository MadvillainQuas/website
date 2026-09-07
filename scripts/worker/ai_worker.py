#!/usr/bin/env python3
"""ai_worker.py — the muscle behind "AI process game".

An admin presses one button on a game page (or the ingest worker presses it for them when a
game with a stream goes final). That inserts a row in video_jobs. This script, running on a PC
with a normal internet connection and a GPU, claims the row, downloads the stream, reads the
picture — clock, score, or both, whichever it holds (clock.run_auto in the playtype-vision
skill) — writes the readings onto game_videos.clock_track exactly as the page's own "import a
clock track" would, and, while the footage is still on disk, harvests self-labels for the
detectors around every basket the log knows about. The page watches the job row live.

Torch-free: everything here is requests + the skill's ONNX/DirectML readers.

    python ai_worker.py                 # loop: claim, process, repeat (the scheduled task)
    python ai_worker.py --once          # one pass
    python ai_worker.py --dry-run VIDEO --pbp URL_OR_FILE [--start S --end S]
                                        # no database: read a local file the way a job would

Config (%APPDATA%\\epinoia\\worker.json — see worker.example.json beside this file):
    supabase_url, service_key, skill_scripts, download_dir, keep_video, harvest, ...
The service key never leaves this machine; it is what lets the worker claim jobs and write
the track without a signed-in person.
"""
import os, sys, io, re, json, time, socket, argparse, subprocess, traceback, shutil
from datetime import datetime, timezone

for _stream in (sys.stdout, sys.stderr):        # Windows consoles default to cp1252
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'epinoia', 'worker.json')
DEFAULTS = {
    'supabase_url': '',
    'service_key': '',
    'skill_scripts': r'C:\Users\Admin\.claude\skills\playtype-vision\scripts',
    'download_dir': r'D:\Download\bcb_streams',
    'keep_video': False,
    'step_clock': 5.0,
    'step_score': 2.0,
    'poll_s': 20,
    'harvest': True,
    'harvest_windows': 12,      # ~10 min each at 720p on a GTX 1660 SUPER
    'harvest_stride': 3,
    'worker_id': socket.gethostname(),
    'max_height': 720,
    'backfill': True,           # queue every final game with a stream and no track, by itself
    'dashboard_auto': True,     # open the dashboard window whenever a game starts processing
    'backfill_days': 21,        # ...as long as it tipped off this recently
}
VERSION = 'ai_worker/1.0'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def log(msg):
    print('%s  %s' % (datetime.now().strftime('%H:%M:%S'), msg), flush=True)


def load_config(path):
    cfg = dict(DEFAULTS)
    if path and os.path.exists(path):
        with io.open(path, encoding='utf-8') as f:
            cfg.update(json.load(f))
    for k in ('supabase_url', 'service_key'):
        if os.environ.get(k.upper()):
            cfg[k] = os.environ[k.upper()]
    return cfg


# --------------------------------------------------------------------------- database
class DB(object):
    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}

    def rpc(self, fn, body=None):
        r = requests.post('%s/rest/v1/rpc/%s' % (self.url, fn), headers=self.h, json=body or {}, timeout=30)
        r.raise_for_status()
        return r.json() if r.text else None

    def select(self, table, query):
        r = requests.get('%s/rest/v1/%s?%s' % (self.url, table, query), headers=self.h, timeout=30)
        r.raise_for_status()
        return r.json()

    def patch(self, table, query, body):
        r = requests.patch('%s/rest/v1/%s?%s' % (self.url, table, query), headers=dict(self.h, Prefer='return=representation'),
                           json=body, timeout=60)
        r.raise_for_status()
        return r.json() if r.text else None

    def upsert(self, table, rows, on_conflict):
        h = dict(self.h, Prefer='resolution=merge-duplicates,return=minimal')
        r = requests.post('%s/rest/v1/%s?on_conflict=%s' % (self.url, table, on_conflict), headers=h, json=rows, timeout=30)
        r.raise_for_status()
        return True


def heartbeat(db, cfg, job_id=None, note=None):
    try:
        db.upsert('video_workers', {'id': cfg['worker_id'], 'last_seen': now_iso(), 'busy_job': job_id, 'note': note}, 'id')
    except Exception as exc:
        log('(heartbeat failed: %s)' % exc)


# --------------------------------------------------------------------------- the footage
_YT = [re.compile(r'[?&]v=([A-Za-z0-9_-]{11})'), re.compile(r'youtu\.be/([A-Za-z0-9_-]{11})'),
       re.compile(r'/live/([A-Za-z0-9_-]{11})'), re.compile(r'/shorts/([A-Za-z0-9_-]{11})'),
       re.compile(r'/embed/([A-Za-z0-9_-]{11})')]


def youtube_id(url):
    for rx in _YT:
        m = rx.search(url or '')
        if m:
            return m.group(1)
    return None


def fetch_video(url, cfg, progress):
    """The footage on disk: a YouTube stream through yt-dlp (progressive ≤720p, no ffmpeg needed),
    anything else as a straight download. Resumable; an existing complete file is reused."""
    ddir = cfg['download_dir']
    if not os.path.isdir(ddir):
        os.makedirs(ddir)
    vid = youtube_id(url)
    if vid:
        out = os.path.join(ddir, '%s_%d.mp4' % (vid, cfg['max_height']))
        if os.path.exists(out) and os.path.getsize(out) > 5 * 1024 * 1024:
            progress('downloaded', 1, 1, 'already on disk')
            return out
        # VIDEO ONLY. The reader never hears the game, and YouTube's archived streams offer no
        # combined video+audio file at all (only DASH halves) -- asking for one fails, and merging
        # would need ffmpeg. h264 first: it decodes fastest in OpenCV.
        h = cfg['max_height']
        fmt = ('bv*[height<=%d][ext=mp4][vcodec^=avc1]/bv*[height<=%d][ext=mp4]/bv*[height<=%d]/b[height<=%d]/b' % (h, h, h, h))
        base = [sys.executable, '-m', 'yt_dlp'] if _module_ok('yt_dlp') else ['yt-dlp']
        cmd = base + ['-f', fmt, '--no-playlist', '--continue', '--newline', '-o', out, 'https://www.youtube.com/watch?v=' + vid]
        log('yt-dlp ' + vid)
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        last = ''
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            last = line
            m = re.search(r'\[download\]\s+([\d.]+)%', line)
            if m:
                progress('downloading', float(m.group(1)), 100.0, line)
        p.wait()
        if p.returncode != 0 or not os.path.exists(out):
            raise RuntimeError('yt-dlp failed: ' + last[:300])
        return out
    # a direct file
    name = re.sub(r'[^A-Za-z0-9_.-]+', '_', url.split('?')[0].rsplit('/', 1)[-1] or 'video.mp4')
    out = os.path.join(ddir, name)
    if os.path.exists(out) and os.path.getsize(out) > 5 * 1024 * 1024:
        return out
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get('content-length') or 0)
        got = 0
        with open(out + '.part', 'wb') as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                got += len(chunk)
                if total:
                    progress('downloading', got, total, '%d MB' % (got >> 20))
    os.replace(out + '.part', out)
    return out


def _module_ok(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------- the play-by-play
def pbp_for_game(db, game_id):
    """The archived FIBA LiveStats payload (running score per action) this game was fed from."""
    rows = db.select('external_games', 'game_id=eq.%s&adapter=eq.fiba_livestats&select=raw_ref&limit=1' % game_id)
    ref = rows and rows[0].get('raw_ref')
    if not ref:
        return None
    r = requests.get(ref, timeout=60)
    r.raise_for_status()
    return r.json()


def load_pbp(src):
    if not src:
        return None
    if re.match(r'^https?://', src):
        r = requests.get(src, timeout=60)
        r.raise_for_status()
        return r.json()
    with io.open(src, encoding='utf-8') as f:
        return json.load(f)


# --------------------------------------------------------------------------- reading
def skill(cfg):
    sp = cfg['skill_scripts']
    if sp not in sys.path:
        sys.path.insert(0, sp)
    import clock as CK  # noqa
    return CK


def read_track(video_path, pbp, cfg, mode, progress, should_stop):
    CK = skill(cfg)
    def prog(i, n, s):
        what = s.get('text') or (s.get('read') and '%s-%s' % tuple(s['read'])) or s.get('note', '')
        progress('reading:' + s.get('stage', mode), i, n, what, extra={'t': s.get('t'), 'period': s.get('period'),
                 'accepted': bool(s.get('accepted')), 'score': [s.get('home'), s.get('away')] if s.get('home') is not None else None})
    return CK.run_auto(video_path, pbp=pbp, mode=mode, step=cfg['step_clock'], score_step=cfg['step_score'],
                       on_progress=prog, stop=should_stop, quiet=True)


def slim_track(track):
    """What the page stores: the readings and how they were made, not the diagnostics."""
    keep = ('t', 'period', 'clock_ms', 'conf', 'how')
    samples = [{k: s[k] for k in keep if k in s} for s in track.get('samples') or []]
    out = {'format': 'epinoia-clock-track/1', 'source': '%s via %s' % (track.get('source', 'clock.py'), VERSION),
           'mode': track.get('mode'), 'video': track.get('video'), 'samples': samples}
    if track.get('fusion'):
        out['fusion'] = track['fusion']
    if track.get('matched') is not None:
        out['matched'] = track['matched']; out['changes_seen'] = track.get('changes_seen')
    return out


def write_track(db, game_id, track):
    slim = slim_track(track)
    if len(slim['samples']) > 20000:
        raise RuntimeError('track too long (%d readings)' % len(slim['samples']))
    rows = db.patch('game_videos', 'game_id=eq.%s&is_primary=eq.true' % game_id,
                    {'clock_track': slim, 'updated_at': now_iso()})
    if not rows:
        raise RuntimeError('this game has no primary video row to hold the track')
    return slim


# --------------------------------------------------------------------------- learning while the file is here
def video_time_for(track, period, clock_ms):
    """Where in the footage a (period, clock) sits, by interpolating the track within that period."""
    ss = sorted([s for s in track.get('samples') or [] if s.get('period') == period and s.get('clock_ms') is not None], key=lambda s: s['t'])
    if not ss:
        return None
    for a, b in zip(ss, ss[1:]):
        if a['clock_ms'] >= clock_ms >= b['clock_ms']:
            span = a['clock_ms'] - b['clock_ms']
            f = 0.0 if span <= 0 else (a['clock_ms'] - clock_ms) / float(span)
            return a['t'] + f * (b['t'] - a['t'])
    near = min(ss, key=lambda s: abs(s['clock_ms'] - clock_ms))
    if abs(near['clock_ms'] - clock_ms) <= 30000:
        return near['t'] + (near['clock_ms'] - clock_ms) / 1000.0
    return None


def basket_times(track, pbp, CK):
    """Video times of every made basket the log knows, via the track."""
    out = []
    if track.get('mode') == 'score' or not pbp:
        # score mode: the readings ARE the baskets
        return [s['t'] for s in track.get('samples') or [] if s.get('how') == 'score']
    for per, ms, h, a in CK.pbp_score_events(pbp):
        t = video_time_for(track, per, ms)
        if t is not None:
            out.append(t)
    return out


def harvest_around(video_path, times, cfg, progress, should_stop):
    """auto_labels.harvest_window around each basket: the ball on its arc, the rim standing still."""
    sp = cfg['skill_scripts']
    if sp not in sys.path:
        sys.path.insert(0, sp)
    import auto_labels as AL, dataset as DS, frames as FR  # noqa
    import hashlib
    times = sorted(set(round(t) for t in times if t is not None))
    n_max = int(cfg.get('harvest_windows') or 12)
    if len(times) > n_max:
        stride = len(times) / float(n_max)
        times = [times[int(i * stride)] for i in range(n_max)]
    cap = FR.open_video(video_path)
    info = FR.video_info(cap)
    fps = info['fps'] or 30.0
    d = DS.load()
    det = AL.Detectors()
    run_id = 'auto_%s_%s' % (time.strftime('%Y%m%d_%H%M%S'), hashlib.sha1(os.path.abspath(video_path).encode()).hexdigest()[:6])
    logf = io.open(AL.LOG, 'a', encoding='utf-8')
    wlog = lambda rec: (logf.write(json.dumps(dict(rec, run_id=run_id, at=time.time(), via=VERSION)) + '\n'), logf.flush())
    tot = {'frames': 0, 'ball': 0, 'neg': 0, 'rim': 0, 'flights': 0, 'windows': 0}
    for k, t in enumerate(times):
        if should_stop():
            break
        t0, t1 = max(0.0, t - 8.0), t + 2.0          # the shot goes up before the score changes
        r = AL.harvest_window(cap, det, os.path.basename(video_path), t0, t1, int(cfg.get('harvest_stride') or 3), fps, d, run_id, wlog)
        for key in ('frames', 'ball', 'neg', 'rim', 'flights'):
            tot[key] += r.get(key, 0)
        tot['windows'] += 1
        wlog({'window': [t0, t1], **r})
        progress('harvesting', k + 1, len(times), '%d ball, %d rim so far' % (tot['ball'], tot['rim']))
        if tot['windows'] % 5 == 0:
            DS.save(d)
    cap.release()
    DS.save(d)
    logf.close()
    tot['run_id'] = run_id
    return tot


# --------------------------------------------------------------------------- the window, when there is something to watch
DASHBOARD_MUTEX = 'Epinoia.AI.Dashboard'


def dashboard_open():
    """Is a dashboard window already up on this machine? (It holds a named mutex while it runs.)"""
    try:
        import ctypes
        h = ctypes.windll.kernel32.OpenMutexW(0x00100000, False, DASHBOARD_MUTEX)   # SYNCHRONIZE
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return True
    except Exception:
        pass
    return False


def open_dashboard(cfg):
    """Bring up the dashboard as a game starts processing — once; a window already open raises itself."""
    if not cfg.get('dashboard_auto', True) or dashboard_open():
        return
    try:
        exe = sys.executable
        pyw = os.path.join(os.path.dirname(exe), 'pythonw.exe')
        if os.path.exists(pyw):
            exe = pyw
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        subprocess.Popen([exe, os.path.join(HERE, 'ai_dashboard.py')], cwd=HERE, creationflags=flags,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        log('dashboard opened')
    except Exception as exc:
        log('(could not open the dashboard: %s)' % exc)


# --------------------------------------------------------------------------- one job
class Job(object):
    def __init__(self, db, row, cfg):
        self.db, self.row, self.cfg = db, row, cfg
        self.id = row['id']
        self._last_push = 0.0
        self._last_cancel_check = 0.0
        self._cancel = False
        self.progress = {'stage': 'claimed', 'i': 0, 'n': 1, 'accepted': 0}

    def stop(self):
        now = time.time()
        if now - self._last_cancel_check > 15:
            self._last_cancel_check = now
            try:
                rows = self.db.select('video_jobs', 'id=eq.%s&select=cancel_requested,status' % self.id)
                if rows and (rows[0].get('cancel_requested') or rows[0].get('status') == 'cancelled'):
                    self._cancel = True
            except Exception:
                pass
        return self._cancel

    def report(self, stage, i, n, last='', extra=None):
        p = self.progress
        p['stage'], p['i'], p['n'], p['last'] = stage, i, n, (last or '')[:200]
        if extra:
            if extra.get('accepted'):
                p['accepted'] = p.get('accepted', 0) + 1
            if extra.get('score') and extra['score'] != p.get('score'):
                if p.get('score') is not None:
                    p['accepted'] = p.get('accepted', 0) + 1
                p['score'] = extra['score']
            if extra.get('period'):
                p['period'] = extra['period']
            if extra.get('t') is not None:
                p['t'] = extra['t']
        now = time.time()
        if now - self._last_push >= 4 or i >= n:
            self._last_push = now
            try:
                self.db.patch('video_jobs', 'id=eq.%s' % self.id, {'progress': p, 'heartbeat_at': now_iso()})
            except Exception as exc:
                log('(progress write failed: %s)' % exc)
            if now - getattr(self, '_last_beat', 0) >= 60:          # the dashboard's "online" light
                self._last_beat = now
                heartbeat(self.db, self.cfg, self.id, 'processing ' + str(self.row.get('game_id', ''))[:8])

    def run(self):
        db, cfg, row = self.db, self.cfg, self.row
        game_id = row['game_id']
        log('job %s  game %s  %s' % (self.id[:8], game_id[:8], row['video_url']))
        open_dashboard(cfg)
        db.patch('video_jobs', 'id=eq.%s' % self.id, {'status': 'running', 'heartbeat_at': now_iso(),
                                                        'progress': {'stage': 'starting', 'i': 0, 'n': 1}})
        heartbeat(db, cfg, self.id, 'processing ' + game_id[:8])
        video_path = None
        try:
            video_path = fetch_video(row['video_url'], cfg, self.report)
            if self.stop():
                raise KeyboardInterrupt('cancelled')
            self.report('play-by-play', 0, 1, 'fetching the archived log')
            pbp = pbp_for_game(db, game_id)
            mode = row.get('mode_requested') or 'auto'
            if mode == 'score' and not pbp:
                raise RuntimeError('score mode needs the play-by-play, and this game has no archived FIBA log')
            self.report('reading', 0, 1, 'looking at the picture')
            track = read_track(video_path, pbp, cfg, mode, self.report, self.stop)
            if self.stop():
                raise KeyboardInterrupt('cancelled')
            used = track.get('mode')
            if not track.get('samples'):
                raise RuntimeError('nothing readable: ' + (track.get('note') or 'the reader found no clock and no score it could match'))
            slim = write_track(db, game_id, track)
            periods = sorted({s['period'] for s in slim['samples']})
            result = {'samples': len(slim['samples']), 'periods': periods, 'mode': used,
                      'matched': track.get('matched'), 'seen': track.get('changes_seen'), 'fusion': track.get('fusion'),
                      'probe': track.get('probe')}
            db.patch('video_jobs', 'id=eq.%s' % self.id, {'mode_used': used, 'result': result,
                                                            'progress': dict(self.progress, stage='track saved')})
            log('  track saved: %d readings, periods %s, mode %s' % (result['samples'], periods, used))
            # learning, while the footage is on disk -- skipped when another game is waiting
            if cfg.get('harvest'):
                waiting = db.select('video_jobs', 'status=eq.queued&select=id&limit=1')
                if waiting:
                    result['harvest'] = 'skipped: another game is waiting'
                else:
                    try:
                        CK = skill(cfg)
                        times = basket_times(track, pbp, CK)
                        h = harvest_around(video_path, times, cfg, self.report, self.stop) if times else {'windows': 0}
                        result['harvest'] = h
                        log('  harvest: %s' % json.dumps(h))
                    except Exception as exc:
                        result['harvest'] = 'failed: %s' % exc
                        log('  (harvest failed: %s)' % exc)
            db.patch('video_jobs', 'id=eq.%s' % self.id, {'status': 'done', 'finished_at': now_iso(), 'result': result,
                                                            'progress': dict(self.progress, stage='done', i=1, n=1)})
            return True
        except KeyboardInterrupt:
            db.patch('video_jobs', 'id=eq.%s' % self.id, {'status': 'cancelled', 'finished_at': now_iso(),
                                                            'progress': dict(self.progress, stage='cancelled')})
            log('  cancelled')
            return False
        except Exception as exc:
            traceback.print_exc()
            db.patch('video_jobs', 'id=eq.%s' % self.id, {'status': 'failed', 'finished_at': now_iso(),
                                                            'error': ('%s: %s' % (type(exc).__name__, exc))[:1000],
                                                            'progress': dict(self.progress, stage='failed')})
            return False
        finally:
            heartbeat(db, cfg, None, 'idle')
            if video_path and not cfg.get('keep_video'):
                try:
                    os.remove(video_path)
                except Exception:
                    pass


# --------------------------------------------------------------------------- setup, once
def setup(path):
    """Write the config with the one thing only a person can supply: the service_role key."""
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    cfg = load_config(path)
    if cfg.get('service_key') and 'PASTE' not in cfg['service_key']:
        log('config already in place: %s' % path)
        return True
    if not cfg.get('supabase_url'):
        cfg['supabase_url'] = 'https://hhvofgqqadtyvcjudhjx.supabase.co'
    print()
    print('  Supabase -> Project settings -> API -> "service_role" (secret). Copy it, paste it here, Enter.')
    print('  It is written to %s and never leaves this machine.' % path)
    print()
    try:
        key = input('  service_role key: ').strip()
    except EOFError:
        key = ''
    if not key.startswith('eyJ') or len(key) < 60:
        print('  that does not look like a Supabase key (they start with eyJ and are long). Nothing written.')
        return False
    cfg['service_key'] = key
    cfg.pop('worker_id', None)                       # the hostname is picked up at run time
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)
    try:
        DB(cfg['supabase_url'], key).select('video_workers', 'select=id&limit=1')
        print('  key works. saved.')
    except Exception as exc:
        print('  saved, but the database refused it (%s) -- check the key.' % exc)
        return False
    return True


# --------------------------------------------------------------------------- nobody presses anything
_last_backfill = 0.0


def backfill(db, cfg):
    """Every final game with a stream attached and no clock track, tipped off within backfill_days,
    gets a job -- so nothing needs a button, not even games that finished before the worker existed."""
    global _last_backfill
    if not cfg.get('backfill') or time.time() - _last_backfill < 3600:
        return 0
    _last_backfill = time.time()
    # 'Z', not '+00:00': a plus sign inside a URL query is a space
    since = datetime.fromtimestamp(time.time() - 86400 * float(cfg.get('backfill_days') or 21), timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    rows = db.select('game_videos', 'select=game_id,url,games!inner(status,tipoff_at)&is_primary=eq.true'
                                    '&clock_track=is.null&url=neq.&games.status=eq.final&games.tipoff_at=gte.' + since)
    if not rows:
        return 0
    ids = ','.join(r['game_id'] for r in rows)
    have = db.select('video_jobs', 'select=game_id,status&game_id=in.(%s)' % ids)
    blocked = {j['game_id'] for j in have if j['status'] in ('queued', 'claimed', 'running', 'done')}
    tries = {}
    for j in have:
        if j['status'] in ('failed', 'cancelled'):
            tries[j['game_id']] = tries.get(j['game_id'], 0) + 1
    n = 0
    for r in rows:
        g = r['game_id']
        if g in blocked or tries.get(g, 0) >= 2:
            continue
        requests.post('%s/rest/v1/video_jobs' % db.url, headers=dict(db.h, Prefer='return=minimal'),
                      json={'game_id': g, 'video_url': r['url'], 'mode_requested': 'auto', 'requested_via': 'worker'},
                      timeout=30).raise_for_status()
        n += 1
    if n:
        log('queued %d final game(s) with a stream and no track' % n)
    return n


# --------------------------------------------------------------------------- loops
def one_pass(db, cfg):
    heartbeat(db, cfg, None, 'idle')
    try:
        backfill(db, cfg)
    except Exception as exc:
        log('(backfill failed: %s)' % exc)
    row = db.rpc('claim_video_job', {'p_worker': cfg['worker_id']})
    if not row or not isinstance(row, dict) or not row.get('id'):
        return False                # an empty queue comes back as a row of nulls, not as nothing
    Job(db, row, cfg).run()
    return True


def dry_run(args, cfg):
    """No database: read a local file the way a job would, print what would be stored."""
    pbp = load_pbp(args.pbp)
    CK = skill(cfg)
    t0 = time.time()
    def prog(i, n, s):
        if i % 30 == 0:
            what = s.get('text') or (s.get('read') and '%s-%s' % tuple(s['read'])) or s.get('note', '')
            log('%5.1f%%  %-6s t=%7.1fs  %s' % (100.0 * i / max(1, n), s.get('stage', ''), s['t'], what))
    track = CK.run_auto(args.dry_run, pbp=pbp, mode=args.mode, step=cfg['step_clock'], score_step=cfg['step_score'],
                        on_progress=prog, start_s=args.start, end_s=args.end, quiet=True)
    slim = slim_track(track)
    log('mode %s, %d readings, periods %s, probe %s, %.0fs' % (track.get('mode'), len(slim['samples']),
        sorted({s['period'] for s in slim['samples']}), track.get('probe'), time.time() - t0))
    if args.harvest and slim['samples']:
        times = basket_times(track, pbp, CK)
        if args.end:
            times = [t for t in times if (args.start or 0) <= t <= args.end]
        cfg = dict(cfg, harvest_windows=min(int(cfg['harvest_windows']), int(args.harvest)))
        h = harvest_around(args.dry_run, times, cfg, lambda st, i, n, last='', extra=None: log('%s %d/%d %s' % (st, i, n, last)), lambda: False)
        log('harvest: ' + json.dumps(h))
    out = args.out or os.path.splitext(args.dry_run)[0] + '.auto.clock.json'
    with io.open(out, 'w', encoding='utf-8') as f:
        json.dump(slim, f, indent=1)
    log('-> ' + out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', default=CONFIG_PATH)
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--dry-run', metavar='VIDEO')
    ap.add_argument('--pbp'); ap.add_argument('--mode', default='auto')
    ap.add_argument('--start', type=float, default=0.0); ap.add_argument('--end', type=float)
    ap.add_argument('--harvest', type=int, default=0, help='dry run: also harvest this many windows')
    ap.add_argument('--out')
    ap.add_argument('--setup', action='store_true', help='write the config (asks for the service_role key) and exit')
    args = ap.parse_args()
    if args.setup:
        sys.exit(0 if setup(args.config) else 1)
    cfg = load_config(args.config)
    if args.dry_run:
        return dry_run(args, cfg)
    if not cfg['supabase_url'] or not cfg['service_key'] or 'PASTE' in cfg['service_key']:
        sys.exit('no database: run setup-worker.bat once (it asks for the service_role key)')
    db = DB(cfg['supabase_url'], cfg['service_key'])
    log('%s on %s, watching %s' % (VERSION, cfg['worker_id'], cfg['supabase_url']))
    # a fresh start means nothing of mine can still be running: give those jobs back to the queue
    try:
        back = db.patch('video_jobs', 'worker=eq.%s&status=in.(claimed,running)' % cfg['worker_id'],
                        {'status': 'queued', 'worker': None, 'claimed_at': None, 'heartbeat_at': None})
        if back:
            log('requeued %d job(s) left over from my last run' % len(back))
    except Exception as exc:
        log('(requeue failed: %s)' % exc)
    if args.once:
        did = one_pass(db, cfg)
        log('done' if did else 'nothing queued')
        return
    while True:
        try:
            if not one_pass(db, cfg):
                time.sleep(float(cfg['poll_s']))
        except KeyboardInterrupt:
            log('stopped')
            return
        except Exception as exc:
            log('pass failed: %s' % exc)
            time.sleep(60)


if __name__ == '__main__':
    main()
