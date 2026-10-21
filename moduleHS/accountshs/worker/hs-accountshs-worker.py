#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Worker cho AccountsHS trong HireX — chạy các việc cần curl_cffi / giả lập trình duyệt mà Node không làm được:
    · 'cyv'  : check live Facebook / FB Page / Bài đăng FB  (worker/checkfb.py · checkfbpage.py · checkfbpost.py)
    · 'owl'  : thu thập bài đăng Page                        (worker/owl_postfb.py)
    · 'crm'  : kéo dữ liệu CRM về + nạp vào các tab           (worker/crm.py · crm_parse.py)

Cách chạy (Windows host, như các worker khác của HireX):
    python moduleHS/accountshs/worker/hs-accountshs-worker.py          # đọc SUPABASE_DB_URL trong .env.local
Hàng đợi việc là bảng ahs_jobs (migration 120). Worker claim 1 job / 2s, ghi progress/result, Next đọc lại và áp dụng
(với 'cyv', Next ÁP DỤNG kết quả vào ahs_accounts; worker chỉ trả kết quả thô). Dừng được bằng cách Next đặt status='stopped'.
"""
import importlib.util
import json
import os
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))             # moduleHS/accountshs/worker
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))   # gốc repo HireX (.env.local, runtime/)
WORKER_DIR = HERE
POLL = 2.0
HEARTBEAT_EVERY = 15.0           # cập nhật nhịp sống (ahs_jobs kind='worker') để Next biết worker còn chạy
_hb_jid = [None]
_last_hb = [0.0]

try:
    import psycopg
    from psycopg.rows import tuple_row
except ImportError:
    print('[worker] Thiếu psycopg: pip install "psycopg[binary]"', file=sys.stderr)
    raise


# ───────── .env.local ─────────
def load_env():
    fp = os.path.join(ROOT, '.env.local')
    if not os.path.isfile(fp):
        return
    for line in open(fp, encoding='utf-8-sig'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


def db_url():
    for k in ('SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL'):
        v = os.environ.get(k)
        if v:
            return v
    raise SystemExit('[worker] Thiếu SUPABASE_DB_URL trong .env.local')


# ───────── nạp module trong worker/ ─────────
_MODS = {}


def load_mod(fname):
    if fname in _MODS:
        return _MODS[fname]
    path = os.path.join(WORKER_DIR, fname)
    spec = importlib.util.spec_from_file_location('hsw_' + fname[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _MODS[fname] = mod
    return mod


CYV_FILES = {'fb': 'checkfb.py', 'fbpage': 'checkfbpage.py', 'fbpost': 'checkfbpost.py'}


# ───────── tiện ích job ─────────
def jset(conn, jid, **cols):
    sets, vals = [], []
    for k, v in cols.items():
        if k in ('progress', 'result'):
            sets.append('%s=%%s::jsonb' % k)
            vals.append(json.dumps(v, ensure_ascii=False))
        else:
            sets.append('%s=%%s' % k)
            vals.append(v)
    vals.append(jid)
    with conn.cursor() as cur:
        cur.execute('update ahs_jobs set %s where id=%%s' % ','.join(sets), vals)
    conn.commit()


def jstatus(conn, jid):
    with conn.cursor() as cur:
        cur.execute('select status from ahs_jobs where id=%s', (jid,))
        r = cur.fetchone()
    return r[0] if r else 'stopped'


def heartbeat(conn, force=False):
    """Giữ 1 dòng ahs_jobs kind='worker': cột started = lần nhịp gần nhất. Next đọc để báo "chưa có worker" khi nhịp quá 60s."""
    if not force and time.time() - _last_hb[0] < HEARTBEAT_EVERY:
        return
    _last_hb[0] = time.time()
    try:
        with conn.cursor() as cur:
            if _hb_jid[0] is None:
                cur.execute("select id from ahs_jobs where kind='worker' order by id limit 1")
                r = cur.fetchone()
                if r:
                    _hb_jid[0] = r[0]
                else:
                    cur.execute("insert into ahs_jobs(kind,status,started,created,by) values('worker','running',%s,%s,'worker') returning id", (time.time(), time.time()))
                    _hb_jid[0] = cur.fetchone()[0]
            else:
                cur.execute("update ahs_jobs set started=%s, status='running' where id=%s", (time.time(), _hb_jid[0]))
        conn.commit()
    except Exception:  # noqa
        try:
            conn.rollback()
        except Exception:
            pass


def claim(conn):
    with conn.cursor(row_factory=tuple_row) as cur:
        cur.execute("update ahs_jobs set status='running', started=%s, by='worker' "
                    "where id=(select id from ahs_jobs where status='queued' order by id limit 1 for update skip locked) "
                    "returning id, kind, payload", (time.time(),))
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    jid, kind, payload = row
    return {'id': jid, 'kind': kind, 'payload': payload or {}}


# ───────── 'cyv': check FB (worker chỉ trả kết quả thô, Next áp dụng) ─────────
def run_cyv(conn, job):
    jid, p = job['id'], job['payload']
    cid = p.get('cid')
    mod = load_mod(CYV_FILES[cid])
    items = p.get('items') or []
    opt = dict(p.get('opt') or {})
    total = len(items)
    stop = {'v': False}
    opt['stopped'] = lambda: stop['v']
    results, lock, done = [], threading.Lock(), {'n': 0}
    last_flush = [0.0]

    def flush(force=False):
        if not force and time.time() - last_flush[0] < 1.5:
            return
        last_flush[0] = time.time()
        with lock:
            prog = {'done': done['n'], 'total': total, 'ts': time.time()}
            jset(conn, jid, progress=prog, result=list(results))
        if jstatus(conn, jid) == 'stopped':
            stop['v'] = True

    def one(it):
        if stop['v']:
            return
        try:
            o = dict(opt)
            if it.get('have'):
                o['have'] = it['have']
            r = mod.check(it['value'], o)
            res, info = r[0], r[1]
            extra = r[2] if len(r) > 2 and isinstance(r[2], dict) else None
        except Exception as e:  # noqa
            res, info, extra = 'error', str(e)[:80], None
        with lock:
            results.append({'id': it['id'], 'res': res, 'info': str(info or ''), 'extra': extra})
            done['n'] += 1
        flush()

    threads = max(1, min(int((mod.CHECKER.get('threads') or 5)), 16))
    jset(conn, jid, progress={'done': 0, 'total': total, 'ts': time.time()})
    with ThreadPoolExecutor(max_workers=threads) as ex:
        list(ex.map(one, items))
    st = 'stopped' if stop['v'] else 'done'
    jset(conn, jid, status=st, result=list(results), progress={'done': done['n'], 'total': total, 'ts': time.time()}, finished=time.time())


# ───────── 'owl': thu thập bài (owl_postfb) — ghi rows/logs vào progress ─────────
class OwlCtx:
    def __init__(self, conn, jid):
        self.conn, self.jid = conn, jid
        self.rows, self.logs, self.status_s = [], [], 'Bắt đầu…'
        self._stop = False
        self._last = 0.0

    def _refresh_stop(self):
        if jstatus(self.conn, self.jid) in ('stopped', 'failed'):
            self._stop = True

    def emit(self, rows):
        sid = getattr(self, 'src', None)
        for r in rows:
            if isinstance(r, dict) and sid is not None:
                r.setdefault('_src', sid)
        self.rows.extend(rows)
        self.flush(True)

    def log(self, msg, kind='info'):
        self.logs.append({'t': time.strftime('%H:%M:%S'), 'msg': str(msg), 'kind': kind})
        self.flush(True)

    def status(self, s):
        self.status_s = str(s)
        self.flush()

    def stopped(self):
        self._refresh_stop()
        return self._stop

    def sleep(self, s):
        end = time.time() + max(0, s)
        while time.time() < end and not self.stopped():
            time.sleep(0.1)

    def save_raw(self, name, text):
        pass

    def flush(self, force=False):
        if not force and time.time() - self._last < 1.0:
            return
        self._last = time.time()
        jset(self.conn, self.jid, progress={'status': self.status_s, 'rows': self.rows, 'logs': self.logs, 'ts': time.time()})


OWL_FILES = {'fb_page_group_posts': 'owl_postfb.py'}


def run_owl(conn, job):
    jid, p = job['id'], job['payload']
    mod = load_mod(OWL_FILES[p.get('script')])
    sources = p.get('sources') or []
    params = dict(p.get('params') or {})
    gap = float((params.get('page_gap') or (p.get('defaults') or {}).get('page_gap') or 4))
    ctx = OwlCtx(conn, jid)
    try:
        for i, src in enumerate(sources):
            if ctx.stopped():
                break
            ctx.status('Nguồn %d/%d: %s' % (i + 1, len(sources), src.get('label', '')))
            if not src.get('cookie'):
                ctx.log('%s: không lấy được cookie' % src.get('label', ''), 'warn')
                continue
            try:
                ctx.src = src.get('id')
                mod.run(ctx, src, params)
            except getattr(mod, 'Fail', Exception) as e:
                ctx.log('%s: %s' % (src.get('label', ''), e), 'err')
            except Exception as e:  # noqa
                ctx.log('%s: lỗi %s' % (src.get('label', ''), e), 'err')
                traceback.print_exc()
            if gap and i < len(sources) - 1 and not ctx.stopped():
                ctx.sleep(gap)
        ctx.status('Xong · %d dòng%s' % (len(ctx.rows), ' · đã dừng' if ctx.stopped() else ''))
    except Exception as e:  # noqa
        ctx.status('Lỗi: %s' % e)
        traceback.print_exc()
    ctx.flush(True)
    jset(conn, jid, status=('stopped' if ctx._stop else 'done'), finished=time.time())


# ───────── 'crm': fetch + nạp (dùng crm.py qua shim psycopg) ─────────
def run_crm(conn, job):
    from _pgshim import PgApp  # noqa
    jid, p = job['id'], job['payload']
    app = PgApp(db_url())          # kết nối RIÊNG (loader jsonb→text) — không đụng conn dùng chung của worker
    crm = load_mod('crm.py')
    crm.APP = app
    # crm_parse được crm.py tự nạp tương đối; đảm bảo cùng thư mục worker/ nằm trong sys.path (đã thêm ở main)
    def progress(phase, done=0, total=0, err=''):
        jset(conn, jid, progress={'phase': phase, 'done': done, 'total': total, 'err': err, 'ts': time.time()})
    try:
        rows = p.get('rows')
        if rows is None:
            c = crm.cfg_get()
            if not (c.get('token') or '').strip():
                raise ValueError('Chưa có token CRM')
            progress('Đang lấy dữ liệu')
            rows = crm.fetch_all(c, lambda n, t: progress('Đang lấy dữ liệu', n, t))
        if p.get('fetch_only'):
            jset(conn, jid, status='done', result={'rows': len(rows)}, progress={'phase': 'Đã lấy', 'done': len(rows), 'total': len(rows), 'ts': time.time()}, finished=time.time())
            return
        progress('Đang nạp', 0, len(rows))
        res = crm.run_import(rows, 'file' if p.get('rows') is not None else 'api', bool(p.get('force')))
        jset(conn, jid, status='done', result=res, progress={'phase': 'Xong', 'done': res.get('rows', 0), 'total': res.get('rows', 0), 'ts': time.time()}, finished=time.time())
        app.close()
    except Exception as e:  # noqa
        try:
            app.close()
        except Exception:
            pass
        try:
            conn.rollback()
        except Exception:
            pass
        traceback.print_exc()
        jset(conn, jid, status='failed', progress={'phase': 'Lỗi', 'err': str(e), 'ts': time.time()}, finished=time.time())


DISPATCH = {'cyv': run_cyv, 'owl': run_owl, 'crm': run_crm}


TICK_EVERY = 300                       # gọi /api/hs/accountshs/internal/tick mỗi 5 phút (sao lưu tự động, Vọng gác định kỳ, dọn lịch sử)
_last_tick = [0.0]


def tick():
    """Thay luồng nền bk_loop/_sched của v7.py: nhờ Next chạy việc định kỳ (Next giữ logic + quyền ghi)."""
    if time.time() - _last_tick[0] < TICK_EVERY:
        return
    _last_tick[0] = time.time()
    secret = os.environ.get('AUTOMATION_CRON_SECRET', '').strip()
    if not secret:
        return
    base = os.environ.get('HIREX_LOCAL_URL', 'http://127.0.0.1:3000').rstrip('/')
    try:
        import urllib.request
        req = urllib.request.Request(base + '/api/hs/accountshs/internal/tick', data=b'{}', method='POST',
                                     headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()
    except Exception as e:  # noqa — web chưa chạy / đang deploy: lần sau thử lại
        print('[worker] tick lỗi: %s' % e, file=sys.stderr)


def main():
    load_env()
    sys.path.insert(0, WORKER_DIR)
    sys.path.insert(0, HERE)
    url = db_url()
    print('[worker] AccountsHS worker: kết nối DB, poll %.1fs' % POLL)
    _hb_jid[0] = None
    while True:
        try:
            conn = psycopg.connect(url, autocommit=False)
        except Exception as e:  # noqa
            print('[worker] không kết nối được DB: %s (thử lại sau 5s)' % e, file=sys.stderr)
            time.sleep(5)
            continue
        try:
            while True:
                heartbeat(conn)
                job = None
                try:
                    job = claim(conn)
                except Exception:  # noqa
                    conn.rollback()
                    traceback.print_exc()
                if not job:
                    tick()
                    time.sleep(POLL)
                    continue
                print('[worker] job #%s kind=%s' % (job['id'], job['kind']))
                fn = DISPATCH.get(job['kind'])
                if not fn:
                    jset(conn, job['id'], status='failed', progress={'err': 'kind không hỗ trợ: %s' % job['kind']}, finished=time.time())
                    continue
                try:
                    fn(conn, job)
                except Exception as e:  # noqa
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    traceback.print_exc()
                    try:
                        jset(conn, job['id'], status='failed', progress={'err': str(e), 'ts': time.time()}, finished=time.time())
                    except Exception:
                        pass
        except Exception:  # noqa
            traceback.print_exc()
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(3)


if __name__ == '__main__':
    main()
