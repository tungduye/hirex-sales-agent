"""
Tách cột nhật ký (status) của CRM thành SỰ KIỆN (chuyển owner, đổi tên Page, tình trạng SIM…) và KHỐI TÀI KHOẢN
(Facebook / Email / Zalo / LinkedIn / Telegram) cùng QUAN HỆ xác minh giữa chúng.

Nhật ký do người gõ tay nhưng có văn phạm khá ổn định:
    "SĐT xác minh cho:  Email: a@x + Pass: p   Profile facebook: Tên + UID: 6158… + Pass: p + 2FA: ABCD…   Tele: Tên + ID đăng nhập: 09… + Usename: u"
    "ID đăng nhập: a@x  Pass: p  Email xác minh: b@y  Email xác minh cho: +Prof facebook: … +Linkedln: … "
    "Định dạng: UID|PASS|2FA|MAIL|PASSMAI|COOKIE|…   Tài khoản ĐN: uid|pass|2fa|mail|passmail|cookie|…"
Mỗi nhãn có "vai" (role); nhãn "đầu khối" (Profile facebook / Tele / Linkedln / Zalo / Email…) mở khối tài khoản mới,
nhãn thuộc tính (UID / ID đăng nhập / Pass / 2FA / Email xác minh…) gắn vào khối đang mở.
"""
import html
import re

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")


# ───────────────────────── chuẩn hóa ─────────────────────────
def strip_html(s):
    s = re.sub(r'(?i)<\s*br\s*/?>|</p>|</div>|</li>', '\n', s or '')
    s = re.sub(r'<[^>]+>', '', s)
    return html.unescape(s).replace('\xa0', ' ').replace('\r', '')


def norm_email(s):
    m = EMAIL.search(s or '')
    return m.group(0).lower().strip('.') if m else ''


def norm_phone(s):
    d = re.sub(r'\D', '', str(s or ''))
    if d.startswith('84') and len(d) == 11:
        d = '0' + d[2:]
    if len(d) == 9 and d[0] != '0':
        d = '0' + d
    return d if 9 <= len(d) <= 11 and d[0] == '0' else ''


def first_phone(s):
    m = re.search(r"['\u2019]?\s*(\+?84[\s.\-]?\d[\d\s.\-]{7,12}|0[\d\s.\-]{8,12})", s or '')
    return norm_phone(m.group(1)) if m else ''


def clean_val(v):
    return re.sub(r"^[\s+\-|,;'\"\u2019]+|[\s+\-|,;'\"\u2019]+$", '', v or '')


def first_token(v):
    v = clean_val(v)
    t = clean_val(re.split(r'\s', v, maxsplit=1)[0]) if v else ''
    while t.endswith(')') and '(' not in t:
        t = t[:-1]
    return t


def clean_name(v):
    v = re.split(r'\s[+|]\s|\s-\s|\n', v or '')[0]
    v = re.sub(r'\s+', ' ', clean_val(v))
    return '' if re.match(r'(?i)^(cập nhật|update|tk\b|tài khoản|đã |không )', v) else v


def parse_2fa(v):
    v = (v or '').split('\n')[0]
    if re.match(r'\s*(không|k\s|chưa)', v, re.I):
        return ''
    t = re.split(r'\s[+|]|\+', v)[0]
    t = re.sub(r'[^A-Za-z0-9]', '', t).upper()
    return t if re.fullmatch(r'[A-Z2-7]{16,64}', t) else ''


