"""
CRM → AccountsHS  (module tùy chọn, nạp qua install(app) như checker/ và owl/)   —   v2

Nguyên tắc: mỗi TÀI KHOẢN THẬT là đúng 1 dòng ở đúng tab, khóa theo định danh thật của nó:
    Facebook = UID · FB Page = UID Page · Email = địa chỉ · SĐT = số · Zalo / WhatsApp = SĐT đăng nhập (chữ, hiện ngay trên bảng)
    LinkedIn = link profile · Telegram = Username (hoặc SĐT) · thiết bị = tên/serial
Một bản ghi CRM thường là "cụm" (SIM + Zalo + mail xác minh + FB…) nên được TÁCH ra nhiều dòng, nối bằng LIÊN KẾT:
    FB.Email xác minh / SĐT xác minh · Email.Email khôi phục / SĐT khôi phục · Zalo.SĐT đăng nhập ≠ SĐT liên kết …
Không có trường "mã CRM", "cấp", "vai trò"… — chỉ dữ liệu quản trị thật. Lịch sử (chuyển owner, đổi tên Page, tình trạng SIM)
nằm trong Ghi chú (sau vạch ── CRM ──, không chứa mật khẩu). Chạy lại nhiều lần không trùng.
"""
import importlib.util
import json
import os
import re
import threading
import time
import traceback
import unicodedata
import urllib.error
import urllib.request

APP = None
SKEY, SEEN, LAST = 'crm.cfg', 'crm.seen', 'crm.last'
VERSION = 2
MARK = '── CRM ──'

_p = importlib.util.spec_from_file_location('crm_parse', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crm_parse.py'))
PR = importlib.util.module_from_spec(_p)
_p.loader.exec_module(PR)

DEFAULT_URL = os.environ.get('HS_CRM_URL', '').strip()   # cấu hình trong CRM › Cài đặt (crm.cfg) hoặc biến HS_CRM_URL
DEFAULT_BODY = {
    "keyword": "", "location": "", "skillId": [], "isCheck": None, "userName": None, "userIdTask": [],
    "checkTask": 0, "allFlag": True, "checkRole": True, "startDate": "", "endDate": "", "blockId": None,
    "checkPartner": 0, "rank": None, "rankId": None, "contact": None, "contactId": None, "legalId": None,
    "legal": None, "contract": None, "checkEmail": None, "dateSendEmail": "", "rateEmailId": [],
    "rateZaloId": [], "ratePhoneId": [], "rateLinkedinId": [], "rateFaceBookId": [],
    "rateComboUvId": [95046, 200365], "rateAmId": [], "rateAmId2": [], "exportById": 0, "ageUv": None,
    "yearsOfExp": None, "salary": None, "foreignLanguages": None, "managementRank": None,
    "skillTech": None, "certificates": None,
}

# Mỗi tab: trường cần có (khóa → (nhãn, kiểu, [tên khác chấp nhận], tab liên kết, đứng sau trường nào))
SPEC = {
    'Facebook': dict(icon='b_facebook', grp='Tài khoản', fields=[
        ('uid', 'UID', 'text', ['UID', 'ID']), ('name', 'Tên FB', 'text', ['Tên FB', 'Tên'], None, 'uid'),
        ('login', 'Đăng nhập', 'text', ['Đăng nhập', 'Tài khoản đăng nhập'], None, 'name'),
        ('pass', 'Mật khẩu', 'secret', ['Mật khẩu', 'Password']), ('twofa', '2FA', 'secret', ['2FA']), ('cookie', 'Cookie', 'text', ['Cookie']),
        ('vmail', 'Email xác minh', 'link', ['Email xác minh'], 'Email'), ('vphone', 'SĐT xác minh', 'link', ['SĐT xác minh'], 'SĐT'),
        ('url', 'Link profile', 'url', ['Link profile', 'Link'])]),
    'FB Page': dict(icon='b_fbpage', grp='Tài khoản', fields=[
        ('uid', 'UID Page', 'text', ['UID Page']), ('name', 'Tên Page', 'text', ['Tên Page']),
        ('admin', 'UID Admin', 'link', ['UID Admin'], 'Facebook'), ('cat', 'Danh mục', 'select', ['Danh mục']),
        ('url', 'Link Page', 'url', ['Link Page', 'Link'])]),
    'Email': dict(icon='b_gmail', grp='', fields=[
        ('email', 'Email', 'text', ['Email']), ('pass', 'Mật khẩu', 'secret', ['Mật khẩu']),
        ('rmail', 'Email khôi phục', 'link', ['Email khôi phục'], 'Email'), ('rphone', 'SĐT khôi phục', 'link', ['SĐT khôi phục'], 'SĐT'),
        ('type', 'Loại', 'select', ['Loại'])]),
    'SĐT': dict(icon='phone', grp='', fields=[
        ('num', 'Số', 'text', ['Số', 'SĐT']), ('carrier', 'Nhà mạng', 'select', ['Nhà mạng']),
        ('owner', 'Chủ sim', 'text', ['Chủ sim']), ('pass', 'Mật khẩu', 'secret', ['Mật khẩu'])]),
    'Zalo': dict(icon='b_zalo', grp='Tài khoản', fields=[
        ('login', 'SĐT đăng nhập', 'text', ['SĐT đăng nhập']), ('linked', 'SĐT liên kết', 'link', ['SĐT liên kết'], 'SĐT'),
        ('name', 'Tên Zalo', 'text', ['Tên Zalo']), ('pass', 'Mật khẩu', 'secret', ['Mật khẩu']),
        ('vmail', 'Email xác minh', 'link', ['Email xác minh'], 'Email')]),
    'WhatsApp': dict(icon='b_whatsapp', grp='Tài khoản', fields=[                       # CRM: "TÊN TK - … / ID ĐĂNG NHẬP - … / MÃ PIN - … / SĐT - …"
        ('login', 'SĐT đăng nhập', 'text', ['SĐT đăng nhập']), ('name', 'Tên', 'text', ['Tên']),
        ('linked', 'SĐT liên kết', 'link', ['SĐT liên kết'], 'SĐT')]),
    'LinkedIn': dict(icon='b_linkedin', grp='', fields=[
        ('name', 'Tên', 'text', ['Tên']), ('email', 'Email đăng nhập', 'link', ['Email đăng nhập'], 'Email'),
        ('pass', 'Mật khẩu', 'secret', ['Mật khẩu']), ('url', 'Link profile', 'url', ['Link profile']),
        ('twofa', '2FA', 'secret', ['2FA']), ('vmail', 'Email xác minh', 'link', ['Email xác minh'], 'Email')]),
    'Telegram': dict(icon='b_telegram', grp='', fields=[
        ('user', 'Username', 'text', ['Username']), ('name', 'Tên', 'text', ['Tên']),
        ('phone', 'SĐT', 'link', ['SĐT'], 'SĐT'), ('twofa', '2FA', 'secret', ['2FA']), ('url', 'Link t.me', 'url', ['Link t.me'])]),
}
DEFAULT_STATUS = [('Live', '#10b981'), ('Die', '#ef4444')]
DIE_WORDS = ('die', 'mất', 'chết')
V1_FIELDS = ('Mã CRM', 'Token', 'Cấp', 'Xác minh', 'Vai trò TK', 'Tên cũ', 'STT', 'Sóng', 'Có Zalo')


def gs(k):
    r = APP.db.execute('select v from settings where k=?', (k,)).fetchone()
    try:
        return json.loads(r[0]) if r else None
    except Exception:
        return None


def ss(k, v):
    APP.db.execute('insert or replace into settings(k,v) values(?,?)', (k, json.dumps(v, ensure_ascii=False)))


JOB = {'running': False, 'phase': '', 'done': 0, 'total': 0, 'err': ''}


def nz(s):
    s = unicodedata.normalize('NFD', str(s or '').lower().replace('đ', 'd'))
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in s if unicodedata.category(c) != 'Mn'))


