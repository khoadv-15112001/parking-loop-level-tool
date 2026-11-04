# Luật game viết bằng JS (module `rules` trong game/manifest.json) cho server Python: một tiến trình node thường trú
# (levelcore/runner/game_runner.mjs), mỗi lần gọi là một lô qua stdin/stdout. Một khoá cho mỗi lô nên thread nào gọi
# cũng được; node chết hoặc treo quá `timeout` thì giết và lần gọi sau tự mở lại.
import collections
import itertools
import json
import queue
import subprocess
import threading
from pathlib import Path

from .errors import ApiError

RUNNER = Path(__file__).resolve().parents[2] / "runner" / "game_runner.mjs"


class JsRules:
    def __init__(self, module: str, node: str = "node", timeout: float = 60.0):
        self.module = str(module)
        self.node = node
        self.timeout = timeout
        self._proc: subprocess.Popen | None = None
        self._lines: queue.Queue | None = None
        self._stderr: collections.deque = collections.deque(maxlen=20)
        self._lock = threading.Lock()
        self._ids = itertools.count(1)
        self._missing: set[str] = set()

    def _start(self) -> None:
        try:
            self._proc = subprocess.Popen([self.node, str(RUNNER), self.module], stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except FileNotFoundError:
            raise ApiError(500, f"Không chạy được node ('{self.node}') cho luật của game — cài Node.js")
        self._lines = queue.Queue()
        threading.Thread(target=self._pump, args=(self._proc.stdout, self._lines), daemon=True).start()
        threading.Thread(target=self._drain, args=(self._proc.stderr,), daemon=True).start()

    @staticmethod
    def _pump(stream, lines: queue.Queue) -> None:
        for line in stream:
            lines.put(line)
        lines.put(None)

    def _drain(self, stream) -> None:
        for line in stream:
            self._stderr.append(line.decode("utf-8", "replace").rstrip())

    def _kill(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
            except OSError:
                pass
            self._proc = None

    def close(self) -> None:
        with self._lock:
            self._kill()

    def call(self, hook: str, items: list[list]) -> list | None:
        """Gọi `hook(*args)` cho từng args trong items → giá trị cùng thứ tự. None: module không export hook này."""
        if not items:
            return []
        if hook in self._missing:
            return None
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()
            rid = next(self._ids)
            line = json.dumps({"id": rid, "hook": hook, "items": items}, ensure_ascii=False, allow_nan=False) + "\n"
            try:
                self._proc.stdin.write(line.encode("utf-8"))
                self._proc.stdin.flush()
            except OSError:
                self._kill()
                raise ApiError(500, f"Luật game ({Path(self.module).name}) đã dừng: {self._tail()}")
            while True:
                try:
                    out = self._lines.get(timeout=self.timeout)
                except queue.Empty:
                    self._kill()
                    raise ApiError(504, f"{hook} của game chạy quá {self.timeout:.0f} giây")
                if out is None:
                    self._kill()
                    raise ApiError(500, f"Luật game ({Path(self.module).name}) đã dừng: {self._tail()}")
                msg = json.loads(out.decode("utf-8"))
                if msg.get("id") == rid:
                    break
        if msg.get("missing"):
            self._missing.add(hook)
            return None
        bad = next((r["error"] for r in msg["results"] if "error" in r), None)
        if bad is not None:
            raise ApiError(500, f"{hook} của game lỗi: {bad}")
        return [r.get("value") for r in msg["results"]]

    def one(self, hook: str, *args):
        """Một lần gọi; trả (có hook, giá trị)."""
        out = self.call(hook, [list(args)])
        return (False, None) if out is None else (True, out[0])

    def _tail(self) -> str:
        return " | ".join(self._stderr) or "không có log"