# ───────────────────────── từ vựng nhãn ─────────────────────────
VOC = {
    'sđt xác minh cho': 'vcho_p',
    'email xác minh cho zalo': 'vcho_e', 'emai xác minh cho zalo': 'vcho_e', 'email xác minh cho nick zalo': 'vcho_e',
    'mail xác minh cho nick zalo': 'vcho_e', 'email xác minh cho': 'vcho_e', 'emai xác minh cho': 'vcho_e', 'mail xác minh cho': 'vcho_e',
    'email xác minh zalo': 'vmail', 'email xác minh': 'vmail', 'mail xác minh': 'vmail', 'emai xác minh': 'vmail',
    'email xác minh của công ty': 'vmail', 'email đang ký': 'vmail', 'email mua': 'vmail', 'email liên kết': 'vmail', 'email khôi phục': 'vmail',
    'mail khôi phục': 'vmail', 'email dự phòng': 'vmail', 'sđt khôi phục': 'vphone', 'sđt dự phòng': 'vphone',
    'email liên kết tài khoản': 'vmail', 'email đăng ký': 'vmail', 'email công ty': 'vmail', 'mail đăng ký': 'vmail',
    'sđt xác minh': 'vphone', 'sđt đăng ký': 'vphone', 'sđt liên kết': 'vphone', 'sdt xác minh': 'vphone',
    'pass mail': 'passmail', 'pass email': 'passmail', 'passmail': 'passmail', 'mật khẩu mail': 'passmail',
    'mật khẩu': 'pass', 'password': 'pass', 'pass': 'pass', 'mk': 'pass',
    'mã 2fa': 'twofa', '2fa': 'twofa', '#fa': 'twofa',
    'uid': 'uid',
    'id đăng nhập': 'login', 'id đănh nhập': 'login', 'id đăng nhâp': 'login', 'tk đăng nhập': 'login', 'tài khoản đăng nhập': 'login', 'tài khoản đn': 'login', 'id': 'login',
    'usename': 'uname', 'username': 'uname',
    'sđt': 'sdt', 'sdt': 'sdt',
    'nghiệm thu tạo tài khoản fb mới': 'h_fb', 'profile facebook': 'h_fb', 'profile facbook': 'h_fb', 'prof facebook': 'h_fb',
    'prof fb': 'h_fb', 'profile': 'h_fb', 'tài khoản fb': 'h_fb', 'tên fb': 'h_fb', 'tên facebook': 'h_fb', 'fb': 'h_fb',
    'telegram': 'h_tele', 'tele': 'h_tele',
    'linkedln': 'h_li', 'linkedin': 'h_li', 'tên linkedin': 'h_li', 'tên linkedln': 'h_li', 'tài khoản linkedin': 'h_li',
    'nick zalo mới': 'h_zalo', 'zalo': 'h_zalo',
    'page facebook': 'h_page', 'page fb': 'h_page', 'page': 'h_page',
    'email': 'h_mail', 'emai': 'h_mail', 'mail': 'h_mail', 'e-mail': 'h_mail',
    'tên tk': 'name', 'tên zalo': 'name', 'tên': 'name',
    'owner': 'owner',
}
_alts = '|'.join(re.escape(k).replace(r'\ ', r'\s+') for k in sorted(VOC, key=len, reverse=True))
LABEL = re.compile(r'(?<![\w])(' + _alts + r')(?![\w])\s*[:："]', re.I)
CRED_ROLES = {'vcho_p', 'vcho_e', 'vmail', 'vphone', 'passmail', 'pass', 'twofa', 'uid', 'login', 'uname', 'h_fb', 'h_tele', 'h_li', 'h_zalo', 'h_mail'}


def role_of(phrase):
    return VOC.get(re.sub(r'\s+', ' ', phrase.lower()))


# ───────────────────────── tách khối ─────────────────────────
def new_block(kind, **kw):
    b = {'kind': kind, 'name': '', 'uid': '', 'login': '', 'pw': '', 'twofa': '', 'cookie': '', 'token': '', 'uname': '', 'url': '',
         'vmails': [], 'vphones': [], 'verifier': None, 'die': False, 'ctx': False}
    b.update(kw)
    return b


def _ident(b):
    k = b['kind']
    if k == 'fb':
        return ('fb', b['uid'] or b['login'] or b['name'])
    if k in ('email',):
        return ('email', b['login'])
    if k == 'zalo':
        return ('zalo', norm_phone(b['login']) or b['name'])
    if k == 'li':
        return ('li', b['login'] or b['name'])
    if k == 'tele':
        return ('tele', b['uname'] or norm_phone(b['login']) or b['name'])
    return (k, b['name'])


def merge_into(a, b):
    for k in ('name', 'uid', 'login', 'pw', 'twofa', 'cookie', 'token', 'uname', 'url'):
        if b.get(k):
            a[k] = b[k]
    for m in b['vmails']:
        i = next((j for j, x in enumerate(a['vmails']) if x[0] == m[0]), None)
        if i is None:
            a['vmails'].append(m)
        elif m[1]:
            a['vmails'][i] = m
    for p in b['vphones']:
        if p not in a['vphones']:
            a['vphones'].append(p)
    if b.get('verifier'):
        a['verifier'] = b['verifier']
    a['die'] = a['die'] or b['die']
    a['ctx'] = a['ctx'] or b['ctx']