def j(o):
    return json.dumps(o, ensure_ascii=False)


def date_ts(d):
    try:
        return time.mktime(time.strptime(str(d)[:10], '%Y-%m-%d'))
    except Exception:
        return None


# ───────────────────────── suy diễn nhỏ ─────────────────────────
_CARRIER = [
    ('Viettel', ('032', '033', '034', '035', '036', '037', '038', '039', '086', '096', '097', '098')),
    ('Mobifone', ('070', '076', '077', '078', '079', '089', '090', '093')),
    ('Vinaphone', ('081', '082', '083', '084', '085', '088', '091', '094')),
    ('Vietnamobile', ('052', '056', '058', '092')),
    ('Gmobile', ('059', '099')), ('Itel', ('087',)), ('Wintel', ('055',)),
]


def carrier_of(num):
    for n, pre in _CARRIER:
        if num[:3] in pre:
            return n
    return ''


def mail_type(addr):
    d = addr.split('@')[-1].lower()
    if d == 'gmail.com' or d == 'googlemail.com':
        return 'Gmail'
    if re.match(r'(outlook|hotmail|live|msn)\.', d):
        return 'Outlook'
    if d.startswith('yahoo.'):
        return 'Yahoo'
    if re.match(r'(proton\.me|protonmail\.)', d):
        return 'Proton'
    if d.startswith('tuta') or d == 'tutanota.com':
        return 'Tuta'
    if d.startswith('runbox'):
        return 'Runbox'
    return 'Domain'


def li_url(u):
    u = (u or '').strip()
    m = re.search(r'linkedin\.com/(in|pub)/([^/?#\s]+)', u, re.I)
    return 'https://www.linkedin.com/in/%s' % m.group(2) if m else ''


def clean_title(n):
    n = re.sub(r'^\s*\d+\s*[.)]\s*', '', n or '').strip()
    return n


GENERIC = re.compile(r'^(email|e-?mail|sdt|sđt|zalo|máy|page)\s*(mới)?\s*\d*$', re.I)


def uid_of(r):
    u = str(r.get('uuidFaceBook') or '').strip()
    if re.fullmatch(r'\d{8,}', u):
        return u
    m = re.search(r'(?:[?&]id=|facebook\.com/(?:profile\.php\?id=)?)(\d{8,})', r.get('linkFacebook') or '')
    return m.group(1) if m else ''


# ───────────────────────── owner / bộ phận ─────────────────────────
def split_emp(e):
    """'Rec Intalent J3: Đỗ Quang Hải' → (bộ phận, người|None).  Kho chung (Bộ phận R&D, Boxphone…) → không có người."""
    e = (e or '').strip()
    m = re.match(r'^Rec Intalent J\d+:\s*(.+)$', e)
    if m:
        return 'Tuyển dụng', m.group(1).strip()
    m = re.match(r'^Rec nguồn:\s*[^:]*:\s*(.+)$', e, re.I)
    if m:
        return 'Tuyển dụng', m.group(1).strip()
    m = re.match(r'^Sale Intalent:\s*(?:Leader\s*-\s*)?(.+)$', e)
    if m:
        return 'Sale', m.group(1).strip()
    m = re.match(r'^Parttime (\d+)(?:\s*-\s*(.+))?$', e)
    if m:
        return 'Cộng tác viên', ('Parttime %s · %s' % (m.group(1), m.group(2).strip())) if m.group(2) else 'Parttime ' + m.group(1)
    m = re.match(r'^Chat bot\s*(\d+)_?\s*(.*?)(?:\s+R&D)?$', e, re.I)
    if m:
        return 'R&D', ('Chat bot %s · %s' % (m.group(1), m.group(2).strip())).strip(' ·')
    if re.match(r'^Comment\s*\d+', e):
        return 'R&D', e
    if e == 'Bộ phận R&D':
        return 'R&D', None
    if e.endswith(' R&D'):
        return 'R&D', e[:-4].strip()
    if e in ('Boxphone', 'KB UID', 'CEO', ''):
        return 'Hệ thống', None
    return 'Khác', e


def v1_names(e):
    """Tên nhóm/người mà bản nhập v1 đã tạo (để dọn nếu rỗng)."""
    e = (e or '').strip()
    m = re.match(r'^(Rec Intalent J\d+):\s*(.+)$', e)
    if m:
        return [m.group(1), m.group(2)]
    m = re.match(r'^Rec nguồn:\s*(JP \d+)[^:]*:\s*(.+)$', e, re.I)
    if m:
        return ['Rec nguồn ' + m.group(1).upper(), m.group(2)]
    m = re.match(r'^(Sale Intalent):\s*(.+)$', e)
    if m:
        return [m.group(1), m.group(2)]
    m = re.match(r'^Parttime (\d+)(?:\s*-\s*(.+))?$', e)
    if m:
        return [('Parttime %s · %s' % (m.group(1), m.group(2))) if m.group(2) else 'Parttime ' + m.group(1)]
    return [e] if e else []


# ───────────────────────── phân loại bản ghi ─────────────────────────
def record_kind(r):
    n = r.get('chatName') or ''
    if re.match(r'^MÁY\s*\d', n) or r.get('empName') == 'Boxphone':
        return 'device'
    if str(r.get('rateFaceBookId') or '') == '200404':
        return 'page'
    if r.get('linkFacebook') or uid_of(r):
        return 'fb'
    if re.match(r'^Email', n) and not r.get('phoneNumber'):
        return 'email'
    if r.get('phoneNumber'):
        return 'phone'
    if r.get('linkLinkedin'):
        return 'li'
    if r.get('email'):
        return 'email'
    return 'unknown'


