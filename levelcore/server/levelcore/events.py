# Broker SSE trong tiến trình (uvicorn chạy 1 worker). publish() gọi được từ thread bất kỳ.
import asyncio
import itertools
import json
import threading
from collections import Counter

from . import clock


class Subscriber:
    def __init__(self, user: str, loop: asyncio.AbstractEventLoop, client: str | None = None):
        self.user = user
        self.loop = loop
        self.client = client   # mã tab (?client=) — SSE đứt thì xoá "Hoạt động" của tab đó (activity.py)
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=2000)


class Broker:
    def __init__(self):
        self._subs: set[Subscriber] = set()
        self._online: Counter = Counter()
        self._lock = threading.Lock()
        self._ids = itertools.count(1)

    def online(self) -> list[str]:
        with self._lock:
            return sorted(u for u, n in self._online.items() if n > 0)

    def format(self, type_: str, data: dict) -> str:
        payload = json.dumps({"type": type_, "ts": clock.now(), **data}, ensure_ascii=False)
        return f"id: {next(self._ids)}\nevent: {type_}\ndata: {payload}\n\n"

    def has_client(self, user: str, client: str) -> bool:
        """Tab này còn SSE nào khác đang mở không (kết nối lại chồng lên kết nối cũ chưa dọn)."""
        with self._lock:
            return any(s.user == user and s.client == client for s in self._subs)

    def subscribe(self, user: str, client: str | None = None) -> Subscriber:
        sub = Subscriber(user, asyncio.get_running_loop(), client)
        with self._lock:
            self._online[user] += 1
            changed = self._online[user] == 1
        if changed:  # báo người khác trước; chính mình nhận snapshot ở đầu stream
            self.publish("presence", {"online": self.online(), "joined": user})
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            if sub not in self._subs:
                return
            self._subs.discard(sub)
            self._online[sub.user] -= 1
            changed = self._online[sub.user] <= 0
            if changed:
                del self._online[sub.user]
        if changed:
            self.publish("presence", {"online": self.online(), "left": sub.user})

    def publish(self, type_: str, data: dict, *, private: dict | None = None, can_see=None) -> None:
        """`private` + `can_see(user)`: người được phép nhận {**data, **private}, người còn lại chỉ nhận `data` (token
        link playtest, danh sách admin — rà soát bảo mật 30/9/2026)."""
        msg = self.format(type_, data)
        full = self.format(type_, {**data, **private}) if private is not None and can_see is not None else None
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            m = full if full is not None and can_see(s.user) else msg
            try:
                s.loop.call_soon_threadsafe(self._put, s, m)
            except RuntimeError:  # loop đã đóng
                pass

    @staticmethod
    def _put(s: Subscriber, msg: str) -> None:
        try:
            s.queue.put_nowait(msg)
        except asyncio.QueueFull:  # client quá chậm: bỏ event, client tự refetch khi reconnect
            pass
