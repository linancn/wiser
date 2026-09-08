"""Private byte-in / NDJSON-out service; no database, identity or URL-fetch access."""

import base64
import hashlib
import json
import logging
import multiprocessing
import re
import resource
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from parser import MAX_INPUT_BYTES, ParseError, parse_asset

MAX_REQUEST = 192 * 1024 * 1024
MAX_FILES_BYTES = 128 * 1024 * 1024
MAX_LINE = 1024 * 1024
MAX_RESPONSE = 1024 * 1024 * 1024
MAX_SECONDS = 900
LOGGER = logging.getLogger(__name__)
SLOTS = threading.BoundedSemaphore(2)
KINDS = {"xlsx", "xls", "html", "md", "pdf", "txt", "zip"}


def safe_name(name):
    if (
        not isinstance(name, str)
        or not name
        or len(name) > 1024
        or "\\" in name
        or any(ord(character) < 32 or ord(character) == 127 for character in name)
        or any(part in ("", ".", "..") for part in name.split("/"))
        or re.match(r"^[A-Za-z]:", name)
    ):
        raise ParseError("UNSAFE_PATH")
    return name


def prepare_request(payload, root):
    if (
        not isinstance(payload, dict)
        or set(payload) != {"format", "primary", "files"}
        or not isinstance(payload["format"], str)
        or payload["format"] not in KINDS
        or not isinstance(payload["files"], list)
        or not 1 <= len(payload["files"]) <= 64
    ):
        raise ParseError("INVALID_REQUEST")
    primary = safe_name(payload["primary"])
    prepared = []
    names = set()
    total = 0
    primary_hash = None
    for entry in payload["files"]:
        if not isinstance(entry, dict) or set(entry) != {"name", "sha256", "base64"}:
            raise ParseError("INVALID_REQUEST")
        name = safe_name(entry["name"])
        if name in names:
            raise ParseError("INVALID_REQUEST")
        names.add(name)
        if (
            not isinstance(entry["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
            or not isinstance(entry["base64"], str)
            or len(entry["base64"]) > (MAX_INPUT_BYTES * 4 // 3 + 4)
        ):
            raise ParseError("INVALID_REQUEST")
        try:
            content = base64.b64decode(entry["base64"], validate=True)
        except (ValueError, TypeError) as error:
            raise ParseError("INVALID_REQUEST") from error
        total += len(content)
        if len(content) > MAX_INPUT_BYTES or total > MAX_FILES_BYTES:
            raise ParseError("SIZE_LIMIT")
        digest = hashlib.sha256(content).hexdigest()
        if digest != entry["sha256"]:
            raise ParseError("HASH_MISMATCH")
        if name == primary:
            primary_hash = digest
        prepared.append((name, content))
    if primary_hash is None:
        raise ParseError("INVALID_REQUEST")
    for name, content in prepared:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as output:
            output.write(content)
    return root / primary, payload["format"], primary_hash


def encode_event(event):
    output = (
        json.dumps(
            event, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
        + b"\n"
    )
    if len(output) > MAX_LINE:
        raise ParseError("RECORD_SIZE_LIMIT")
    return output


def child_parse(path, kind, connection):
    try:
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (600, 600))
        for event in parse_asset(Path(path), kind):
            connection.send_bytes(encode_event(event))
    except ParseError as error:
        connection.send_bytes(encode_event({"type": "error", "code": str(error)}))
    except MemoryError:
        connection.send_bytes(encode_event({"type": "error", "code": "CAPACITY_LIMIT"}))
    except Exception as error:
        LOGGER.exception("Source parser failed (%s)", type(error).__name__)
        connection.send_bytes(encode_event({"type": "error", "code": "PARSING_FAILED"}))
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "WiserSourceParser/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, _format, *args):
        # No source text or request payload belongs in process access logs.
        pass

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(
            200 if self.path == "/health" else 404,
            {"status": "ready"} if self.path == "/health" else {"code": "NOT_FOUND"},
        )

    def do_POST(self):
        if self.path != "/parse":
            self.reply(404, {"code": "NOT_FOUND"})
            return
        if self.headers.get("Content-Type") != "application/json" or self.headers.get(
            "Transfer-Encoding"
        ):
            self.reply(415, {"code": "INVALID_REQUEST"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_REQUEST:
            self.reply(413, {"code": "SIZE_LIMIT"})
            return
        if not SLOTS.acquire(blocking=False):
            self.reply(503, {"code": "BUSY"})
            return
        try:
            with tempfile.TemporaryDirectory(prefix="wiser-parse-") as directory:
                try:
                    payload = json.loads(self.rfile.read(size))
                    path, kind, digest = prepare_request(payload, Path(directory))
                    del payload
                except (ParseError, ValueError, OSError) as error:
                    self.reply(
                        422,
                        {
                            "code": str(error)
                            if isinstance(error, ParseError)
                            else "INVALID_REQUEST"
                        },
                    )
                    return
                self.stream_parse(path, kind, digest)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        finally:
            SLOTS.release()

    def stream_parse(self, path, kind, digest):
        context = multiprocessing.get_context("spawn")
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(target=child_parse, args=(str(path), kind, sender))
        process.start()
        sender.close()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(
                encode_event(
                    {"type": "source", "sha256": digest, "parserVersion": "1.0.0"}
                )
            )
            deadline = time.monotonic() + MAX_SECONDS
            size = 0
            finished = False
            while time.monotonic() < deadline:
                if receiver.poll(1):
                    try:
                        line = receiver.recv_bytes(MAX_LINE)
                    except EOFError:
                        break
                    size += len(line)
                    if size > MAX_RESPONSE:
                        break
                    event = json.loads(line)
                    self.wfile.write(line)
                    if event["type"] in ("summary", "error"):
                        finished = True
                        break
                elif not process.is_alive():
                    break
            if not finished:
                self.wfile.write(
                    encode_event({"type": "error", "code": "CAPACITY_LIMIT"})
                )
        finally:
            receiver.close()
            if process.is_alive():
                process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()
                process.join(timeout=5)
            process.close()


def make_server(address):
    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    make_server(("0.0.0.0", 3005)).serve_forever()