# ───────────────────────── nạp vào DB ─────────────────────────
class Loader:
    def __init__(self, app, rows, force=False):
        self.force, self.A, self.db, self.rows = force, app, app.db, rows
        self.now = time.time()
        self.tab, self.fld, self.stat, self.idx = {}, {}, {}, {}
        self.dept_c, self.own_c = {}, {}
        self.touched = {}                       # tab → {khóa} đã gặp trong lần chạy (đối soát)
        self.new_ids = set()
        self.derived_ids = set()
        self.res = {'v': VERSION, 'created': {}, 'updated': {}, 'derived': {}, 'merged': 0, 'skipped': 0, 'links': 0, 'devices': 0,
                    'kinds': {}, 'warn': [], 'owners': 0, 'fields': 0, 'tabs': 0, 'cleaned': {}}

    def warn(self, m):
        if len(self.res['warn']) < 80:
            self.res['warn'].append(m)

    def q(self, sql, a=()):
        return [dict(x) for x in self.db.execute(sql, a).fetchall()]

    # --- cấu trúc ---
    def tab_id(self, name):
        if name in self.tab:
            return self.tab[name]
        t = next((x for x in self.q('select id,name from tabs') if nz(x['name']) == nz(name)), None)
        if t is None:
            sp = SPEC[name]
            pos = self.db.execute('select coalesce(max(pos),0)+1 from tabs').fetchone()[0]
            tid = self.db.execute('insert into tabs(name,icon,color,pos,grp,lazy,tint) values(?,?,?,?,?,0,0)',
                                  (name, sp['icon'], '#667085', pos, sp.get('grp', ''))).lastrowid
            for i, (l, c) in enumerate(DEFAULT_STATUS, 1):
                self.db.execute('insert into statuses(tab_id,label,color,pos) values(?,?,?,?)', (tid, l, c, i))
            self.res['tabs'] += 1
        else:
            tid = t['id']
        self.tab[name] = tid
        return tid

    def field(self, tab, key):
        k = (tab, key)
        if k in self.fld:
            return self.fld[k]
        tid = self.tab_id(tab)
        sp = next(x for x in SPEC[tab]['fields'] if x[0] == key)
        cur = self.q('select id,label,type,link_tab,pos from fields where tab_id=? order by pos,id', (tid,))
        want = {nz(a) for a in sp[3]}
        f = next((x for x in cur if nz(x['label']) in want), None)
        if f is None:
            lt = self.tab_id(sp[4]) if len(sp) > 4 and sp[4] else None
            after = sp[5] if len(sp) > 5 else None
            pos = None
            if after:
                af = self.field(tab, after)
                pa = self.db.execute('select pos from fields where id=?', (af,)).fetchone()[0]
                self.db.execute('update fields set pos=pos+1 where tab_id=? and pos>?', (tid, pa))
                pos = pa + 1
            if pos is None:
                pos = self.db.execute('select coalesce(max(pos),0)+1 from fields where tab_id=?', (tid,)).fetchone()[0]
            fid = self.db.execute('insert into fields(tab_id,label,type,opts,link_tab,pos) values(?,?,?,?,?,?)',
                                  (tid, sp[1], sp[2], '', lt, pos)).lastrowid
            self.res['fields'] += 1
        else:
            fid = f['id']
            if sp[2] == 'link' and f['type'] == 'link' and not f['link_tab'] and len(sp) > 4 and sp[4]:
                self.db.execute('update fields set link_tab=? where id=?', (self.tab_id(sp[4]), fid))
        self.fld[k] = fid
        return fid

    def add_opt(self, tab, key, val):
        if not val:
            return
        fid = self.field(tab, key)
        r = self.db.execute('select opts from fields where id=?', (fid,)).fetchone()
        have = [x for x in (r[0] or '').split(',') if x]
        if val.lower() not in [h.lower() for h in have]:
            self.db.execute('update fields set opts=? where id=?', (','.join(have + [val]), fid))

    def status(self, tab, die=False):
        tid = self.tab_id(tab)
        if tid not in self.stat:
            self.stat[tid] = self.q('select id,label from statuses where tab_id=? order by pos,id', (tid,))
        L = self.stat[tid]
        if die:
            s = next((x for x in L if x['label'].strip().lower() in DIE_WORDS), None)
            if s is None:
                pos = self.db.execute('select coalesce(max(pos),0)+1 from statuses where tab_id=?', (tid,)).fetchone()[0]
                sid = self.db.execute('insert into statuses(tab_id,label,color,pos) values(?,?,?,?)', (tid, 'Die', '#ef4444', pos)).lastrowid
                s = {'id': sid, 'label': 'Die'}
                L.append(s)
            return s['id']
        return L[0]['id'] if L else None

    def dept(self, name):
        if name in self.dept_c:
            return self.dept_c[name]
        L = self.q('select id,name from depts')
        r = next((x for x in L if nz(x['name']) == nz(name)), None) or next((x for x in L if nz(x['name']).startswith(nz(name))), None)
        if r is None:
            pos = self.db.execute('select coalesce(max(pos),0)+1 from depts').fetchone()[0]
            did = self.db.execute('insert into depts(name,color,pos) values(?,?,?)', (name, '#667085', pos)).lastrowid
        else:
            did = r['id']
        self.dept_c[name] = did
        return did

    def owner(self, emp):
        """→ (dept_id, owner_id|None). Người được đặt ngay dưới bộ phận (dùng lại người đã có trong bộ phận)."""
        if emp in self.own_c:
            return self.own_c[emp]
        dn, person = split_emp(emp)
        did = self.dept(dn)
        oid = None
        if person:
            r = self.db.execute('select id from owners where dept_id=? and lower(name)=lower(?) order by (parent_id is null) desc limit 1', (did, person)).fetchone()
            if r is None:
                pos = self.db.execute('select coalesce(max(pos),0)+1 from owners where dept_id=?', (did,)).fetchone()[0]
                oid = self.db.execute('insert into owners(dept_id,parent_id,name,color,pos) values(?,?,?,?,?)', (did, None, person, '#667085', pos)).lastrowid
                self.res['owners'] += 1
            else:
                oid = r[0]
        self.own_c[emp] = (did, oid)
        return did, oid

    # --- dòng tài khoản ---
    def index(self, tab, key):
        k = (tab, key)
        if k in self.idx:
            return self.idx[k]
        fid = self.field(tab, key)
        m = {}
        for r in self.db.execute('select id, json_extract(data, ?) v from accounts where tab_id=? order by id desc', ('$."%d"' % fid, self.tab_id(tab))):
            v = str(r[1] or '').strip().lower()
            if v:
                m[v] = r[0]
        self.idx[k] = m
        return m

    def put(self, tab, nat, vals=None, *, canon=False, ctx=None, die=False, note=None, links=None, repl=(), created=None, alt=None):
        """nat=(trường, giá trị) khóa tự nhiên. canon=True: bản ghi CRM của chính tài khoản này (được ghi đè);
        canon=False: tài khoản suy ra từ nhật ký bản ghi khác (chỉ điền chỗ trống). Trả (id, mới?)."""
        key = str(nat[1] or '').strip()
        if not key:
            return None, False
        lk = key.lower()
        ix = self.index(tab, nat[0])
        aid = ix.get(lk)
        if aid is None and alt and alt[1]:                  # khóa phụ (vd. LinkedIn: tên) — nhận lại dòng suy ra trước đó chưa có khóa chính
            cand = self.index(tab, alt[0]).get(str(alt[1]).strip().lower())
            if cand is not None:
                dd = json.loads(self.db.execute('select data from accounts where id=?', (cand,)).fetchone()[0] or '{}')
                if not dd.get(str(self.field(tab, nat[0]))):
                    aid = cand
        data = {str(self.field(tab, k)): v for k, v in (vals or {}).items() if v not in (None, '')}
        data[str(self.field(tab, nat[0]))] = key
        dept, owner = ctx or (None, None)
        tt = self.touched.setdefault(tab, set())
        if lk in tt and aid is not None and aid not in self.new_ids:
            pass
        first_touch = lk not in tt
        tt.add(lk)
        new = aid is None
        if new:
            did = dept or self.dept('Khác')
            aid = self.db.execute('insert into accounts(tab_id,dept_id,owner_id,status_id,note,data,created,updated) values(?,?,?,?,?,?,?,?)',
                                  (self.tab_id(tab), did, owner, self.status(tab, die), self.merge_note('', note), j(data), created or self.now, self.now)).lastrowid
            self.new_ids.add(aid)
            ix[lk] = aid
            if not canon:
                self.derived_ids.add(aid)
            bucket = 'created' if canon else 'derived'
            self.res[bucket][tab] = self.res[bucket].get(tab, 0) + 1
        else:
            r = self.db.execute('select data,note from accounts where id=?', (aid,)).fetchone()
            old = json.loads(r[0] or '{}')
            chg = False
            for k, v in data.items():
                if (canon or old.get(k) in (None, '')) and old.get(k) != v:
                    old[k] = v
                    chg = True
            sets, a = [], []
            if chg:
                sets += ['data=?', 'updated=?']
                a += [j(old), self.now]
            if canon and note is not None:
                nn = self.merge_note(r[1] or '', note)
                if nn != (r[1] or ''):
                    sets.append('note=?')
                    a.append(nn)
            if canon and dept:
                sets += ['dept_id=?', 'owner_id=?']
                a += [dept, owner]
            if die:
                sets.append('status_id=?')
                a.append(self.status(tab, True))
            if canon and aid in self.derived_ids:
                self.derived_ids.discard(aid)
                self.res['derived'][tab] = self.res['derived'].get(tab, 1) - 1
                self.res['created'][tab] = self.res['created'].get(tab, 0) + 1
            if sets:
                self.db.execute('update accounts set %s where id=?' % ','.join(sets), [*a, aid])
                if aid not in self.new_ids and canon:
                    self.res['updated'][tab] = self.res['updated'].get(tab, 0) + 1
            if not first_touch or aid in self.new_ids:
                self.res['merged'] += 1
        self.reindex(tab, aid)
        for key2 in repl:
            self.db.execute('delete from links where src=? and field_id=?', (aid, self.field(tab, key2)))
        for lkey, targets in (links or {}).items():
            fid = self.field(tab, lkey)
            for dst in dict.fromkeys(targets):
                if dst and dst != aid:
                    c = self.db.execute('insert or ignore into links(src,dst,field_id) values(?,?,?)', (aid, dst, fid))
                    self.res['links'] += c.rowcount
        return aid, new

    def reindex(self, tab, aid):
        """Cập nhật mọi chỉ mục đã dựng của tab cho dòng vừa ghi (tránh tạo trùng khi 2 khóa khác nhau cùng trỏ một tài khoản)."""
        ks = [k for k in self.idx if k[0] == tab]
        if not ks:
            return
        d = json.loads(self.db.execute('select data from accounts where id=?', (aid,)).fetchone()[0] or '{}')
        for (_, key) in ks:
            v = str(d.get(str(self.field(tab, key)), '') or '').strip().lower()
            if v:
                self.idx[(tab, key)].setdefault(v, aid)

    @staticmethod
    def merge_note(old, crm_note):
        if crm_note is None:
            return old
        head = old.split(MARK)[0].rstrip()
        if not crm_note:
            return head
        return (head + '\n\n' if head else '') + MARK + '\n' + crm_note

    # --- thành phần dùng chung ---
    def mail(self, addr, ctx, pw=None, canon=False):
        addr = PR.norm_email(addr)
        if not addr:
            return None
        return self.put('Email', ('email', addr), {'pass': pw, 'type': mail_type(addr)}, canon=canon, ctx=ctx)[0]

    def sim(self, num, ctx, canon=False, vals=None):
        num = PR.norm_phone(num)
        if not num:
            return None
        v = {'carrier': carrier_of(num)}
        v.update(vals or {})
        return self.put('SĐT', ('num', num), v, canon=canon, ctx=ctx)[0]

    def history(self, ev, extra=(), sim=True):
        L = []
        for d, o in ev['owner'][-5:]:
            L.append('%s chuyển owner → %s' % (d, o))
        for d, a, b in ev['rename']:
            L.append('%s đổi tên Page: %s → %s' % (d, a, b))
        for d, b in ev['prov']:
            L.append('%s %s' % (d, b))
        if ev['sim'] and sim:
            L.append('%s %s' % (ev['sim'].get('date', ''), ev['sim']['text'][:160]))
        for d, b in ev['notes'][-6:]:
            L.append('%s %s' % (d, b))
        L.extend(extra)
        L.sort(key=lambda x: x[:10] if re.match(r'\d{4}-\d\d-\d\d', x) else '0')
        seen, out = set(), []
        for x in L:
            x = x.strip()
            if x and x not in seen:
                seen.add(x)
                out.append(x)
        return '\n'.join(out)[:1500]

    # --- phát một khối tài khoản (không phải bản ghi chính) ---
    def emit(self, b, ctx, ctx_phone, ctx_email, hist=''):
        """b: khối tài khoản parse từ nhật ký. Trả id dòng đã tạo/điền (hoặc None)."""
        k = b['kind']
        vph = [PR.norm_phone(p) for p in b['vphones']]
        if b['verifier'] and b['verifier'][0] == 'phone' and ctx_phone:
            vph.append(ctx_phone)
        vem = [(PR.norm_email(m[0]), m[1]) for m in b['vmails']]
        if b['verifier'] and b['verifier'][0] == 'email' and ctx_email:
            vem.append((ctx_email, None))
        if k == 'fb' and PR.norm_email(b['login']) and PR.norm_email(b['login']) not in [a for a, _ in vem]:
            vem.append((PR.norm_email(b['login']), None))
        mails = [self.mail(a, ctx, pw) for a, pw in vem if a]
        sims = [self.sim(p, ctx) for p in vph if p]
        if k == 'fb':
            key = b['uid'] or b['login']
            if not key:
                if b['name']:
                    self.warn('Khối FB "%s" không có UID/ID đăng nhập — bỏ qua (chỉ còn tên)' % b['name'])
                return None
            login = b['login'] if b['login'] and b['login'] != b['uid'] else ''
            return self.put('Facebook', ('uid', key), {'name': b['name'], 'login': login, 'pass': b['pw'], 'twofa': b['twofa'], 'cookie': b['cookie']},
                            ctx=ctx, die=b['die'], links={'vmail': mails, 'vphone': sims})[0]
        if k == 'email':
            addr = PR.norm_email(b['login'])
            if not addr:
                return None
            return self.put('Email', ('email', addr), {'pass': b['pw'], 'type': mail_type(addr)}, ctx=ctx, die=b['die'],
                            links={'rmail': [m for m in mails if m != self.index('Email', 'email').get(addr)], 'rphone': sims})[0]
        if k == 'tele':
            ph = PR.norm_phone(b['login'])
            key = b['uname'] or ph
            if not key:
                return None
            sid = self.sim(ph, ctx) if ph else None
            note = ('SĐT xác minh: ' + ', '.join(vph)) if vph else None
            aid = self.put('Telegram', ('user', key), {'name': b['name'], 'twofa': b['pw'], 'url': ('https://t.me/' + b['uname']) if b['uname'] else ''},
                           ctx=ctx, die=b['die'], links={'phone': [sid] if sid else []})[0]
            if note and aid:
                r = self.db.execute('select note from accounts where id=?', (aid,)).fetchone()
                if note not in (r[0] or ''):
                    self.db.execute('update accounts set note=? where id=?', ((r[0] + '\n' if r[0] else '') + note, aid))
            return aid
        if k == 'zalo':
            ph = PR.norm_phone(b['login'])
            if not ph:
                return None
            return self.zalo(ph, ph, b['name'], b['pw'], mails, ctx, b['die'])
        if k == 'li':
            em = PR.norm_email(b['login']) or ctx_email
            key = li_url(b['url']) or em or b['name']
            if not key:
                return None
            eid = self.mail(em, ctx) if em else None
            return self.put('LinkedIn', ('url' if li_url(b['url']) else 'name', key), {'name': b['name'], 'pass': b['pw'], 'twofa': b['twofa'], 'url': li_url(b['url'])},
                            ctx=ctx, die=b['die'], links={'email': [eid] if eid else [], 'vmail': [m for m in mails if m != eid]})[0]
        return None

    def zalo(self, login, linked, name, pw, mails, ctx, die=False, canon=False, note=None, created=None, nonempty_name=True):
        """Zalo khóa theo SĐT đăng nhập; SĐT liên kết là liên kết riêng (có thể khác số đăng nhập)."""
        lid = self.sim(login, ctx)
        kid = self.sim(linked, ctx) if linked and linked != login else lid
        if lid is None:
            return None
        key = PR.norm_phone(login)
        aid0 = self.index('Zalo', 'login').get(key)                         # SĐT đăng nhập lưu dạng chữ trong dòng Zalo
        aid, new = self._zalo_put(aid0, key, lid, kid, name, pw, mails, ctx, die, canon, note, created)
        self.index('Zalo', 'login')[key] = aid
        return aid

    def _zalo_put(self, aid, key, lid, kid, name, pw, mails, ctx, die, canon, note, created):
        tid = self.tab_id('Zalo')
        vals = {'login': key, 'name': name, 'pass': pw}
        data = {str(self.field('Zalo', k)): v for k, v in vals.items() if v}
        tt = self.touched.setdefault('Zalo', set())
        first = key not in tt
        tt.add(key)
        dept, owner = ctx or (None, None)
        if aid is None:
            aid = self.db.execute('insert into accounts(tab_id,dept_id,owner_id,status_id,note,data,created,updated) values(?,?,?,?,?,?,?,?)',
                                  (tid, dept or self.dept('Khác'), owner, self.status('Zalo', die), self.merge_note('', note), j(data), created or self.now, self.now)).lastrowid
            self.new_ids.add(aid)
            b = 'created' if canon else 'derived'
            self.res[b]['Zalo'] = self.res[b].get('Zalo', 0) + 1
        else:
            r = self.db.execute('select data,note from accounts where id=?', (aid,)).fetchone()
            old = json.loads(r[0] or '{}')
            chg = False
            for k, v in data.items():
                if (canon or old.get(k) in (None, '')) and old.get(k) != v:
                    old[k] = v
                    chg = True
            sets, a = [], []
            if chg:
                sets += ['data=?', 'updated=?']
                a += [j(old), self.now]
            if canon and note is not None:
                nn = self.merge_note(r[1] or '', note)
                if nn != (r[1] or ''):
                    sets.append('note=?')
                    a.append(nn)
            if canon and dept:
                sets += ['dept_id=?', 'owner_id=?']
                a += [dept, owner]
            if die:
                sets.append('status_id=?')
                a.append(self.status('Zalo', True))
            if sets:
                self.db.execute('update accounts set %s where id=?' % ','.join(sets), [*a, aid])
                if canon and aid not in self.new_ids:
                    self.res['updated']['Zalo'] = self.res['updated'].get('Zalo', 0) + 1
            if not first:
                self.res['merged'] += 1
        for lk, ids in (('linked', [kid]),):
            fid = self.field('Zalo', lk)
            if canon or aid in self.new_ids:
                self.db.execute('delete from links where src=? and field_id=?', (aid, fid))
            for d in ids:
                if d and d != aid:
                    self.res['links'] += self.db.execute('insert or ignore into links(src,dst,field_id) values(?,?,?)', (aid, d, fid)).rowcount
        fid = self.field('Zalo', 'vmail')
        for d in mails:
            if d:
                self.res['links'] += self.db.execute('insert or ignore into links(src,dst,field_id) values(?,?,?)', (aid, d, fid)).rowcount
        return aid, aid in self.new_ids

    # --- chạy ---
    def run(self, progress=None):
        seen = {} if self.force else (gs(SEEN) or {})
        rows = sorted(self.rows, key=lambda r: str(r.get('updatedDate') or ''))
        for n, r in enumerate(rows):
            if progress and n % 20 == 0:
                progress(n, len(rows))
            cid = str(r.get('chatId'))
            if seen.get(cid) == r.get('updatedDate'):
                self.res['skipped'] += 1
                continue
            try:
                self.db.execute('savepoint rec')
                self.one(r)
                self.db.execute('release rec')
            except Exception:
                traceback.print_exc()
                self.db.execute('rollback to rec')
                self.db.execute('release rec')
                self.warn('Lỗi xử lý bản ghi "%s" (id %s)' % (r.get('chatName'), cid))
                continue
            seen[cid] = r.get('updatedDate')
        ss(SEEN, seen)
        return self.res

    def one(self, r):
        kd = record_kind(r)
        self.res['kinds'][kd] = self.res['kinds'].get(kd, 0) + 1
        emp = r.get('empName') or ''
        ctx = self.owner(emp)
        created = date_ts(r.get('submitDate'))
        name_raw = clean_title(r.get('chatName'))
        generic = bool(GENERIC.match(name_raw))
        if kd == 'device':
            serial = str(r.get('uuidFaceBook') or '').strip()
            nm = r.get('chatName') or serial
            ex = self.db.execute('select id from devices where name=? or (serial<>"" and serial=?)', (nm, serial)).fetchone()
            if ex is None:
                pos = self.db.execute('select coalesce(max(pos),0)+1 from devices').fetchone()[0]
                self.db.execute('insert into devices(dept_id,owner_id,name,kind,serial,caps,note,pos,created) values(?,?,?,?,?,?,?,?,?)',
                                (ctx[0], ctx[1], nm, 'boxphone', serial, '{}', '', pos, created or self.now))
                self.res['devices'] += 1
            return
        if kd == 'unknown':
            self.warn('Không nhận dạng được loại: "%s"' % r.get('chatName'))
            return
        pk = {'page': 'page', 'fb': 'fb', 'email': 'email', 'phone': 'phone', 'li': 'li'}[kd]
        ev, blocks = PR.parse(r.get('status'), pk)
        die = ev['die']
        sim_no = PR.norm_phone(r.get('phoneNumber'))
        rec_mail = PR.norm_email(r.get('email'))
        ctxb = {k: next((b for b in blocks if b['ctx'] and b['kind'] == k), None) for k in ('fb', 'email', 'zalo', 'li')}
        used = set()

        # ---------- FB Page ----------
        if kd == 'page':
            uid = uid_of(r)
            names = [b for _, a, b in ev['rename']]
            pname = names[-1] if names else name_raw
            fam = 'Comment' if emp.startswith('Comment') else ('Chatbot' if emp.startswith('Chat bot') else '')
            self.add_opt('FB Page', 'cat', fam)
            admin = None
            fb = ctxb['fb']
            if fb is not None and (fb['uid'] or fb['login']) and fb['pw']:
                used.add(id(fb))
                admin = self.put('Facebook', ('uid', fb['uid'] or fb['login']), {'name': fb['name'], 'pass': fb['pw'], 'twofa': fb['twofa'], 'cookie': fb['cookie']}, ctx=ctx,
                                 links={'vmail': [self.mail(m[0], ctx, m[1]) for m in fb['vmails']], 'vphone': [self.sim(x, ctx) for x in fb['vphones']]})[0]
            key = ('uid', uid) if uid else ('name', pname)
            self.put('FB Page', key, {'name': pname, 'cat': fam, 'url': r.get('linkFacebook')}, canon=True, ctx=ctx, die=die,
                     note=self.history(ev), created=created, links={'admin': [admin] if admin else []})
        # ---------- Facebook ----------
        elif kd == 'fb':
            uid = uid_of(r)
            fbs = [b for b in blocks if b['kind'] == 'fb' and not (b['verifier'] and not b['ctx'])]
            prim = next((b for b in fbs if uid and b['uid'] == uid), None) or (ctxb['fb'] if ctxb['fb'] and (not uid or not ctxb['fb']['uid'] or ctxb['fb']['uid'] == uid) else None)
            key = uid or (prim and (prim['uid'] or prim['login'])) or ''
            if not key:
                self.warn('Facebook "%s" không có UID' % r.get('chatName'))
            else:
                p = prim or PR.new_block('fb')
                used.add(id(p))
                login = p['login'] if p['login'] and p['login'] != key else ''
                vem = [(PR.norm_email(m[0]), m[1]) for m in p['vmails']]
                vph = [PR.norm_phone(x) for x in p['vphones']]
                if rec_mail and rec_mail not in [a for a, _ in vem]:
                    vem.append((rec_mail, None))
                if PR.norm_email(login) and PR.norm_email(login) not in [a for a, _ in vem]:
                    vem.append((PR.norm_email(login), None))
                mails = [self.mail(a, ctx, pw) for a, pw in vem if a]
                sims = [self.sim(x, ctx) for x in vph if x]
                nm = p['name'] or ('' if GENERIC.match(name_raw) else name_raw)
                self.put('Facebook', ('uid', key), {'name': nm, 'login': login, 'pass': p['pw'], 'twofa': p['twofa'], 'cookie': p['cookie'],
                                                    'url': r.get('linkFacebook')}, canon=True, ctx=ctx, die=die or p['die'], note=self.history(ev),
                         created=created, links={'vmail': mails, 'vphone': sims})
        # ---------- Email ----------
        elif kd == 'email':
            eb = ctxb['email']
            addr = PR.norm_email(eb['login']) if eb else ''
            addr = addr or rec_mail
            if rec_mail and addr and rec_mail != addr:
                self.warn('Email lệch: bản ghi "%s" ghi %s nhưng nhật ký đăng nhập %s (lấy theo nhật ký)' % (r.get('chatName'), rec_mail, addr))
            if not addr:
                self.warn('Email "%s" không có địa chỉ' % r.get('chatName'))
            else:
                used.add(id(eb)) if eb else None
                vem = [(PR.norm_email(m[0]), m[1]) for m in (eb['vmails'] if eb else []) if PR.norm_email(m[0]) != addr]
                vph = [PR.norm_phone(x) for x in (eb['vphones'] if eb else [])]
                if sim_no:
                    vph.append(sim_no)
                self.put('Email', ('email', addr), {'pass': eb['pw'] if eb else '', 'type': mail_type(addr)}, canon=True, ctx=ctx, die=die or bool(eb and eb['die']),
                         note=self.history(ev), created=created,
                         links={'rmail': [self.mail(a, ctx, pw) for a, pw in vem], 'rphone': [self.sim(x, ctx) for x in vph if x]})
                rec_mail = addr
        # ---------- LinkedIn ----------
        elif kd == 'li':
            lb = ctxb['li'] or PR.new_block('li')
            used.add(id(lb))
            url = li_url(r.get('linkLinkedin'))
            em = PR.norm_email(lb['login']) or rec_mail
            eid = self.mail(em, ctx) if em else None
            nm = lb['name'] or ('' if generic else name_raw)
            key = ('url', url) if url else (('email', em) if False else ('name', nm or em))
            self.put('LinkedIn', key, {'name': nm, 'pass': lb['pw'], 'twofa': lb['twofa'], 'url': url}, canon=True, ctx=ctx, die=die or lb['die'],
                     note=self.history(ev), created=created, alt=('name', nm) if url else None,
                     links={'email': [eid] if eid else [], 'vmail': [self.mail(m[0], ctx, m[1]) for m in lb['vmails'] if PR.norm_email(m[0]) != em]})
            rec_mail = rec_mail or em
        # ---------- SĐT (+ Zalo) ----------
        elif kd == 'phone':
            ws = ev['ws']
            zb = ctxb['zalo']
            code = str(r.get('rateZaloId') or '')
            explicit = bool(re.match(r'^Zalo', name_raw, re.I)) or code in ('37001', '37008', '37010') or \
                any(b['kind'] == 'zalo' and not b['ctx'] and not b['verifier'] for b in blocks)
            has_zalo = explicit or (zb is not None and not ev['no_zalo'] and code != '37007')
            if ev['no_zalo'] and code == '37007' and not re.match(r'^Zalo', name_raw, re.I):
                has_zalo = False
            wa_login = PR.norm_phone(ws.get('login')) if ws else ''                # khối "TÊN TK / ID ĐĂNG NHẬP / SĐT" = WhatsApp
            wa_linked = PR.norm_phone(ws.get('phone')) if ws else ''
            login = (PR.norm_phone(zb['login']) if zb else '') or sim_no
            linked = sim_no or login
            holder = '' if generic else name_raw
            sim_pw = '' if has_zalo else (zb['pw'] if zb else '')
            if ws and (wa_login or wa_linked):
                wl = wa_login or wa_linked
                wk = self.sim(wa_linked, ctx) if wa_linked else self.sim(wl, ctx)
                self.put('WhatsApp', ('login', wl), {'name': ws.get('name') or ''}, canon=True, ctx=ctx, die=die,
                         note=self.history(ev, sim=False), created=created, links={'linked': [wk] if wk else []})
            if not sim_no and not login:
                self.warn('Bản ghi "%s" không có số điện thoại' % r.get('chatName'))
            else:
                main = sim_no or login
                self.sim(main, ctx, canon=True, vals={'pass': sim_pw})
                # ghi chú/ trạng thái của SIM
                sid = self.index('SĐT', 'num').get(main)
                nn = self.history(ev)
                row = self.db.execute('select note from accounts where id=?', (sid,)).fetchone()
                if row is not None and self.merge_note(row[0] or '', nn) != (row[0] or ''):
                    self.db.execute('update accounts set note=?, updated=? where id=?', (self.merge_note(row[0] or '', nn), self.now, sid))
                if die:
                    self.db.execute('update accounts set status_id=? where id=?', (self.status('SĐT', True), sid))
                if sid is not None:
                    self.put('SĐT', ('num', main), {}, canon=True, ctx=ctx)         # gán owner/bộ phận
                if has_zalo:
                    used.add(id(zb)) if zb else None
                    zn = (zb['name'] if zb else '') or ('' if ws else holder)
                    zm = [self.mail(m[0], ctx, m[1]) for m in (zb['vmails'] if zb else [])]
                    self.zalo(login, linked, zn, (zb['pw'] if zb else ''), zm, ctx, die=False, canon=True, note=self.history(ev, sim=False), created=created)
        # ---------- các khối còn lại (SIM/Email "xác minh cho…", Tele, Zalo phụ…) ----------
        ctx_phone = sim_no or (PR.norm_phone(ev['ws'].get('phone')) if kd == 'phone' and ev['ws'] else '')
        ctx_email = rec_mail
        for b in blocks:
            if id(b) in used or b['ctx']:
                continue
            if not (b['uid'] or b['login'] or b['uname'] or b['name'] or b['vmails'] or b['vphones']):
                continue
            self.emit(b, ctx, ctx_phone, ctx_email)
        # Email + LinkedIn trong cùng 1 bản ghi
        if kd == 'email' and r.get('linkLinkedin'):
            eid = self.index('Email', 'email').get(rec_mail) if rec_mail else None
            lb = next((b for b in blocks if b['kind'] == 'li' and not b['verifier']), None) or PR.new_block('li')
            url = li_url(r.get('linkLinkedin'))
            self.put('LinkedIn', ('url', url) if url else ('name', lb['name'] or name_raw),
                     {'name': lb['name'] or ('' if generic else name_raw), 'pass': lb['pw'], 'twofa': lb['twofa'], 'url': url},
                     canon=True, ctx=ctx, links={'email': [eid] if eid else []}, alt=('name', lb['name'] or name_raw) if url else None)


