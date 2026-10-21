# -*- coding: utf-8 -*-
"""Lớp đệm psycopg cho crm.py (viết theo API sqlite3 của bản gốc) chạy trên Postgres (Supabase).

crm.py dùng:  APP.db.execute(sql, params).fetchone()/.fetchall()/.lastrowid/.rowcount · APP.db.commit()/rollback()
              APP.LOCK (context manager) · APP.log() · APP.do_backup() · APP.del_accounts_ids()
Shim này DỊCH từng câu SQL kiểu SQLite → Postgres (bảng ahs_*, '?'→'%s', insert-or-replace/ignore, json_extract→->>,
'' rỗng, cast data::jsonb, RETURNING id cho lastrowid). Bộ câu SQL của crm.py cố định nên bản dịch này đủ dùng.
Lưu ý: chưa chạy thử trên Postgres thật — xem NOTES-WORKER.md."""
import json
import re
import threading
import time

import psycopg
from psycopg.adapt import Loader

_TABLES = ('settings', 'tabs', 'fields', 'statuses', 'depts', 'owners', 'accounts', 'links', 'devices')
_TBL_RE = re.compile(r'\b(from|into|update|join)\s+(' + '|'.join(_TABLES) + r')\b', re.I)
_JE_RE = re.compile(r'json_extract\(\s*data\s*,\s*\?\s*\)', re.I)
_INS_ID_RE = re.compile(r'^\s*insert\s+into\s+ahs_(tabs|fields|statuses|depts|owners|accounts|devices)\b', re.I)
_PATH_RE = re.compile(r'^\$\."?(\d+)"?$')


def _translate(sql):
    s = sql
    s = _TBL_RE.sub(lambda m: '%s ahs_%s' % (m.group(1), m.group(2).lower()), s)
    s = _JE_RE.sub('(data ->> ?)', s)
    s = s.replace('""', "''")
    s = s.replace('cast(created as int)', 'floor(created)')
    s = re.sub(r'insert\s+or\s+replace\s+into\s+ahs_settings\(k,v\)\s*values\(\?,\?\)',
               'insert into ahs_settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v', s, flags=re.I)
    s = re.sub(r'insert\s+or\s+ignore\s+into\s+ahs_links\(src,dst,field_id\)\s*values\(\?,\?,\?\)',
               'insert into ahs_links(src,dst,field_id) values(?,?,?) on conflict(src,dst,field_id) do nothing', s, flags=re.I)
    # tài khoản: giá trị data (vị trí thứ 6) phải ép ::jsonb
    s = s.replace('values(?,?,?,?,?,?,?,?)', 'values(?,?,?,?,?,?::jsonb,?,?)')
    s = s.replace('data=?', 'data=?::jsonb')
    # RETURNING id để lấy lastrowid (các bảng có id; KHÔNG áp cho links / settings)
    if _INS_ID_RE.match(s) and 'returning' not in s.lower():
        s = s.rstrip().rstrip(';') + ' returning id'
    s = s.replace('?', '%s')
    return s


def _fix_params(params):
    out = []
    for p in (params or ()):
        if isinstance(p, str):
            m = _PATH_RE.match(p)
            if m:
                out.append(m.group(1))
                continue
        out.append(p)
    return out


class _JsonbText(Loader):
    def load(self, data):
        if data is None:
            return None
        return data.decode() if isinstance(data, (bytes, bytearray, memoryview)) else data


def _row_factory(cur):
    cols = [c.name for c in (cur.description or [])]

    def make(values):
        return _Row(cols, values)
    return make


class _Row(dict):
    def __init__(self, cols, vals):
        super().__init__(zip(cols, vals))
        self._vals = list(vals)

    def __getitem__(self, k):
        if isinstance(k, int):
            return self._vals[k]
        return dict.__getitem__(self, k)


class _Res:
    def __init__(self, rows, lastrowid, rowcount):
        self._rows = rows
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


class PgDB:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        tsql = _translate(sql)
        tparams = _fix_params(params)
        low = tsql.lstrip().lower()
        with self.conn.cursor(row_factory=_row_factory) as cur:
            cur.execute(tsql, tparams if tparams else None)
            rows, last = [], None
            if 'returning id' in low:
                r = cur.fetchone()
                last = r[0] if r else None
            elif low.startswith('select') or low.startswith('with') or ' returning ' in low:
                rows = cur.fetchall()
            return _Res(rows, last, cur.rowcount)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()


class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class PgApp:
    """app giả cho crm.py: mở KẾT NỐI RIÊNG (đăng ký loader jsonb→text để json.loads chạy được)."""
    def __init__(self, url):
        self.conn = psycopg.connect(url, autocommit=False)
        self.conn.adapters.register_loader('jsonb', _JsonbText)
        self.db = PgDB(self.conn)
        self.LOCK = _NullLock()

    def j(self, o):
        return json.dumps(o, ensure_ascii=False)

    def log(self, act, n=1, detail=''):
        try:
            self.conn.cursor().execute('insert into ahs_logs(ts,act,n,detail) values(%s,%s,%s,%s)', (time.time(), act, n, str(detail)[:400]))
            self.conn.commit()
        except Exception:
            pass

    def do_backup(self, kind='safe'):
        # Sao lưu do phía Next quản (Supabase Storage); worker bỏ qua, chỉ ghi nhật ký.
        self.log('crm_backup_skip', 0, 'worker bỏ qua sao lưu (%s)' % kind)

    def del_accounts_ids(self, ids):
        ids = [int(i) for i in ids]
        ts = time.time()
        with self.conn.cursor() as cur:
            for k in range(0, len(ids), 500):
                ch = ids[k:k + 500]
                ph = ','.join(['%s'] * len(ch))
                cur.execute('delete from ahs_links where src in (%s) or dst in (%s)' % (ph, ph), ch + ch)
                cur.execute('insert into ahs_tomb(id,ts,tab_id,dept_id,owner_id) select id,%%s,tab_id,dept_id,owner_id from ahs_accounts where id in (%s)' % ph, [ts] + ch)
                cur.execute('delete from ahs_accounts where id in (%s)' % ph, ch)
        self.conn.commit()

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass
