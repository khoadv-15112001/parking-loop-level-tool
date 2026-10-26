# Build từ GỐC repo tool của game (cần levelcore/ + game/):  docker compose -f levelcore/deploy/docker-compose.yml build
# File của level-tool-core — game không sửa; gói pip riêng của game: game/server/requirements.txt (nếu có).
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 sqlite3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY levelcore/server/requirements.txt /tmp/req-core.txt
RUN pip install --no-cache-dir -r /tmp/req-core.txt
# layout giữ nguyên như repo: /app/levelcore (server, runner, web) + /app/game (plugin, validator, web riêng của game)
COPY levelcore/ /app/levelcore/
COPY game/ /app/game/
RUN if [ -f game/server/requirements.txt ]; then pip install --no-cache-dir -r game/server/requirements.txt; fi \
    && rm -rf levelcore/server/tests game/server/tests

# Mặc định như BI Center (volume /data → SBP_DATA_DIR: database <tool>.db + bản game WebGL ở /data/game).
# BI đặt lại SBP_* lúc chạy (SBP_SQLITE_PATH theo bi.yaml); docker compose local dùng luôn mặc định.
ENV SBP_DATA_DIR=/data \
    PYTHONPATH=/app/levelcore/server:/app/game/server \
    HOME=/tmp \
    PYTHONUNBUFFERED=1
# BI chạy container bằng user số, không phải root: /data (volume) phải ghi được bởi uid 10001
RUN mkdir -p /data && chown 10001:10001 /data
VOLUME /data
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"
# 1 worker là BẮT BUỘC: broker SSE + khoá ghi SQLite nằm trong tiến trình
CMD ["uvicorn", "--factory", "levelcore.main:get_app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "5"]
