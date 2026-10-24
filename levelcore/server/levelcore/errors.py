class ApiError(Exception):
    """Lỗi trả thẳng cho client: status + body JSON (luôn có 'detail')."""

    def __init__(self, status: int, detail: str, **extra):
        super().__init__(detail)
        self.status = status
        self.body = {"detail": detail, **extra}