# ───────────────────────── dọn dữ liệu nhập v1 ─────────────────────────
def cleanup_v1(rows):
    """Bản v1 tạo trường 'Mã CRM', dòng có mã đó, dòng phụ (stub) cùng thời điểm nhập, nhóm owner theo Rec Intalent… → xóa sạch để nhập lại."""
    db = APP.db
    last = gs(LAST) or {}
    out = {}
    if last.get('v') == VERSION:
        return out
    flds = [dict(x) for x in db.execute('select id,tab_id,label from fields').fetchall()]
    crm_f = [f for f in flds if f['label'] == 'Mã CRM']
    if not crm_f and not last:
        return out
    try:
        APP.do_backup('safe')
    except Exception:
        traceback.print_exc()
    ids = set()
    for f in crm_f:
        for r in db.execute('select id from accounts where tab_id=? and coalesce(json_extract(data,?),"")<>""', (f['tab_id'], '$."%d"' % f['id'])):
            ids.add(r[0])
    ts = last.get('ts')
    if ts:
        tabs = {f['tab_id'] for f in crm_f}
        for t in tabs:
            for r in db.execute('select id from accounts where tab_id=? and created between ? and ?', (t, ts - 3600, ts + 3600)):
                ids.add(r[0])
    tabs = {f['tab_id'] for f in crm_f}
    for t in tabs:                                      # dòng phụ (stub) cùng 1 lượt nhập chung đúng 1 mốc created (số thực), ≥5 dòng
        for r in db.execute('select id from accounts where tab_id=? and created in (select created from accounts where tab_id in (%s) and created<>cast(created as int) group by created having count(*)>=5)'
                            % ','.join(str(x) for x in tabs), (t,)):
            ids.add(r[0])
    if ids:
        APP.del_accounts_ids(sorted(ids))
        out['rows'] = len(ids)
    n = 0
    for f in flds:
        if f['label'] in V1_FIELDS and f['tab_id'] in {x['tab_id'] for x in crm_f}:
            used = db.execute('select 1 from accounts where tab_id=? and coalesce(json_extract(data,?),"")<>"" limit 1', (f['tab_id'], '$."%d"' % f['id'])).fetchone()
            if not used:
                db.execute('delete from links where field_id=?', (f['id'],))
                db.execute('delete from fields where id=?', (f['id'],))
                n += 1
    out['fields'] = n
    names = set()
    for r in rows:
        names.update(v1_names(r.get('empName')))
    removed = 0
    for _ in range(4):
        for o in [dict(x) for x in db.execute('select id,name from owners').fetchall()]:
            if o['name'] not in names:
                continue
            busy = db.execute('select 1 from accounts where owner_id=? union select 1 from devices where owner_id=? union select 1 from owners where parent_id=?', (o['id'], o['id'], o['id'])).fetchone()
            if not busy:
                db.execute('delete from owners where id=?', (o['id'],))
                removed += 1
    out['owners'] = removed
    ss(SEEN, {})
    db.commit()
    return out


