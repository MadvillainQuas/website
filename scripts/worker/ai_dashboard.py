#!/usr/bin/env python3
"""ai_dashboard.py — the AI worker's control panel, as a window on the processing PC.

The queue, live: every game waiting, running, done or failed, each with its own progress bar
and the last thing the reader saw. Buttons to start and stop the worker process, pause and
resume it (pause finishes the current game and claims nothing more), move a waiting game up
or down or to the top, cancel one, retry one, add a game by pasting its page link, and open
a game's page. A status bar along the bottom says what the worker is doing right now.

Talks to the same database with the same config as ai_worker.py (%APPDATA%\\epinoia\\worker.json),
so it works whether the worker was started here, by the Startup launcher, or on another PC.
tkinter only — nothing to install.

    python ai_dashboard.py            # the window
    python ai_dashboard.py --once     # print the queue and exit (no window; for tests)
"""
import os, sys, io, re, json, time, threading, subprocess, webbrowser, argparse, socket
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ai_worker as W  # noqa: E402  (config, DB, helpers)

SITE = 'https://prophesyscouting.co.uk'
ACTIVE = ('queued', 'claimed', 'running')
BAR_W = 14


def bar(frac, width=BAR_W):
    n = int(round(max(0.0, min(1.0, frac)) * width))
    return '█' * n + '░' * (width - n)


