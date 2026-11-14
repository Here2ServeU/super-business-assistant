"""SQLite store: audit log, pending approvals, usage and simple state."""
import json
import sqlite3
import time
from datetime import datetime


class Store:
    def __init__(self, path="sba.db"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS audit(ts REAL, actor TEXT, action TEXT, detail TEXT);
            CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT UNIQUE,
              thread_id TEXT, draft_id TEXT, sender TEXT, subject TEXT, summary TEXT, category TEXT,
              status TEXT, tg_msg_id INTEGER, created REAL);
            CREATE TABLE IF NOT EXISTS usage(month TEXT, tier TEXT, in_tok INTEGER, out_tok INTEGER, cost REAL);
            CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
            """
        )

    # audit
    def log(self, actor, action, detail=""):
        if not isinstance(detail, str):
            detail = json.dumps(detail)[:2000]
        self.db.execute("INSERT INTO audit VALUES(?,?,?,?)", (time.time(), actor, action, detail))
        self.db.commit()

    def recent_audit(self, n=20):
        return self.db.execute("SELECT * FROM audit ORDER BY ts DESC LIMIT ?", (n,)).fetchall()

    # pending approvals
    def seen(self, msg_id):
        return self.db.execute("SELECT 1 FROM pending WHERE msg_id=?", (msg_id,)).fetchone() is not None

    def add_pending(self, **row):
        cols = ",".join(row)
        q = ",".join("?" * len(row))
        cur = self.db.execute(f"INSERT INTO pending({cols},created) VALUES({q},?)", (*row.values(), time.time()))
        self.db.commit()
        return cur.lastrowid

    def get_pending(self, pid):
        return self.db.execute("SELECT * FROM pending WHERE id=?", (pid,)).fetchone()

    def update_pending(self, pid, **fields):
        sets = ",".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE pending SET {sets} WHERE id=?", (*fields.values(), pid))
        self.db.commit()

    def waiting(self):
        return self.db.execute("SELECT * FROM pending WHERE status='waiting' ORDER BY created").fetchall()

    def stats_since(self, ts):
        rows = self.db.execute("SELECT status, category, COUNT(*) n FROM pending WHERE created>=? GROUP BY status, category", (ts,)).fetchall()
        return [dict(r) for r in rows]

    # usage / budget
    def add_usage(self, tier, in_tok, out_tok, cost):
        self.db.execute("INSERT INTO usage VALUES(?,?,?,?,?)", (datetime.now().strftime("%Y-%m"), tier, in_tok, out_tok, cost))
        self.db.commit()

    def month_cost(self):
        r = self.db.execute("SELECT COALESCE(SUM(cost),0) c, COUNT(*) n FROM usage WHERE month=?", (datetime.now().strftime("%Y-%m"),)).fetchone()
        return float(r["c"]), int(r["n"])

    # key-value state
    def get(self, k, default=None):
        r = self.db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return json.loads(r["v"]) if r else default

    def set(self, k, v):
        self.db.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (k, json.dumps(v)))
        self.db.commit()
