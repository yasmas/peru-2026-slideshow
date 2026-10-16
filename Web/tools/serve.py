#!/usr/bin/env python3
"""Local slideshow preview server with the byte ranges Safari needs for video."""

import argparse
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RangeHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.m4v': 'video/mp4'}

    def send_head(self):
        self._range = None
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            file = open(path, 'rb')
        except OSError:
            return super().send_head()

        stat = os.fstat(file.fileno())
        size = stat.st_size
        requested = self.headers.get('Range')
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested or '')
        if requested and match and size:
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            elif last:
                start = max(0, size - int(last))
                end = size - 1
            else:
                start, end = 0, size - 1
            if start >= size or end < start:
                file.close()
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
            self._range = (start, end)
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            length = end - start + 1
        else:
            self.send_response(200)
            length = size

        self.send_header('Content-type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
        self.end_headers()
        return file

    def copyfile(self, source, outputfile):
        if self._range is None:
            return super().copyfile(source, outputfile)
        start, end = self._range
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8751)
    parser.add_argument('--bind', default='127.0.0.1')
    args = parser.parse_args()
    web_root = Path(__file__).resolve().parents[1]
    handler = partial(RangeHandler, directory=str(web_root))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f'Slideshow preview: http://127.0.0.1:{args.port}/', flush=True)
        server.serve_forever()
