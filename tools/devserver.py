#!/usr/bin/env python3
"""
A static file server for developing this site, which differs from
`python -m http.server` in exactly one way that matters: IT REFUSES TO BE
CACHED.

`http.server` sends Last-Modified and no Cache-Control. A browser given a
freshness lifetime it was never told is allowed to invent one — the usual
heuristic is a tenth of the time since the file last changed — so a file edited
half an hour ago is considered fresh for three minutes, and a file edited
yesterday for over two hours. During a session of small frequent edits that
produces a page which is confidently, invisibly out of date, and the only clue
is that the change you just made did not happen.

That cost several rounds of "it is still showing the old sidebar" before the
cause was found, so the server now says what it means:

    Cache-Control: no-store, must-revalidate

Nothing here is a production concern. The real site is served by GitHub Pages,
which sets its own headers; this only affects the machine you are developing on.

    python tools/devserver.py [port] [--dir PATH]
"""
import argparse
import contextlib
import http.server
import os
import socket
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # the whole point
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        # http.server has historically mislabelled these, and a stylesheet
        # served as text/plain is silently ignored by the browser
        for suffix, mime in (('.js', 'text/javascript'),
                             ('.mjs', 'text/javascript'),
                             ('.css', 'text/css'),
                             ('.json', 'application/json'),
                             ('.svg', 'image/svg+xml'),
                             ('.woff2', 'font/woff2')):
            if path.endswith(suffix):
                return mime
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        # one line per request, without the date noise
        sys.stderr.write('%s\n' % (fmt % args))


class Server(http.server.ThreadingHTTPServer):
    # a browser holding a keep-alive connection should not stop the server
    # being restarted a second later
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('port', nargs='?', type=int, default=8742)
    ap.add_argument('--dir', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()

    os.chdir(args.dir)
    handler = NoCacheHandler

    with contextlib.closing(Server(('', args.port), handler)) as httpd:
        host = socket.gethostname()
        print('serving %s' % args.dir)
        print('  http://localhost:%d/   (no-store: every request revalidates)' % args.port)
        print('  http://%s:%d/' % (host, args.port))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')


if __name__ == '__main__':
    main()
