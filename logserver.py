#!/usr/bin/env python3
"""Receive Miqaat's diagnostic trace from the TV.

    python3 logserver.py

`sdb dlog` drops its connection on this firmware and the app's data directory
cannot be pulled, so the app POSTs its log here instead. In the app:
Settings -> Diagnostics -> ENTER sends on demand, and it auto-sends after every
resume attempt.

The URL the TV posts to is `logPostUrl` in js/settings.js — update it if this
machine's IP changes (check with `ipconfig getifaddr en0`).
"""
import datetime
import http.server
import os
import socketserver

PORT = 8099
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tvlog.txt")


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        stamp = datetime.datetime.now().strftime("%H:%M:%S")
        with open(OUT, "a") as fh:
            fh.write(f"\n########## {stamp} from {self.client_address[0]}\n{body}\n")
        print(f"--- {stamp}  {length} bytes from {self.client_address[0]}", flush=True)
        print(body, flush=True)
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"listening on 0.0.0.0:{PORT}  ->  {OUT}", flush=True)
    httpd.serve_forever()