def ago(iso):
    if not iso:
        return ''
    try:
        t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    except Exception:
        return ''
    s = max(0, (datetime.now(timezone.utc) - t).total_seconds())
    if s < 90:
        return '%ds ago' % s
    if s < 5400:
        return '%dm ago' % (s // 60)
    if s < 172800:
        return '%dh ago' % (s // 3600)
    return '%dd ago' % (s // 86400)


def fmt_t(t):
    if t is None:
        return ''
    t = int(t)
    return '%d:%02d:%02d' % (t // 3600, (t % 3600) // 60, t % 60) if t >= 3600 else '%d:%02d' % (t // 60, t % 60)


# --------------------------------------------------------------------------- the data
class Model(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self.db = W.DB(cfg['supabase_url'], cfg['service_key'])
        self.worker_id = cfg.get('worker_id') or socket.gethostname()
        self.jobs, self.workers = [], []
        self.error = None

    def refresh(self):
        try:
            self.jobs = self.db.select('video_jobs',
                'select=id,game_id,status,mode_requested,mode_used,priority,progress,result,error,requested_via,requested_at,'
                'worker,claimed_at,heartbeat_at,finished_at,cancel_requested,video_url,'
                'games(tipoff_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))'
                '&order=requested_at.desc&limit=200')
            self.workers = self.db.select('video_workers', 'select=id,last_seen,busy_job,paused,note&order=last_seen.desc')
            self.error = None
        except Exception as exc:
            self.error = str(exc)

    def me(self):
        for w in self.workers:
            if w['id'] == self.worker_id:
                return w
        return None

    def queued(self):
        q = [j for j in self.jobs if j['status'] == 'queued']
        q.sort(key=lambda j: (-(j.get('priority') or 0), j['requested_at']))
        return q

    def ordered(self):
        """Running first, then the queue in claim order, then history newest first."""
        run = [j for j in self.jobs if j['status'] in ('claimed', 'running')]
        hist = [j for j in self.jobs if j['status'] not in ACTIVE]
        return run + self.queued() + hist

    # ---- actions
    def renumber(self, q):
        n = len(q)
        for k, j in enumerate(q):
            want = n - k
            if (j.get('priority') or 0) != want:
                self.db.patch('video_jobs', 'id=eq.%s' % j['id'], {'priority': want})
                j['priority'] = want

    def move(self, job_id, where):
        q = self.queued()
        ids = [j['id'] for j in q]
        if job_id not in ids:
            return
        i = ids.index(job_id)
        j = q.pop(i)
        if where == 'top':
            q.insert(0, j)
        elif where == 'up':
            q.insert(max(0, i - 1), j)
        elif where == 'down':
            q.insert(min(len(q), i + 1), j)
        elif where == 'bottom':
            q.append(j)
        self.renumber(q)

    def cancel(self, job):
        if job['status'] == 'queued':
            self.db.patch('video_jobs', 'id=eq.%s' % job['id'], {'status': 'cancelled', 'finished_at': W.now_iso()})
        elif job['status'] in ('claimed', 'running'):
            self.db.patch('video_jobs', 'id=eq.%s' % job['id'], {'cancel_requested': True})

    def retry(self, job):
        top = max([j.get('priority') or 0 for j in self.queued()] + [0]) + 1
        self.insert(job['game_id'], job['video_url'], priority=top)

    def insert(self, game_id, url, priority=0):
        import requests
        requests.post('%s/rest/v1/video_jobs' % self.db.url, headers=dict(self.db.h, Prefer='return=minimal'),
                      json={'game_id': game_id, 'video_url': url, 'mode_requested': 'auto',
                            'requested_via': 'dashboard', 'priority': priority}, timeout=30).raise_for_status()

    def add_game(self, text):
        m = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', text or '', re.I)
        if not m:
            raise ValueError('paste the game page link (it carries ?g=<id>) or the game id')
        gid = m.group(0)
        vids = self.db.select('game_videos', 'game_id=eq.%s&is_primary=eq.true&select=url&limit=1' % gid)
        if not vids or not vids[0].get('url'):
            raise ValueError('that game has no video attached yet — attach the link on its page first')
        if any(j['game_id'] == gid and j['status'] in ACTIVE for j in self.jobs):
            raise ValueError('that game is already queued or running')
        self.insert(gid, vids[0]['url'])

    def set_paused(self, paused):
        self.db.upsert('video_workers', {'id': self.worker_id, 'paused': bool(paused), 'last_seen': W.now_iso()}, 'id')


# --------------------------------------------------------------------------- the worker process
class Proc(object):
    """The worker as a child of this window, with its output kept."""
    def __init__(self, on_line):
        self.p = None
        self.on_line = on_line

    def running(self):
        return self.p is not None and self.p.poll() is None

    def start(self):
        if self.running():
            return
        self.p = subprocess.Popen([sys.executable, os.path.join(HERE, 'ai_worker.py')], cwd=HERE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        try:
            for line in self.p.stdout:
                self.on_line(line.rstrip())
        except Exception:
            pass
        self.on_line('[worker exited]')

    def stop(self):
        if self.running():
            self.p.terminate()
            try:
                self.p.wait(timeout=8)
            except Exception:
                self.p.kill()
        # a worker started elsewhere (the Startup launcher): stop that too
        try:
            subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
                            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ai_worker.py*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
                           capture_output=True, timeout=30)
        except Exception:
            pass


def others_running():
    """Is a worker process alive on this machine that this window did not start?"""
    try:
        r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
                            "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ai_worker.py*' }).Count"],
                           capture_output=True, text=True, timeout=20)
        return int((r.stdout or '0').strip() or 0) > 0
    except Exception:
        return False


# --------------------------------------------------------------------------- the window
def run_window(cfg):
    import tkinter as tk
    from tkinter import ttk, messagebox, simpledialog

    M = Model(cfg)
    root = tk.Tk()
    root.title('Epinoia AI worker')
    root.geometry('1180x720')
    root.minsize(900, 520)
    try:
        root.iconbitmap(default='')
    except Exception:
        pass

    BG, PANEL, INK, DIM, LUME, AMBER, RULE = '#07130d', '#0b1a12', '#e6fff1', '#8fb3a1', '#93f2bf', '#ffd166', '#1d3a2b'
    root.configure(bg=BG)
    st = ttk.Style(root)
    try:
        st.theme_use('clam')
    except Exception:
        pass
    st.configure('.', background=BG, foreground=INK, fieldbackground=PANEL, font=('Segoe UI', 10))
    st.configure('TFrame', background=BG)
    st.configure('TLabel', background=BG, foreground=INK)
    st.configure('Dim.TLabel', foreground=DIM, font=('Segoe UI', 9))
    st.configure('Head.TLabel', foreground=LUME, font=('Segoe UI Semibold', 13))
    st.configure('TButton', background=PANEL, foreground=INK, borderwidth=1, focusthickness=0, padding=(10, 5))
    st.map('TButton', background=[('active', RULE)])
    st.configure('Go.TButton', background=LUME, foreground='#04100b')
    st.map('Go.TButton', background=[('active', '#b5f7d3')])
    st.configure('Treeview', background=PANEL, fieldbackground=PANEL, foreground=INK, rowheight=26, borderwidth=0, font=('Consolas', 10))
    st.configure('Treeview.Heading', background=BG, foreground=DIM, font=('Segoe UI', 9), relief='flat')
    st.map('Treeview', background=[('selected', RULE)], foreground=[('selected', INK)])
    st.configure('Horizontal.TProgressbar', troughcolor=PANEL, background=LUME, bordercolor=BG, lightcolor=LUME, darkcolor=LUME)

    # ---- top: the worker
    top = ttk.Frame(root, padding=(14, 12, 14, 6)); top.pack(fill='x')
    ttk.Label(top, text='AI worker', style='Head.TLabel').pack(side='left')
    wlab = ttk.Label(top, text='', style='Dim.TLabel'); wlab.pack(side='left', padx=(14, 0))
    btns = ttk.Frame(top); btns.pack(side='right')
    lines = []

    def on_line(s):
        lines.append(s)
        del lines[:-400]
        root.after(0, render_log)

    P = Proc(on_line)

    def act(fn, *a):
        def go():
            try:
                fn(*a)
            except Exception as exc:
                messagebox.showerror('Epinoia AI worker', str(exc))
            refresh_now()
        return go

    def start_worker():
        if P.running() or others_running():
            raise RuntimeError('a worker is already running on this machine')
        P.start()
        on_line('[worker started from the dashboard]')

    def stop_worker():
        if not messagebox.askyesno('Stop the worker', 'Stop the worker now? The game it is reading goes back to the queue and starts over next time.'):
            return
        P.stop()

    def pause_worker():
        M.set_paused(True)

    def resume_worker():
        M.set_paused(False)

    def add_game():
        s = simpledialog.askstring('Add a game', 'Paste the game page link (…/epinoia/game/?g=…) or the game id:', parent=root)
        if s:
            M.add_game(s)

    b_start = ttk.Button(btns, text='Start worker', style='Go.TButton', command=act(start_worker)); b_start.pack(side='left', padx=3)
    b_stop = ttk.Button(btns, text='Stop', command=act(stop_worker)); b_stop.pack(side='left', padx=3)
    b_pause = ttk.Button(btns, text='Pause', command=act(pause_worker)); b_pause.pack(side='left', padx=3)
    b_resume = ttk.Button(btns, text='Resume', command=act(resume_worker)); b_resume.pack(side='left', padx=3)
    ttk.Button(btns, text='Add game…', command=act(add_game)).pack(side='left', padx=(12, 3))

    # ---- middle: the queue
    mid = ttk.Frame(root, padding=(14, 4, 14, 4)); mid.pack(fill='both', expand=True)
    cols = ('n', 'game', 'when', 'status', 'mode', 'bar', 'pct', 'last')
    tree = ttk.Treeview(mid, columns=cols, show='headings', selectmode='browse')
    heads = {'n': ('#', 34), 'game': ('Game', 300), 'when': ('Tipped off', 96), 'status': ('Status', 86), 'mode': ('Read from', 96),
             'bar': ('Progress', 150), 'pct': ('%', 46), 'last': ('Stage · last seen', 330)}
    for c in cols:
        tree.heading(c, text=heads[c][0])
        tree.column(c, width=heads[c][1], minwidth=30, stretch=(c in ('game', 'last')), anchor='w')
    sb = ttk.Scrollbar(mid, orient='vertical', command=tree.yview)
    tree.configure(yscrollcommand=sb.set)
    tree.pack(side='left', fill='both', expand=True); sb.pack(side='left', fill='y')
    tree.tag_configure('running', foreground=LUME)
    tree.tag_configure('queued', foreground=INK)
    tree.tag_configure('done', foreground=DIM)
    tree.tag_configure('failed', foreground=AMBER)
    tree.tag_configure('cancelled', foreground=DIM)

    side = ttk.Frame(mid, padding=(10, 0, 0, 0)); side.pack(side='left', fill='y')
    ttk.Label(side, text='Selected game', style='Dim.TLabel').pack(anchor='w', pady=(0, 4))

    def selected():
        sel = tree.selection()
        if not sel:
            raise RuntimeError('pick a game in the list first')
        jid = sel[0]
        for j in M.jobs:
            if j['id'] == jid:
                return j
        raise RuntimeError('that row is gone; refreshing')

    def open_page():
        j = selected()
        webbrowser.open('%s/epinoia/game/?g=%s&mode=supabase' % (SITE, j['game_id']))

    def cancel_sel():
        j = selected()
        if j['status'] not in ACTIVE:
            raise RuntimeError('that job is already finished')
        M.cancel(j)

    def retry_sel():
        j = selected()
        if j['status'] in ACTIVE:
            raise RuntimeError('that job is still on its way')
        M.retry(j)

    for text, fn in (('To top', lambda: M.move(selected()['id'], 'top')), ('Up', lambda: M.move(selected()['id'], 'up')),
                     ('Down', lambda: M.move(selected()['id'], 'down')), ('To bottom', lambda: M.move(selected()['id'], 'bottom')),
                     ('Cancel', cancel_sel), ('Retry', retry_sel), ('Open page', open_page)):
        ttk.Button(side, text=text, command=act(fn), width=12).pack(fill='x', pady=2)

    # ---- bottom: the current job, the status bar, the log
    bot = ttk.Frame(root, padding=(14, 4, 14, 4)); bot.pack(fill='x')
    cur_lab = ttk.Label(bot, text='', style='Dim.TLabel'); cur_lab.pack(anchor='w')
    cur_bar = ttk.Progressbar(bot, orient='horizontal', mode='determinate', maximum=100); cur_bar.pack(fill='x', pady=(2, 4))
    logbox = tk.Text(root, height=7, bg=PANEL, fg=DIM, insertbackground=INK, relief='flat', font=('Consolas', 9), wrap='none')
    logbox.pack(fill='x', padx=14, pady=(0, 4))
    status = tk.Label(root, text='', anchor='w', bg='#0f2419', fg=INK, font=('Segoe UI', 9), padx=10, pady=4)
    status.pack(fill='x', side='bottom')

    def render_log():
        logbox.configure(state='normal')
        logbox.delete('1.0', 'end')
        logbox.insert('end', '\n'.join(lines[-200:]))
        logbox.see('end')
        logbox.configure(state='disabled')

    # ---- rendering
    def game_name(j):
        g = j.get('games') or {}
        h = (g.get('home') or {}).get('name') or '?'
        a = (g.get('away') or {}).get('name') or '?'
        return '%s v %s' % (h, a)

    def tip(j):
        g = j.get('games') or {}
        t = g.get('tipoff_at')
        if not t:
            return ''
        try:
            d = datetime.fromisoformat(t.replace('Z', '+00:00')).astimezone()
            return d.strftime('%a %d %b')
        except Exception:
            return t[:10]

    def row_of(j, n):
        p = j.get('progress') or {}
        stg = str(p.get('stage') or '')
        s = j['status']
        if s in ('claimed', 'running'):
            frac = (p.get('i') or 0) / float(p.get('n') or 1) if p.get('n') else 0.0
            label = ('downloading' if stg.startswith('downloading') else 'reading the clock' if stg == 'reading:clock' else
                     'reading the score' if stg == 'reading:score' else 'learning from the footage' if stg.startswith('harvest') else
                     'fetching the log' if stg.startswith('play-by-play') else stg or 'starting')
            extra = []
            if p.get('score') and p['score'][0] is not None:
                extra.append('%s–%s' % tuple(p['score']))
            if p.get('period'):
                extra.append('P%s' % p['period'])
            if p.get('t') is not None:
                extra.append(fmt_t(p['t']))
            if p.get('accepted'):
                extra.append('%d readings' % p['accepted'])
            last = label + (' · ' + ' · '.join(extra) if extra else '') + (' · ' + str(p.get('last') or '')[:60] if p.get('last') and not stg.startswith('reading') else '')
            if j.get('cancel_requested'):
                last = 'stopping… · ' + last
            return (n, game_name(j), tip(j), s, j.get('mode_used') or '', bar(frac), '%d' % round(frac * 100), last), 'running'
        if s == 'queued':
            return (n, game_name(j), tip(j), 'waiting', '', bar(0.0), '', 'queued %s via %s' % (ago(j['requested_at']), j.get('requested_via'))), 'queued'
        if s == 'done':
            r = j.get('result') or {}
            last = '%d readings · %d periods%s · %s' % (r.get('samples') or 0, len(r.get('periods') or []),
                    (' · %s/%s score changes' % (r.get('matched'), r.get('seen'))) if r.get('matched') is not None else '', ago(j.get('finished_at')))
            return (n, game_name(j), tip(j), 'done', j.get('mode_used') or '', bar(1.0), '100', last), 'done'
        if s == 'failed':
            return (n, game_name(j), tip(j), 'failed', j.get('mode_used') or '', bar(0.0), '', (j.get('error') or '')[:110] + ' · ' + ago(j.get('finished_at'))), 'failed'
        return (n, game_name(j), tip(j), s, '', bar(0.0), '', ago(j.get('finished_at'))), 'cancelled'

    def render():
        sel = tree.selection()
        keep = sel[0] if sel else None
        tree.delete(*tree.get_children())
        n = 0
        for j in M.ordered():
            n += 1
            vals, tag = row_of(j, n)
            tree.insert('', 'end', iid=j['id'], values=vals, tags=(tag,))
        if keep and tree.exists(keep):
            tree.selection_set(keep)
        me = M.me()
        def fresh(iso, s=90):
            try:
                return bool(iso) and (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace('Z', '+00:00'))).total_seconds() < s
            except Exception:
                return False
        alive = bool(me and fresh(me.get('last_seen'))) or any(
            j['status'] in ('claimed', 'running') and j.get('worker') == M.worker_id and fresh(j.get('heartbeat_at')) for j in M.jobs)
        paused = bool(me and me.get('paused'))
        running = [j for j in M.jobs if j['status'] in ('claimed', 'running')]
        nq = len(M.queued())
        wl = ('%s · %s · %s' % (M.worker_id, ('online' if alive else 'not running') + (' · PAUSED' if paused else ''),
              'last seen ' + ago(me['last_seen']) if me else 'never seen'))
        wlab.configure(text=wl)
        b_start.state(['disabled'] if alive else ['!disabled'])
        b_stop.state(['!disabled'] if alive else ['disabled'])
        b_pause.state(['disabled'] if paused else ['!disabled'])
        b_resume.state(['!disabled'] if paused else ['disabled'])
        if running:
            j = running[0]; p = j.get('progress') or {}
            frac = (p.get('i') or 0) / float(p.get('n') or 1) if p.get('n') else 0.0
            cur_bar['value'] = frac * 100
            cur_lab.configure(text='now: %s — %s' % (game_name(j), row_of(j, 0)[0][7]))
        else:
            cur_bar['value'] = 0
            cur_lab.configure(text='now: idle' + (' (paused)' if paused else ''))
        sb_text = ('%d waiting · %d running · %d done · %d failed' % (nq, len(running),
                   len([j for j in M.jobs if j['status'] == 'done']), len([j for j in M.jobs if j['status'] == 'failed'])))
        if M.error:
            sb_text = 'database: ' + M.error
        status.configure(text=sb_text + '   ·   refreshed ' + datetime.now().strftime('%H:%M:%S'), fg=(AMBER if M.error else INK))

    busy = {'on': False}

    def refresh_now():
        if busy['on']:
            return
        busy['on'] = True
        def work():
            M.refresh()
            root.after(0, lambda: (render(), busy.update(on=False)))
        threading.Thread(target=work, daemon=True).start()

    def tick():
        refresh_now()
        root.after(3000, tick)

    tree.bind('<Double-1>', lambda e: act(open_page)())
    tick()
    root.mainloop()
    if P.running():
        # the window closing does not stop the worker: it keeps reading (the Startup launcher would restart it anyway)
        pass


def once(cfg):
    M = Model(cfg)
    M.refresh()
    if M.error:
        print('database error:', M.error); return 1
    me = M.me()
    print('worker %s: %s%s' % (M.worker_id, ('last seen ' + ago(me['last_seen'])) if me else 'never seen', ' PAUSED' if me and me.get('paused') else ''))
    for n, j in enumerate(M.ordered(), 1):
        g = j.get('games') or {}
        print('%2d %-9s %-44s %s %s' % (n, j['status'], '%s v %s' % ((g.get('home') or {}).get('name'), (g.get('away') or {}).get('name')),
              bar(((j.get('progress') or {}).get('i') or 0) / float((j.get('progress') or {}).get('n') or 1)) if j['status'] in ('claimed', 'running') else '',
              (j.get('progress') or {}).get('stage') or j.get('error') or ''))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', default=W.CONFIG_PATH)
    ap.add_argument('--once', action='store_true')
    args = ap.parse_args()
    cfg = W.load_config(args.config)
    if not cfg.get('service_key') or 'PASTE' in cfg['service_key']:
        sys.exit('run setup-worker.bat once first (it asks for the service_role key)')
    if args.once:
        sys.exit(once(cfg))
    run_window(cfg)


if __name__ == '__main__':
    main()