class Scan:
    """Quét tuần tự các mục nhật ký của 1 bản ghi; giữ khối mặc định theo loại bản ghi."""

    def __init__(self, ctx_kind):
        self.ctx_kind = ctx_kind            # 'fb' | 'page' | 'email' | 'phone' | 'li' | ''
        self.blocks = []
        self.defaults = {}

    def default(self, kind):
        if kind not in self.defaults:
            b = new_block(kind, ctx=True)
            self.defaults[kind] = b
            self.blocks.append(b)
        return self.defaults[kind]

    def default_for(self, value=''):
        v = value or ''
        is_mail = bool(EMAIL.search(v))
        is_phone = bool(first_phone(v)) and not is_mail
        c = self.ctx_kind
        if c in ('fb', 'page'):
            return self.default('fb')
        if c == 'li':
            return self.default('li')
        if c == 'email':
            return self.default('email')
        if c == 'phone':
            if is_mail:
                return self.default('email')
            return self.default('zalo')
        return self.default('email' if is_mail else 'fb')

    def pipe(self, body):
        """UID|PASS|2FA|MAIL|PASSMAIL|COOKIE|… (Định dạng cột)"""
        m = re.search(r'Tài khoản ĐN:\s*\n?\s*(\S[^\n]*)', body)
        if not (m and '|' in m.group(1)):
            return body
        P = [x.strip() for x in m.group(1).split('|')]
        b = self.default('fb') if self.ctx_kind in ('fb', 'page', '') else new_block('fb')
        if self.ctx_kind not in ('fb', 'page', '') and b not in self.blocks:
            self.blocks.append(b)
        if P and re.fullmatch(r'\d{8,}', P[0]):
            b['uid'] = P[0]
        elif P and P[0]:
            b['login'] = P[0]
        if len(P) > 1 and P[1]:
            b['pw'] = P[1]
        mail = None
        for p in P[2:]:
            if not p:
                continue
            if re.fullmatch(r'[A-Z2-7 ]{16,64}', p) and not b['twofa']:
                b['twofa'] = p.replace(' ', '')
            elif EMAIL.fullmatch(p) and mail is None:
                mail = [norm_email(p), None]
                b['vmails'].append(mail)
            elif 'c_user=' in p or 'datr=' in p or re.search(r'\bxs=', p):
                b['cookie'] = p
            elif p.startswith('EAA'):
                b['token'] = p
            elif mail is not None and mail[1] is None and len(p) < 40 and not p.startswith('M.'):
                mail[1] = p
        i = body.find('Định dạng:')
        return (body[:i] if i >= 0 else body[:m.start()]) + ' ' + body[m.end():]

    def scan(self, body):
        body = self.pipe(body)
        body = re.sub(r'(?i)(?<![\w])(e?mail)[ \t]+(?=[\w.+\-]+@)', r'\1: ', body)
        ms = list(LABEL.finditer(body))
        if not ms:
            return False
        segs = [(role_of(m.group(1)), m.group(1), body[m.end(): ms[i + 1].start() if i + 1 < len(ms) else len(body)]) for i, m in enumerate(ms)]
        if not any(r in CRED_ROLES for r, _, _ in segs):
            return False
        pre = clean_name(body[:ms[0].start()]).rstrip(' :')
        cur, subj, verifier = None, None, None
        first = None

        def nb(kind, **kw):
            nonlocal cur, first
            b = new_block(kind, verifier=verifier, **kw)
            self.blocks.append(b)
            cur = b
            first = first or b
            return b

        def use(value=''):
            nonlocal cur, first
            if cur is None:
                cur = self.default_for(value)
                cur['verifier'] = cur['verifier'] or verifier if not cur['ctx'] else cur['verifier']
                first = first or cur
            return cur

        for role, phr, val in segs:
            if role == 'vcho_p':
                verifier, cur, subj = ('phone', '@ctx'), None, None
            elif role == 'vcho_e':
                em = norm_email(val)
                if em:                                          # "Mail xác minh cho nick zalo: a@x"
                    b = cur if cur is not None else self.default('zalo')
                    b['vmails'].append([em, None])
                    cur, subj = b, 'vmail'
                else:
                    verifier, cur, subj = ('email', '@ctx'), None, None
                    name = clean_name(val)
                    if name:                                    # "Emai xác minh cho zalo: Văn Duy + sdt: …"
                        nb('zalo', name=name)
                        subj = 'acct'
            elif role.startswith('h_'):
                kind = {'h_fb': 'fb', 'h_tele': 'tele', 'h_li': 'li', 'h_zalo': 'zalo', 'h_page': 'page', 'h_mail': 'email'}[role]
                if kind == 'email':
                    em = norm_email(val)
                    if not em:
                        continue
                    b = nb('email', login=em)
                    rest = clean_val(val[val.lower().find(em) + len(em):])
                    if rest.startswith('/'):
                        b['pw'] = first_token(rest[1:])
                elif kind == 'page':
                    continue
                else:
                    name = clean_name(val)
                    die = bool(re.search(r'\bchết\b', val, re.I))
                    name = re.sub(r'\(\s*(?:đã\s+)?chết\s*\)', '', name, flags=re.I).strip()
                    if re.match(r'(?i)^(cập nhật|update|tk\b|tài khoản)', name):
                        name = ''
                    dflt = self.defaults.get(kind)
                    own = verifier is None and ((kind == 'li' and self.ctx_kind == 'li') or (kind == 'fb' and self.ctx_kind in ('fb', 'page')))
                    if cur is not None and cur['kind'] == kind and not (cur['uid'] or cur['pw'] or cur['twofa']):
                        cur['name'] = cur['name'] or name
                        cur['die'] = cur['die'] or die
                    elif own and (dflt is None or not dflt['name']):
                        cur = self.default(kind)
                        cur['name'] = name
                        cur['die'] = cur['die'] or die
                        first = first or cur
                    else:
                        nb(kind, name=name, die=die)
                subj = 'acct'
            elif role == 'uid':
                m = re.search(r'\d{8,}', val)
                if not m:
                    continue
                if cur is None or cur['kind'] != 'fb' or cur['uid']:
                    if cur is None and self.ctx_kind in ('fb', 'page'):
                        cur = self.default('fb')
                        first = first or cur
                    else:
                        nb('fb')
                cur['uid'] = m.group(0)
                subj = 'acct'
            elif role == 'login':
                parts = re.split(r'\s*\+\s*', val.strip(), maxsplit=2)
                lg = clean_val(parts[0].split('\n')[0])
                lg = first_token(lg) if EMAIL.search(lg) or first_phone(lg) else clean_val(lg)
                b = use(lg)
                if EMAIL.search(lg):
                    b['login'] = norm_email(lg)
                elif first_phone(lg):
                    b['login'] = first_phone(lg)
                    if b['kind'] == 'email' and b['ctx'] and self.ctx_kind == 'phone':
                        pass
                else:
                    b['login'] = lg
                if len(parts) > 1 and parts[1].strip() and ':' not in parts[1] and not b['pw']:
                    b['pw'] = first_token(parts[1])
                subj = 'acct'
            elif role == 'sdt':
                ph = first_phone(val)
                if ph:
                    b = use(ph)
                    if b['kind'] in ('zalo', 'tele') and not b['login']:
                        b['login'] = ph
                    else:
                        b['vphones'].append(ph)
            elif role == 'vmail':
                ems = list(EMAIL.finditer(val))
                if not ems:
                    continue
                b = use()
                for i, mm in enumerate(ems):
                    em = mm.group(0).lower().strip('.')
                    tail = val[mm.end(): ems[i + 1].start() if i + 1 < len(ems) else len(val)]
                    pw = None
                    t = tail.lstrip()
                    if t.startswith('/'):
                        pw = first_token(t[1:])
                    else:
                        m2 = re.match(r'\(?\s*(?:pass|mk|mật khẩu)\s*[:：]?\s*([^\s)+]+)', t, re.I)
                        pw = m2.group(1) if m2 else None
                    ex = next((x for x in b['vmails'] if x[0] == em), None)
                    if ex is None:
                        b['vmails'].append([em, pw])
                    elif pw:
                        ex[1] = pw
                subj = 'vmail'
            elif role == 'vphone':
                ph = first_phone(val)
                if ph:
                    b = use()
                    if ph not in b['vphones']:
                        b['vphones'].append(ph)
            elif role == 'pass':
                pw = first_token(val)
                if not pw or re.fullmatch(r'(không|k|chưa)', pw, re.I):
                    continue
                b = use()
                if subj == 'vmail' and b['vmails']:
                    b['vmails'][-1][1] = pw
                else:
                    b['pw'] = pw
            elif role == 'passmail':
                pw = first_token(val)
                if not pw:
                    continue
                b = use()
                if b['vmails']:
                    b['vmails'][-1][1] = pw
                elif b['kind'] == 'email':
                    b['pw'] = pw
            elif role == 'twofa':
                t = parse_2fa(val)
                if t:
                    use()['twofa'] = t
            elif role == 'uname':
                u = first_token(val)
                if u:
                    use()['uname'] = u
            elif role == 'name':
                n = clean_name(val)
                if n:
                    use()['name'] = n
        if pre and first is not None and not first['name'] and re.fullmatch(r"[^\W\d_][^\n:@]{0,40}", pre):
            first['name'] = pre
        return True

    def done(self):
        out = []
        for b in self.blocks:
            if not any((b['uid'], b['login'], b['name'], b['uname'], b['vmails'], b['vphones'], b['pw'], b['twofa'], b['cookie'])):
                continue
            k = _ident(b)
            tgt = next((x for x in out if _ident(x) == k and k[1]), None) if k[1] else None
            if b['ctx'] or tgt is None:
                out.append(b) if tgt is None else merge_into(tgt, b)
            else:
                merge_into(tgt, b)
        return out


