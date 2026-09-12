"""
THE CLOCK CAM -- the arena's own clock, read off a picture, pushed to the graphics live.

A FIBA LiveStats feed carries the clock as a snapshot that moves when the table syncs an action,
so no amount of polling gives a scorebug a running clock. A camera pointed at the hall's
scoreboard does: this reads the game clock and the period off frames from any source a few
times a second, decides whether the clock is running (it came down between two reads at the
speed of time), and pushes each reading to every graphics layer on the game over the same live
channel the scoring app uses. The layer ticks locally between readings and is corrected by each
one, so what the stream shows is the hall's clock with about a second of delay.

    python scripts/worker/clock_cam.py --game <game-id> --source 0                 # the PC's webcam
    python scripts/worker/clock_cam.py --game <game-id> --source rtsp://...        # an IP camera
    python scripts/worker/clock_cam.py --game <game-id> --source https://youtu.be/... # a live stream that shows the board
    python scripts/worker/clock_cam.py --game <game-id> --source D:\\some\\recording.mp4 --show   # a file, paced like live

Point the camera so the clock digits are level, sharp and at least 20 pixels tall; a phone on a
clamp at the scorer's table, streaming to the PC over RTSP (IP Webcam and the like), is enough.
The reader is the same one the video worker uses on broadcasts (playtype-vision clock.py), with
the same lock rule: nothing is a game clock until it runs down at the speed of time or a period
label sits beside it.

Supabase and the reader's location come from the worker's own config (%APPDATA%\\epinoia\\worker.json).
"""
import argparse, json, os, sys, time
from datetime import datetime, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ai_worker as W  # noqa: E402


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class Pusher(object):
    """Every reading to the live channel (Realtime's REST broadcast, no socket to keep alive);
    a durable copy to game_state every few seconds so a layer that opens later has a base."""
    def __init__(self, cfg, game_id):
        self.url = cfg['supabase_url'].rstrip('/'); self.key = cfg['service_key']; self.game = game_id
        self.h = {'apikey': self.key, 'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'}
        self.last_durable = 0.0; self.sent = 0; self.failed = 0

    def push(self, period, clock_ms, running, note=''):
        state = {'game_id': self.game, 'period': int(period), 'clock_ms': int(clock_ms), 'running': bool(running),
                 'updated_at': now_iso(), 'source': 'cam'}
        body = {'messages': [{'topic': 'game:' + self.game, 'event': 'frame', 'payload': {'state': state, 'cam': True, 'note': note}}]}
        try:
            r = requests.post(self.url + '/realtime/v1/api/broadcast', headers=self.h, json=body, timeout=5)
            if r.status_code >= 300:
                self.failed += 1
                if self.failed <= 3:
                    print('  (push refused %s: %s)' % (r.status_code, r.text[:120]))
            else:
                self.sent += 1
        except Exception as exc:
            self.failed += 1
            if self.failed <= 3:
                print('  (push failed: %s)' % exc)
        if time.time() - self.last_durable >= 5:
            self.last_durable = time.time()
            try:
                requests.post(self.url + '/rest/v1/game_state', headers=dict(self.h, Prefer='resolution=merge-duplicates,return=minimal'),
                              json={k: v for k, v in state.items() if k != 'source'}, params={'on_conflict': 'game_id'}, timeout=8)
            except Exception as exc:
                print('  (durable write failed: %s)' % exc)


class PhoneSource(object):
    """The Epinoia clock-cam phone app boxes the clock on its own camera and, in 'PC reader' mode,
    posts the boxed crop to cam_frames a few times a second. This reads the newest crop and hands
    it to the same reader as a frame -- the phone does the pointing, the PC does the reading."""
    def __init__(self, cfg, game_id):
        self.url = cfg['supabase_url'].rstrip('/'); self.game = game_id
        self.h = {'apikey': cfg['service_key'], 'Authorization': 'Bearer ' + cfg['service_key']}
        self.seen = None
    def isOpened(self):
        return True
    def get(self, _):
        return 2.0
    def read(self):
        import base64, numpy as np, cv2
        try:
            r = requests.get(self.url + '/rest/v1/cam_frames?game_id=eq.%s&select=taken_at,crop&limit=1' % self.game, headers=self.h, timeout=5)
            rows = r.json() if r.ok else []
        except Exception:
            rows = []
        if not rows or rows[0].get('taken_at') == self.seen:
            time.sleep(0.15); return False, None
        self.seen = rows[0]['taken_at']
        try:
            raw = base64.b64decode(rows[0]['crop'].split(',')[-1])
            img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            return (img is not None), img
        except Exception:
            return False, None
    def release(self):
        pass


