# Đồng hồ dùng chung; test gọi advance() để giả thời gian (lease hết hạn).
import time

_offset = 0.0


def now() -> float:
    return time.time() + _offset


def advance(seconds: float) -> None:
    global _offset
    _offset += seconds


def reset() -> None:
    global _offset
    _offset = 0.0
