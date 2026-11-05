import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from levelcore.db import DB


@pytest.fixture
def db(tmp_path):
    database = DB(str(tmp_path / "test.db"))
    yield database
    database.close()


def connection_batch(db, count=8):
    barrier = threading.Barrier(count)

    def request():
        connection = db.conn()
        barrier.wait(timeout=10)
        assert connection.execute("SELECT 1").fetchone()[0] == 1
        return connection

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(lambda _: request(), range(count)))


def assert_closed(connection):
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")


def test_replaced_workers_release_connections(db):
    main_connection = db.conn()
    previous = []
    for _ in range(16):
        current = connection_batch(db)
        for connection in previous:
            assert_closed(connection)
        assert db.conn() is main_connection
        assert main_connection.execute("SELECT 1").fetchone()[0] == 1
        previous = current
    db.close()
    for connection in previous:
        assert_closed(connection)


def test_live_worker_keeps_its_connection_during_cleanup(db):
    ready = threading.Event()
    release = threading.Event()

    def live_worker():
        connection = db.conn()
        ready.set()
        assert release.wait(timeout=10)
        assert db.conn() is connection
        return connection.execute("SELECT 1").fetchone()[0]

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(live_worker)
        try:
            assert ready.wait(timeout=10)
            connection_batch(db)
            connection_batch(db)
        finally:
            release.set()
        assert future.result(timeout=10) == 1


def test_close_reopens_thread_local_connections(db):
    main_connection = db.conn()
    ready = threading.Event()
    reopen = threading.Event()

    def live_worker():
        previous = db.conn()
        ready.set()
        assert reopen.wait(timeout=10)
        current = db.conn()
        assert current is not previous
        assert_closed(previous)
        assert current.execute("SELECT 1").fetchone()[0] == 1
        return current

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(live_worker)
        try:
            assert ready.wait(timeout=10)
            db.close()
            assert_closed(main_connection)
        finally:
            reopen.set()
        worker_connection = future.result(timeout=10)
    current = db.conn()
    assert current is not main_connection
    assert current.execute("SELECT 1").fetchone()[0] == 1
    assert_closed(worker_connection)
    db.close()
    db.close()
    assert_closed(current)
    assert db.conn().execute("SELECT 1").fetchone()[0] == 1


def test_write_commits_and_rolls_back_after_worker_replacement(db):
    db.conn().execute("CREATE TABLE probe(value INTEGER)")

    def write(value):
        with db.write() as connection:
            connection.execute("INSERT INTO probe VALUES (?)", (value,))

    for value in range(10):
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(write, value).result(timeout=10)
    with pytest.raises(RuntimeError, match="rollback"):
        with db.write() as connection:
            connection.execute("INSERT INTO probe VALUES (99)")
            raise RuntimeError("rollback")
    values = db.conn().execute("SELECT value FROM probe ORDER BY value").fetchall()
    assert [row[0] for row in values] == list(range(10))
