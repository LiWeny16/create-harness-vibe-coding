#!/usr/bin/env python3
"""Small localhost-only faster-whisper HTTP adapter for wf-search."""

import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel


HOST = os.environ.get("WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_PORT", "8090"))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")
MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR", str(Path.home() / "models" / "whisper"))
MAX_BODY_BYTES = int(os.environ.get("WHISPER_MAX_BODY_BYTES", str(512 * 1024 * 1024)))
TRANSCRIBE_LOCK = threading.Lock()


print(f"loading faster-whisper model={MODEL_NAME} device={DEVICE} compute_type={COMPUTE_TYPE}", flush=True)
MODEL = WhisperModel(
    MODEL_NAME,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    download_root=MODEL_DIR,
)
print("model ready", flush=True)


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def truthy(value, default=False):
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Handler(BaseHTTPRequestHandler):
    server_version = "wf-search-whisper/1"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            json_response(self, 200, {"status": "ok", "model": MODEL_NAME, "device": DEVICE})
            return
        json_response(self, 404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/transcribe":
            json_response(self, 404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 1:
            json_response(self, 411, {"error": "Content-Length is required"})
            return
        if length > MAX_BODY_BYTES:
            json_response(self, 413, {"error": f"body exceeds {MAX_BODY_BYTES} bytes"})
            return

        suffix = Path(self.headers.get("X-Filename", "media.bin")).suffix.lower()
        if suffix not in {".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".flac", ".aac"}:
            suffix = ".bin"
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(prefix="wf-search-", suffix=suffix, delete=False) as temp:
                temp_path = temp.name
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("request body ended early")
                    temp.write(chunk)
                    remaining -= len(chunk)

            language = self.headers.get("X-Language") or None
            word_timestamps = truthy(self.headers.get("X-Word-Timestamps"), False)
            vad_filter = truthy(self.headers.get("X-Vad-Filter"), True)
            with TRANSCRIBE_LOCK:
                segments, info = MODEL.transcribe(
                    temp_path,
                    language=language,
                    beam_size=5,
                    vad_filter=vad_filter,
                    word_timestamps=word_timestamps,
                )
                rows = []
                for index, segment in enumerate(segments):
                    row = {
                        "id": index,
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text,
                    }
                    if word_timestamps and segment.words:
                        row["words"] = [
                            {
                                "word": word.word,
                                "start": word.start,
                                "end": word.end,
                                "probability": word.probability,
                            }
                            for word in segment.words
                        ]
                    rows.append(row)
            json_response(self, 200, {
                "language": info.language,
                "language_probability": info.language_probability,
                "model": MODEL_NAME,
                "duration": getattr(info, "duration", None),
                "segments": rows,
            })
        except Exception as error:  # keep the HTTP boundary from killing systemd
            print(f"transcription failed: {error}", flush=True)
            json_response(self, 500, {"error": str(error)})
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