# ───────────────────────── nhật ký → sự kiện + khối ─────────────────────────
_HEAD = re.compile(r'^(\d{4}-\d\d-\d\d):[ \t]*')
_USER = re.compile(r'^(?=[\w&]*[^\W\d_])([\w&]+?\d{2,3})(?=[\s\-]|$)[\s\-]*')
_RANK = re.compile(r'^-?\s*Xếp hạng\s', re.I)
_OWN = re.compile(r'(?:Switch\s+)?Owner từ\s+(\S+)\s+thành\s+(.+)$', re.I)
_NOISE = re.compile(r'^(null|update|vy|hoàn|nhi|\.|ceo|test|other-ceo test)$', re.I)


def entries(status):
    txt = strip_html(status)
    out = []
    for blk in re.split(r'\n(?=\d{4}-\d\d-\d\d:)', txt):
        blk = blk.strip()
        if blk.startswith('null\n'):
            blk = blk[5:].strip()
        if not blk or blk == 'null':
            continue
        m = _HEAD.match(blk)
        date, body = (m.group(1), blk[m.end():]) if m else ('', blk)
        u = _USER.match(body)
        if u:
            body = body[u.end():]
        out.append((date, body.strip()))
    return out


def parse(status, ctx_kind):
    ev = {'owner': [], 'rename': [], 'prov': [], 'sim': {}, 'die': False, 'notes': [], 'ws': {}, 'no_zalo': False, 'has_zalo_txt': False}
    sc = Scan(ctx_kind)
    for date, body in entries(status):
        b = body.strip()
        if not b or _NOISE.match(b):
            continue
        if _RANK.match(b):                      # "Xếp hạng Am 1 - Đã xác minh- <nội dung thật>"
            mr = re.match(r'^-?\s*Xếp hạng\s+[^-\n]+?-\s*[^-\n]*?(?:-\s*(.*))?$', b, re.S)
            b = (mr.group(1) or '').strip() if mr else ''
            if not b:
                continue
        mo = _OWN.search(b)
        if mo:
            ev['owner'].append((date, mo.group(2).strip()))
            continue
        if re.search(r'chuyển\s*$', b, re.I) and len(b) < 40 and '\n' not in b:
            continue
        mm = re.search(r'Page:?\s*(.+?)\s+đổi tên thành\s+(.+)$', b)
        if mm:
            ev['rename'].append((date, mm.group(1).strip(), mm.group(2).strip()))
            continue
        if re.match(r'(CHUYỂN LẠI:\s*)?Page mới', b, re.I):
            ev['prov'].append((date, re.sub(r'^CHUYỂN LẠI:\s*', '', b, flags=re.I)))
            continue
        mt = re.search(r'Tình trạng:\s*(.+)$', b, re.S)
        if mt:
            t = re.sub(r'\s+', ' ', mt.group(1).strip())
            ev['sim'] = {'text': t, 'date': date}
            tl = t.lower()
            ev['no_zalo'] = 'không có tài khoản zalo' in tl
            ev['has_zalo_txt'] = bool(re.search(r'(?<!không )(đã )?có tài khoản zalo', tl))
            if 'đã chết' in tl:
                ev['die'] = True
            continue
        if re.search(r'^(?:\S+\s*-\s*)?e?mail:\s*\S+\s*-\s*tồn tại', b, re.I):
            continue
        mw = re.search(r'TÊN TK\s*[-:]\s*(.+?)\s*/\s*ID ĐĂNG NHẬP\s*[-:]\s*(\S+?)\s*/\s*(?:MÃ PIN\s*[-:]\s*\S+\s*/\s*)?S[ĐD]T\s*[-:]\s*(\S+)', b, re.I)
        if mw:
            ev['ws'] = {'name': clean_name(mw.group(1)), 'login': first_phone(mw.group(2)), 'phone': first_phone(mw.group(3))}
            continue
        if re.fullmatch(r'(đã chết|không tìm thấy tài khoản)\.?', b, re.I):
            ev['die'] = True
            ev['notes'].append((date, b))
            continue
        if sc.scan(b):
            continue
        if len(b) < 140 and not b.startswith('Định dạng'):
            ev['notes'].append((date, re.sub(r'\s+', ' ', b)))
    return ev, sc.done()