# ───────────────────────── cấu hình · lấy dữ liệu ─────────────────────────
def cfg_get():
    c = gs(SKEY) or {}
    if not c.get('token'):
        try:
            fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crm_cfg.json')
            if os.path.isfile(fp):
                d = json.load(open(fp, encoding='utf-8'))
                c.update({k: d[k] for k in ('url', 'token') if d.get(k)})
                ss(SKEY, c)
                APP.db.commit()
        except Exception:
            traceback.print_exc()
    if not c.get('url'):
        c['url'] = DEFAULT_URL
    return c


def fetch_all(c, progress):
    body = c.get('body') or DEFAULT_BODY
    out, page, size = [], 0, 1000
    while True:
        url = '%s?page=%d&size=%d&sort=updatedDate%%2Cdesc' % (c['url'].rstrip('/'), page, size)
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), method='POST', headers={
            'Content-Type': 'application/json', 'Accept': '*/*', 'Authorization': 'Bearer ' + (c.get('token') or '').strip(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155.0 Safari/537.36'})
        try:
            with urllib.request.urlopen(req, timeout=90) as rs:
                d = json.loads(rs.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raise ValueError('Token hết hạn hoặc bị từ chối (HTTP %s)' % e.code if e.code in (401, 403) else 'CRM trả lỗi HTTP %s' % e.code)
        except urllib.error.URLError as e:
            raise ValueError('Không kết nối được CRM: %s' % e.reason)
        rows = d.get('data') or []
        out += rows
        total = (d.get('meta') or {}).get('total') or len(out)
        progress(len(out), total)
        if not rows or len(out) >= total:
            save_raw(out)
            return out
        page += 1


RAW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crm_rows.json')


def save_raw(rows):
    """bản thô lần lấy gần nhất (để đối soát / phân loại lại mà không phải gọi CRM)"""
    try:
        tmp = RAW_FILE + '.part'
        json.dump(rows, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
        os.replace(tmp, RAW_FILE)
    except Exception:
        traceback.print_exc()


def tab_counts():
    out = {}
    for r in APP.db.execute('select t.name, count(a.id) from tabs t left join accounts a on a.tab_id=t.id group by t.id').fetchall():
        out[r[0]] = r[1]
    return out


def run_import(rows, label='api', force=False):
    with APP.LOCK:
        try:
            cl = cleanup_v1(rows)
            L = Loader(APP, rows, force or bool(cl))
            res = L.run(lambda n, t: JOB.update(phase='Đang nạp', done=n, total=t))
            res['cleaned'] = cl
            res['rows'] = len(rows)
            res['ts'] = time.time()
            res['src'] = label
            res['totals'] = {k: v for k, v in tab_counts().items() if k in SPEC}
            res['distinct'] = {k: len(v) for k, v in L.touched.items()}
            ss(LAST, res)
            APP.db.commit()
        except Exception:
            APP.db.rollback()
            raise
    return res


def _job(rows=None, force=False):
    JOB.update(running=True, err='', phase='Đang lấy dữ liệu', done=0, total=0)
    try:
        src = 'file' if rows is not None else 'api'
        if rows is None:
            c = cfg_get()
            if not (c.get('token') or '').strip():
                raise ValueError('Chưa có token CRM')
            rows = fetch_all(c, lambda n, t: JOB.update(done=n, total=t))
        run_import(rows, src, force)
        JOB.update(phase='Xong')
    except ValueError as e:
        JOB.update(err=str(e), phase='Lỗi')
    except Exception as e:
        traceback.print_exc()
        JOB.update(err=str(e), phase='Lỗi')
    finally:
        JOB['running'] = False


def state():
    c = cfg_get()
    return {'cfg': {'url': c['url'], 'has_token': bool((c.get('token') or '').strip())}, 'job': dict(JOB), 'last': gs(LAST)}


def handle(method, path, qs, body):
    try:
        if method == 'GET' and path == '/api/crm/state':
            with APP.LOCK:
                return 200, state()
        b = json.loads(body or b'{}') if isinstance(body, (bytes, str)) else (body or {})
        if path == '/api/crm/cfg':
            with APP.LOCK:
                c = cfg_get()
                if 'url' in b:
                    c['url'] = str(b['url']).strip() or DEFAULT_URL
                if b.get('token'):
                    c['token'] = str(b['token']).strip().replace('Bearer ', '')
                ss(SKEY, c)
                APP.db.commit()
            return 200, {'ok': 1}
        if path == '/api/crm/sync':
            if JOB['running']:
                raise ValueError('Đang đồng bộ')
            rows = None
            if b.get('rows') is not None:
                rows = b['rows']
                if isinstance(rows, dict):
                    rows = rows.get('data') or []
            threading.Thread(target=_job, args=(rows, bool(b.get('force'))), daemon=True).start()
            return 200, {'ok': 1}
        if path == '/api/crm/fetch':                                          # chỉ lấy bản thô về crm_rows.json, KHÔNG nạp vào dữ liệu
            if JOB['running']:
                raise ValueError('Đang đồng bộ')
            with APP.LOCK:
                c = cfg_get()
            if not (c.get('token') or '').strip():
                raise ValueError('Chưa có token CRM')
            rows = fetch_all(c, lambda n, t: None)
            return 200, {'ok': 1, 'rows': len(rows)}
        if path == '/api/crm/reset':
            with APP.LOCK:
                ss(SEEN, {})
                APP.db.commit()
            return 200, {'ok': 1}
        return 404, {'error': 'not found'}
    except ValueError as e:
        return 400, {'error': str(e)}
    except Exception as e:
        traceback.print_exc()
        return 500, {'error': str(e)}


def _auto():
    time.sleep(6)
    try:
        with APP.LOCK:
            last = gs(LAST) or {}
            c = cfg_get()
        if last.get('v') == VERSION or not (c.get('token') or '').strip() or JOB['running']:
            return
        _job(None, True)
    except Exception:
        traceback.print_exc()


def install(app):
    global APP
    APP = app
    threading.Thread(target=_auto, daemon=True).start()
    return {'handle': handle}
