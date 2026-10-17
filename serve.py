#!/usr/bin/env python3
"""识星 · 本地静态服务器（禁用缓存）

用法：
    python serve.py            # 默认 8642 端口
    python serve.py 8000       # 指定端口

与 `python -m http.server` 的区别：响应头强制 Cache-Control: no-store，
因此改完 js/css 后普通刷新（F5）就能拿到新文件，不必 Ctrl+F5。
直接双击 index.html 用 file:// 打开时没有这层保障，仍需硬刷新。
"""
import os
import sys
import http.server
import socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'识星 serving at http://127.0.0.1:{PORT}/index.html  (no-store)')
        httpd.serve_forever()