def open_source(src, cfg=None):
    if src == 'phone':
        return PhoneSource(cfg, cfg.get('_game')), True
    import cv2
    if src.isdigit():
        cap = cv2.VideoCapture(int(src)); return cap, True
    if 'youtube.com' in src or 'youtu.be' in src:
        import subprocess
        cmd = [sys.executable, '-m', 'yt_dlp', '-g', '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best', src]
        ck = (cfg or {}).get('yt_cookies_file')
        if ck and os.path.exists(ck):
            cmd[3:3] = ['--cookies', ck]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        stream = (out.stdout or '').strip().splitlines()
        if not stream:
            raise SystemExit('could not resolve the stream: ' + (out.stderr or '')[-300:])
        cap = cv2.VideoCapture(stream[0])
        # a live stream is read as it comes; a finished video on YouTube is paced like a file
        live = 'is_live' in (out.stderr or '') or '/manifest/' in stream[0] or '.m3u8' in stream[0]
        return cap, live
    cap = cv2.VideoCapture(src)
    live = src.startswith(('rtsp://', 'rtmp://', 'http://', 'https://', 'udp://'))
    return cap, live


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', required=True, help='the Epinoia game id the layers are on')
    ap.add_argument('--source', required=True, help="camera index, RTSP/HTTP URL, YouTube URL, a file, or 'phone' (crops boxed in the phone app)")
    ap.add_argument('--fps', type=float, default=2.0, help='readings per second (default 2)')
    ap.add_argument('--config', default=os.path.join(os.environ.get('APPDATA', ''), 'epinoia', 'worker.json'))
    ap.add_argument('--show', action='store_true', help='show the frame and the clock box in a window')
    ap.add_argument('--dry', action='store_true', help='read and print, push nothing')
    ap.add_argument('--minutes', type=float, default=0, help='stop after this many minutes (0 = until the source ends)')
    ap.add_argument('--start', type=float, default=0, help='for a file: start this many seconds in')
    args = ap.parse_args()

    cfg = W.load_config(args.config)
    cfg['_game'] = args.game
    sys.path.insert(0, cfg['skill_scripts'])
    import cv2
    import clock as CK

    reader = CK.ClockReader(quiet=True)
    cap, live = open_source(args.source, cfg)
    if not cap or not cap.isOpened():
        raise SystemExit('could not open the source')
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    if not live and args.start:
        cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000.0)
    pusher = None if args.dry else Pusher(cfg, args.game)
    print('clock cam on game %s from %s (%s), %.1f readings/s' % (args.game[:8], args.source, 'live' if live else 'file, paced', args.fps))

    crop = strip = None
    misses = 0
    prev_ms = prev_t = None
    period, period_len = 1, CK.PERIOD_S
    locked = False; provisional = None; label_prev = None
    running = False; last_change_t = None; held = None; steady = None
    started = time.time(); n = 0
    every = 1.0 / max(0.25, args.fps)
    next_t = time.time()
    frame_i = 0
    while True:
        if args.minutes and time.time() - started > args.minutes * 60:
            break
        if live:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.2); continue
            if time.time() < next_t:
                continue                                  # keep the buffer drained, read on the cadence
        else:
            # a file is paced like a live source: skip ahead the frames that would have passed
            step = max(1, int(round(src_fps * every)))
            for _ in range(step - 1):
                cap.grab()
            ok, frame = cap.read()
            if not ok:
                break
            wait = next_t - time.time()
            if wait > 0:
                time.sleep(wait)
        next_t = time.time() + every
        t = time.time()
        frame_i += 1
        if args.source == 'phone':
            crop = (0, 0, frame.shape[1], frame.shape[0]); strip = None
        elif crop is None or misses >= 6:
            loc = CK.locate(reader, frame, crop)
            if loc:
                crop = (loc['x'], loc['y'], loc['w'], loc['h']); strip = loc.get('strip'); misses = 0
        label_now = None
        if strip is not None and (frame_i % 2 == 0 or not locked):
            pl = CK.read_period(reader, frame, strip)
            if pl and 1 <= pl <= 6:
                label_now = pl
                if pl != period and label_prev == pl:
                    period = pl; period_len = CK.PERIOD_S if period <= 4 else CK.OT_S; prev_ms = None
                label_prev = pl
            else:
                label_prev = None
        if crop is None:
            misses += 1
            if frame_i % 10 == 0:
                print('  %s no clock in the picture yet' % time.strftime('%H:%M:%S'))
            continue
        x, y, w, h = crop
        sub = frame[y:y + h, x:x + w]
        dt = (t - prev_t) if prev_t is not None else None
        cands = CK.candidates_for(prev_ms, dt, period_len) if prev_ms is not None else None
        r = reader.read(sub, cands, period_len)
        if not r:
            misses += 1
            continue
        ms = r['ms']
        # PHYSICS FIRST, AND IN BOTH DIRECTIONS.
        #
        # This used to hold back only readings that jumped UP, on the reasoning that a clock
        # inside a period never runs up. True, but incomplete: a clock inside a period does not
        # jump DOWN five minutes either, and a 9 misread as a 3 does exactly that. Holding one
        # and waving the other through is the worst of both, because the one that goes straight
        # to air is the one that moves the clock furthest.
        #
        # So the question is the same either way: could a clock that read prev_ms then be
        # reading ms now? It may have fallen by up to the time that has passed, with slack for
        # frames we did not get; it may have stood still; it may not have risen. Anything else
        # is held until the board keeps saying it -- three readings spanning most of a second,
        # which is a new period or the table correcting itself, and is not a misread.
        #
        # The browser clock cam runs exactly this rule (epinoia/clockcam/clock.js), and a test
        # over a quarter of deliberately bad frames keeps it honest.
        if locked and prev_ms is not None and dt:
            slack = min(5.0, max(1.0, 0.5 * dt))
            fits = -0.4 <= (prev_ms - ms) / 1000.0 <= dt + slack
            if not fits:
                if held is not None:
                    h_ms, h_t, h_n, h_first = held
                    h_dt = t - h_t
                    h_slack = min(5.0, max(1.0, 0.5 * h_dt))
                    if -0.4 <= (h_ms - ms) / 1000.0 <= h_dt + h_slack:
                        held = (ms, t, h_n + 1, h_first)
                        if h_n + 1 < 3 or (t - h_first) < 0.7:
                            misses += 1; continue
                        held = None          # three readings agreeing over most of a second
                        running = False; last_change_t = t
                    else:
                        held = (ms, t, 1, t); misses += 1; continue
                else:
                    held = (ms, t, 1, t); misses += 1; continue
            else:
                held = None
        if not locked:
            runs = (provisional is not None and provisional[0] > ms and abs((provisional[0] - ms) / 1000.0 - (t - provisional[1])) <= 2.5)
            # how long this exact value has been on the board, measured from the FIRST frame that
            # showed it -- not from the previous frame, which at this cadence is always a fraction
            # of a second ago. Measured the old way a stopped clock could never be locked on to.
            if steady is None or steady[0] != ms:
                steady = (ms, t)
            still = (t - steady[1]) > 1.2
            if label_now or runs or still:
                locked = True
                running = bool(runs); last_change_t = t
                print('  locked on the clock at %s (%s)' % (CK.fmt_clock(ms),
                      'period label' if label_now else ('running value' if runs else 'held still')))
            else:
                provisional = (ms, t)
                continue
        misses = 0
        # running: it came down since the last reading at about the speed of time
        # RUNNING IS "IT CAME DOWN", NOT "IT CAME DOWN BY EXACTLY THE RIGHT AMOUNT".
        #
        # The old test also required the fall to match the time since the last reading, which
        # at two readings a second off a board showing whole seconds is a coin toss: half the
        # readings repeat the same value and the arithmetic lands either side of its tolerance.
        # The flag flickered between running and stopped on a clock that was plainly running,
        # and every flicker is a layer pausing its own tick for a moment. Whether the reading is
        # PLAUSIBLE is already settled above; all that is left to ask is which way it moved.
        # Same rule as epinoia/clockcam/clock.js, so the two readers agree.
        if prev_ms is not None and dt:
            if ms < prev_ms - 100:
                running = True; last_change_t = t
            elif ms == prev_ms and (t - (last_change_t or 0)) > 1.6:
                running = False
        prev_ms, prev_t = ms, t
        n += 1
        if pusher:
            pusher.push(period, ms, running)
        if n % 10 == 1:
            print('  %s  P%d %s  %s%s' % (time.strftime('%H:%M:%S'), period, CK.fmt_clock(ms), 'running' if running else 'stopped',
                                          ('  (%d pushed, %d failed)' % (pusher.sent, pusher.failed)) if pusher else ''))
        if args.show:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.putText(frame, 'P%d %s %s' % (period, CK.fmt_clock(ms), 'RUN' if running else 'STOP'), (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.imshow('clock cam', frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    cap.release()
    print('done: %d readings' % n + ((', %d pushed, %d failed' % (pusher.sent, pusher.failed)) if pusher else ''))


if __name__ == '__main__':
    main()
