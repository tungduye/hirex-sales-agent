# -*- coding: utf-8 -*-
"""Vọng gác · checker Facebook (check live theo UID).

Mỗi checker là 1 file checkXXX.py trong thư mục checker/, khai báo:
    CHECKER = {...}            # thông tin hiển thị + gợi ý chọn tab/trường
    def check(value, opt):     # -> ('live' | 'die' | 'error', 'ghi chú ngắn')
Thêm Email / WhatsApp sau này: copy file này thành checkmail.py / checkwa.py và sửa hàm check().
"""
import html as _html
import http.cookiejar
import json
import random
import re
import os
import threading
import time
import urllib.error
import urllib.request
import zlib
from urllib.parse import quote, unquote, urljoin, urlparse, urlsplit, urlunsplit

# tên "rác" Facebook trả khi bị chặn / trang trung gian (nhiều ngôn ngữ) -> không bao giờ ghi vào cột tên
JUNK = (r'^\s*(redirecting|đang chuyển hướng|log in|log into|login|sign up|sign in|đăng nhập|đăng ký|facebook\s*$|security check|kiểm tra bảo mật|'
        r'error\b|lỗi\b|page not found|content not found|something went wrong|you must log in|you\'re temporarily|bạn tạm thời|'
        r'this content isn|nội dung này hiện|this page isn|trang này hiện|oops|sorry|xin lỗi|checkpoint|connect with|kết nối với)|log in or sign up|đăng nhập hoặc đăng ký')
_JUNK = re.compile(JUNK, re.I)

CHECKER = {
    'id': 'fb',
    'name': 'Facebook',
    'icon': 'facebook',
    'value': 'UID Facebook',                 # nhãn của trường cần chọn
    'hint_tab': ['facebook', 'fb', 'via', 'clone'],
    'hint_field': ['uid', 'id facebook', 'id fb', 'fb id', 'id'],
    'fields': [{'k': 'cookie', 'label': 'Cookie', 'secret': True, 'ph': 'Tùy chọn · giúp đọc tên ổn định hơn'},
               {'k': 'refresh', 'label': 'Đọc lại tên', 'ph': 'Trống = chỉ đọc ô tên còn trống · 1 = đọc lại tất cả'}],
    # tên tài khoản đọc từ facebook.com/<uid> khi UID Live -> ghi vào 1 cột (tự tìm / tự tạo "Tên FB"); Die thì không ghi gì
    'extra': [{'k': 'name', 'label': 'Tên FB', 'type': 'text', 'icon': 'user',
               'match': ['ten fb', 'ten facebook', 'ten tai khoan', 'fb name', 'ten', 'name', 'ho ten'],
               'hint': 'Profile: Tên · Page: Page (Tên) · chỉ ghi khi Live',
               'skip_filled': True, 'junk': JUNK, 'stale': r'\s\|\s'}],
    'desc': 'Graph picture: có ảnh thật = Live · ảnh trống (rsrc.php, không có height) = Die · bị giới hạn / lỗi = giữ nguyên. Live thì mở facebook.com/<uid> đọc tên.',
    'threads': 5, 'timeout': 12,
}

PAGE_TAG = True                              # True: Page ghi "Page (Tên)" · False (tab FB Page): ghi tên thẳng

_UID = re.compile(r'(\d{5,20})')


def norm(value):
    """lấy UID số từ giá trị ô (chấp nhận cả link facebook.com/profile.php?id=...)"""
    m = _UID.search(str(value or ''))
    return m.group(1) if m else ''


GRAPH = 'https://graph.facebook.com'
_RATE = {4, 17, 32, 341, 613}                # mã lỗi Graph = bị giới hạn tốc độ (không phải Die)


def graph(uid, opt):
    """graph.facebook.com/<uid>/picture?redirect=false -> ('live'|'die'|None, ghi chú)
    Đã đối chiếu 120 UID thật với trang facebook.com/<uid>:
      Live: JSON có "height" + url ảnh thật (scontent…)  ·  Die: không có "height", url là ảnh trống static.xx.fbcdn.net/rsrc.php
      (302 KHÔNG đủ để kết luận: UID Die vẫn 302 sang ảnh trống -> cách cũ báo Live nhầm)"""
    req = urllib.request.Request(GRAPH + '/%s/picture?redirect=false&type=normal' % uid,
                                 headers={'User-Agent': random.choice(_UAS), 'Accept': 'application/json'})
    hs = []
    px = opt.get('proxy') or ''
    if px:
        p = px if '://' in px else 'http://' + px
        hs.append(urllib.request.ProxyHandler({'http': p, 'https': p}))
    try:
        r = urllib.request.build_opener(*hs).open(req, timeout=float(opt.get('timeout') or 10))
        code, body = r.status, r.read(20000)
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            body = e.read(20000)
        except Exception:
            body = b''
    try:
        j = json.loads(body.decode('utf-8', 'replace') or '{}')
    except Exception:
        j = {}
    err = j.get('error') if isinstance(j, dict) else None
    if err:
        if err.get('code') in _RATE or code in (429, 403):
            return None, 'Facebook giới hạn tốc độ (giảm luồng / dùng proxy)'
        if code in (400, 404):
            return 'die', 'Die · UID không tồn tại'
        return None, 'lỗi Graph %s' % err.get('code')
    d = j.get('data') if isinstance(j, dict) else None
    if code == 200 and isinstance(d, dict):
        url = str(d.get('url') or '')
        if d.get('height') or (url and 'rsrc.php' not in url):
            return 'live', 'Live'
        if 'rsrc.php' in url:
            return 'die', 'Die · không khả dụng'
    if code in (400, 404):
        return 'die', 'Die · %s' % code
    return None, 'HTTP %s' % code


def check(value, opt=None):
    try:
        return _check(value, opt)
    except Stopped:
        return 'error', 'Đã dừng'


def _check(value, opt=None):
    """Live/Die: graph.facebook.com (nhanh, nhẹ, chính xác) · không rõ thì đối chiếu HTML facebook.com/<uid> (route CometErrorRoute = Die).
    Live thì mở facebook.com/<uid> đọc tên (nếu bật). Lỗi mạng / bị chặn / không chắc -> error: giữ nguyên trạng thái."""
    opt = opt or {}
    uid = norm(value)
    if not uid:
        return 'error', 'UID không hợp lệ'
    fmt = opt.get('fmt') or (('Page (%s)' if opt.get('page_tag', PAGE_TAG) else '%s'), '%s')     # (định dạng khi là Page, định dạng khi là profile)
    want = 'name' in (opt.get('xon') if opt.get('xon') is not None else ['name'])
    res, info = None, ''
    for i in range(2):                                   # lỗi mạng -> thử lại 1 lần
        _nap(random.uniform(0.02, 0.15), opt)
        try:
            res, info = graph(uid, opt)
        except Exception as e:
            res, info = None, type(e).__name__
        if res:
            break
        if i == 0:
            _nap(0.5, opt)
    if not res:                                          # Graph không rõ -> hỏi trang HTML
        try:
            st, fu, html = fetch_gated(uid, opt)
            r2, i2, nm = classify(uid, st, fu, html, fmt)
        except Exception as e:
            return 'error', info or type(e).__name__
        if r2 == 'error':
            return 'error', '%s · %s' % (info, i2) if info else i2
        return (r2, i2, {'name': nm}) if (r2 == 'live' and want and nm) else (r2, i2)
    if res == 'die' or not want:
        return res, info
    have = str((opt.get('have') or {}).get('name') or '').strip()
    if have and not _JUNK.search(have) and not str((opt.get('x') or {}).get('refresh') or '').strip().lower() in ('1', 'x', 'true', 'có', 'co'):
        return 'live', 'Live · đã có tên'                # lượt chạy lớn: chỉ đọc tên cho ô còn trống / tên rác (đặt "Đọc lại tên" = 1 để đọc lại tất cả)
    _gate_slots(opt.get('threads'))
    _warm(opt)
    nm, why = read_name(uid, opt, fmt)
    return ('live', 'Live · %s' % nm, {'name': nm}) if nm else ('live', 'Live · %s' % why)


# ───────── đọc tên tài khoản từ HTML facebook.com/<uid> (đã đối chiếu với HTML thật: profile / page) ─────────
# Profile : <meta og:title="Truong An">  ·  canonicalRouteName = comet.fbweb.CometProfileLoggedOutRoute
# Page    : <meta og:title="Hạ Anhhh">   ·  canonicalRouteName = comet.fbweb.CometProfilePlusLoggedOutRoute  (+ "delegate_page":{"id":...})
# og:title nằm đầu trang (~1KB), route ở ~130KB -> chỉ tải ≤ 450KB đầu rồi dừng, không tải hết ~1MB.
_RT = re.compile(r'canonicalRouteName":"comet\.fbweb\.(\w+)"')
_DP = re.compile(r'"delegate_page":\{"id":"\d+"')
_FOL = re.compile(r'\d\s*(?:[kKmM]\s*)?(?:followers?|người theo dõi|lượt theo dõi)\b', re.I)
_GENERIC = {'redirecting...', 'redirecting…', 'redirecting', 'đang chuyển hướng...', 'facebook', 'log in to facebook', 'log into facebook', 'đăng nhập facebook', 'đăng nhập hoặc đăng ký',
            'facebook - log in or sign up', 'facebook – log in or sign up', 'error', 'lỗi', 'security check', 'page not found',
            'content not found', 'nội dung này hiện không khả dụng', 'this content isn\'t available right now'}
_GOOD_RT = re.compile(r'^Comet(Profile|Page)')
_RTB = re.compile(rb'canonicalRouteName":"comet\.fbweb\.\w+"')

def _meta(html, prop):
    for m in re.finditer(r'<meta\b[^>]*>', html[:60000]):
        t = m.group(0)
        if re.search(r'(?:property|name)="%s"' % re.escape(prop), t):
            c = re.search(r'content="([^"]*)"', t)
            if c:
                return _html.unescape(c.group(1)).strip()
    return ''


def _route(html):
    m = _RT.search(html)
    return m.group(1) if m else ''


def _strip_loc(nm, desc):
    """Page có đặt địa điểm: og:title = "Tên | Địa điểm " (mô tả: "Tên, Địa điểm. …") -> chỉ lấy Tên.
    Tên có "|" thật (mô tả bắt đầu bằng đúng tiêu đề) thì giữ nguyên."""
    m = re.match(r'^(.*\S)\s+\|\s+([^|]+?)\s*$', nm)
    if not m:
        return nm
    if (desc or '').strip().startswith(nm):
        return nm
    return m.group(1).strip()


def parse_plugin(html, uid, page_tag=True):
    """Page Plugin: <a class="_1drp _5lv6" title="Tên" …>Tên</a> -> (tên, '') · profile cá nhân / lỗi -> ('', lý do)"""
    m = re.search(r'<a\b[^>]*class="[^"]*\b_1drp\b[^"]*"[^>]*>([^<]*)</a>', html)
    if not m:
        return '', 'plugin: không phải Page'
    t = re.search(r'\btitle="([^"]*)"', m.group(0))
    nm = _html.unescape((t.group(1) if t else m.group(1)) or '').strip()
    if not nm or nm.lower() in _GENERIC or _JUNK.search(nm):
        return '', 'plugin: tên không hợp lệ'
    return ('Page (%s)' % nm if page_tag else nm), ''


_PN = re.compile(r'"pageName":"((?:[^"\\]|\\.)*)"')


def parse_plugin2(html):
    """Page Plugin -> (tên sạch | '', là_Page_kiểu_cũ). Hai dạng trang:
       · Page: <a class="_1drp" title="Tên"> (~50KB, có "Follow Page") -> chắc chắn Page
       · Page mới / profile chuyên nghiệp: tên nằm trong props JSON "pageName" (~78KB) -> chỉ có TÊN, KHÔNG phân biệt được loại"""
    m = re.search(r'<a\b[^>]*class="[^"]*\b_1drp\b[^"]*"[^>]*>([^<]*)</a>', html)
    if m:
        t = re.search(r'\btitle="([^"]*)"', m.group(0))
        nm, pg = _html.unescape((t.group(1) if t else m.group(1)) or '').strip(), True
    else:
        m = _PN.search(html)
        if not m:
            return '', False
        try:
            nm = json.loads('"%s"' % m.group(1)).strip()
        except Exception:
            return '', False
        pg = False
    if not nm or nm.lower() in _GENERIC or _JUNK.search(nm):
        return '', pg
    return nm, pg


def _parse(html, uid):
    """-> (tên | '', loại, lý do). loại: 'page' (route CometPage…) · 'profile' (CometProfile…) · 'plus' (CometProfilePlus…).
    CHÚ Ý 'plus': route ProfilePlus dùng cho CẢ Page kiểu mới LẪN profile bật chế độ chuyên nghiệp (đã đối chiếu trên Facebook thật:
    HTML khi chưa đăng nhập của 2 loại này giống hệt nhau) -> không được suy ra Page từ route; phải hỏi Plugin Page (Page thật mới có class _1drp)."""
    head = html[:60000]
    nm = _meta(html, 'og:title')
    if not nm:
        t = re.search(r'<title[^>]*>([^<]*)</title>', head, re.I)
        nm = _html.unescape(t.group(1)).strip() if t else ''
    nm = re.sub(r'\s*[|\-–]\s*Facebook\s*$', '', nm).strip()
    nm = _strip_loc(nm, _meta(html, 'og:description'))
    if not nm or nm.lower() in _GENERIC or _JUNK.search(nm):
        return '', '', 'chưa đọc được tên (trang đăng nhập / bị chặn)'
    if uid not in head:                         # og:url / al:android:url = fb://profile/<uid>
        return '', '', 'chưa đọc được tên (trang không khớp UID)'
    rt = _route(html)
    if not _GOOD_RT.match(rt):                  # chỉ tin tên khi route đúng là trang profile / page (không phải trang đăng nhập, lỗi, trung gian)
        return '', '', 'chưa đọc được tên (%s)' % (rt or 'trang chưa tải đủ')
    return nm, ('page' if rt.startswith('CometPage') else 'plus' if 'ProfilePlus' in rt else 'profile'), ''


def parse_name(html, uid, fmt=('Page (%s)', '%s')):
    """-> (tên | '', lý do). Loại 'plus' (chưa phân biệt được Page / profile chuyên nghiệp) -> KHÔNG trả tên, để nơi gọi hỏi Plugin."""
    nm, kind, why = _parse(html, uid)
    if not nm:
        return '', why
    if kind == 'plus':
        return '', 'chưa phân biệt Page / profile'
    return (fmt[0] if kind == 'page' else fmt[1]) % nm, ''


def classify(uid, st, fu, html, fmt=('Page (%s)', '%s')):
    """-> ('live'|'die'|'error', ghi chú, tên)"""
    path = urlparse(fu or '').path.lower()
    if st == 404:
        return 'die', '404', ''
    if st in (401, 403, 429) or st >= 500:
        return 'error', 'HTTP %s (bị chặn / lỗi Facebook)' % st, ''
    if path.startswith(('/login', '/checkpoint', '/recover')):
        return 'error', 'bị đẩy về đăng nhập (thử proxy / cookie)', ''
    nm, why = parse_name(html, uid, fmt)
    if nm:
        return 'live', 'Live', nm
    rt = _route(html)
    if rt.startswith('CometProfilePlus'):         # sống (Page mới / profile chuyên nghiệp) nhưng chưa biết loại: tên sẽ đọc ở lượt sau
        return 'live', 'Live', ''
    if rt == 'CometErrorRoute':
        return 'die', 'Die · nội dung không khả dụng', ''
    if not rt:
        return 'error', 'chưa đọc được trang (bị chặn / chưa tải đủ)', ''
    return 'error', 'chưa xác định (%s)' % rt, ''


_TL = threading.local()

# ───────── chạy số lượng lớn đa luồng ─────────
# Graph (Live/Die) nhẹ nên chạy đủ số luồng. Đọc tên đi qua 2 "cổng" riêng (HTML ~300KB · Plugin Page ~50KB), mỗi cổng:
#  · giới hạn số request đồng thời (theo số luồng) + khoảng cách tối thiểu giữa 2 request cho cả lượt chạy
#  · tự điều chỉnh theo TỈ LỆ LỖI gần đây (trung bình trượt): lỗi nhiều -> giãn khoảng cách (tối đa x11), ổn lại -> thu hẹp. 429 -> nghỉ thêm 2s
#  · 1 bộ cookie dùng chung (như 1 trình duyệt: có datr)
_TL = threading.local()
_JAR = http.cookiejar.CookieJar()
_WARM = [0.0]


class Stopped(Exception):
    """người dùng bấm Dừng"""


def _stopped(opt):
    f = (opt or {}).get('stopped')
    return bool(f and f())


def _nap(sec, opt):
    """ngủ nhưng nhả ngay khi bấm Dừng (kiểm tra mỗi ≤0.1s)"""
    end = time.time() + sec
    while True:
        if _stopped(opt):
            raise Stopped()
        left = end - time.time()
        if left <= 0:
            return
        time.sleep(min(0.1, left))


class _Gate:
    def __init__(self, ivmin, cap, slots):
        self.ivmin, self.cap, self.n = ivmin, cap, slots
        self.lock = threading.Lock()
        self.sem = threading.BoundedSemaphore(slots)
        self.next = 0.0
        self.f = 0.0                                   # tỉ lệ lỗi gần đây (0..1)

    def slots(self, n):
        with self.lock:
            if n != self.n:
                self.n, self.sem = n, threading.BoundedSemaphore(n)

    def iv(self):
        return min(self.cap, self.ivmin * (1 + 10 * self.f))

    def run(self, fn, opt=None):
        sem = self.sem
        while not sem.acquire(timeout=0.1):                # chờ chỗ trống nhưng vẫn nghe lệnh Dừng
            if _stopped(opt):
                raise Stopped()
        try:
            if _stopped(opt):
                raise Stopped()
            with self.lock:
                now = time.time()
                slot = max(now, self.next)
                self.next = slot + self.iv()
            if slot > now:
                _nap(slot - now, opt)
            return fn()
        finally:
            sem.release()

    def note(self, ok, hard=False):
        with self.lock:
            self.f = self.f * 0.85 + (0.0 if ok else 0.15)
            if hard:
                self.next = max(self.next, time.time() + 2.0)


_G_HTML = _Gate(0.2, 2.5, 4)
_G_PLG = _Gate(0.1, 1.5, 6)


def _gate_slots(threads):
    t = int(threads or 10)
    _G_HTML.slots(max(2, min(6, t // 5)))
    _G_PLG.slots(max(2, min(10, t // 4)))
    _G_GQL.slots(max(2, min(10, t // 4)))


def _warm(opt):
    """lấy cookie nền (datr…) 1 lần / 20 phút, chỉ đọc header"""
    if time.time() - _WARM[0] < 1200 or (opt.get('x') or {}).get('cookie'):
        return
    _WARM[0] = time.time()
    try:
        px = opt.get('proxy') or ''
        hs = [urllib.request.HTTPCookieProcessor(_JAR)]
        if px:
            p = px if '://' in px else 'http://' + px
            hs.append(urllib.request.ProxyHandler({'http': p, 'https': p}))
        r = urllib.request.build_opener(*hs).open(urllib.request.Request('https://www.facebook.com/', headers=_hdr(opt)), timeout=10)
        r.read(2048)
        r.close()
    except Exception:
        pass


def fetch_gated(uid, opt, variant=0):
    """trang HTML facebook.com/<uid> qua cổng · trả (st, url, html) · ném lỗi mạng"""
    return _G_HTML.run(lambda: fetch(uid, opt, variant), opt)


def plugin_url(uid):
    return 'https://www.facebook.com/plugins/page.php?href=%s&tabs=&width=340&height=130&small_header=true' % quote('https://www.facebook.com/' + uid, safe='')


def fetch_plugin(uid, opt, variant=0):
    """Page Plugin (embed chính thức, ~50KB): trả TÊN PAGE sạch (không kèm "| Địa điểm"). Chỉ Page; profile cá nhân không có -> trang lỗi 19KB"""
    return _G_PLG.run(lambda: _read_head(plugin_url(uid), _hdr(opt, variant, True), float(opt.get('timeout') or 10) + 5, opt.get('proxy') or '', cap=120_000), opt)



# ───────── phân loại Page / profile chuyên nghiệp: truy vấn GraphQL công khai (không cần đăng nhập) ─────────
# Trang facebook.com/<uid> (route ProfilePlus) tự gọi ProfilePlusCometLoggedOutRootQuery; phản hồi có dòng giới thiệu
#   "Page · Recruiter"  (Page)   |   "Profile · Digital creator" (profile bật chế độ chuyên nghiệp)       [đã đối chiếu 10 UID thật; Nga NNga = Page đúng]
# Dòng này nằm ngay đầu phản hồi (~3-4KB) -> chỉ đọc 16KB đầu rồi đóng. Không cần lsd / cookie / token.
_GQL_URL = 'https://www.facebook.com/api/graphql/'
_GQL_NAME = 'ProfilePlusCometLoggedOutRootQuery'
_GQL_DOC = ['28585259111117102']              # doc_id hiện tại; Facebook đổi thì tự dò lại trong bundle JS (xem _gql_discover)
_GQL_LOCK = threading.Lock()
_GQL_TRY = [0.0]
_G_GQL = _Gate(0.1, 1.5, 6)
_KIND_WORDS = {'page': {'page', 'trang', 'página', 'pagina', 'seite', 'halaman', 'страница'},
               'profile': {'profile', 'trang cá nhân', 'perfil', 'profil', 'profilo', 'profiel', 'профиль'}}
_CAT = re.compile(r'InfluencerCategoryContextItemRenderer.{0,1500}?"text":"((?:[^"\\]|\\.)*)"', re.S)


def parse_gql(body):
    """-> ('page' | 'profile' | None, dòng giới thiệu)"""
    m = _CAT.search(body or '')
    if not m:
        return None, ''
    try:
        t = json.loads('"%s"' % m.group(1))
    except Exception:
        t = m.group(1)
    first = t.split('\u00b7')[0].strip().lower()
    for k, ws in _KIND_WORDS.items():
        if first in ws:
            return k, t
    return None, t


def _gql_body(uid, doc):
    from urllib.parse import urlencode
    return urlencode({'av': '0', '__a': '1', '__comet_req': '15', 'fb_api_caller_class': 'RelayModern', 'fb_api_req_friendly_name': _GQL_NAME,
                      'variables': json.dumps({'scale': 1, 'userID': uid, '__relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider': False}, separators=(',', ':')),
                      'server_timestamps': 'true', 'doc_id': doc}).encode()


def _gql_discover(uid, opt):
    """doc_id đổi theo bản build của Facebook: đọc lại từ các file JS của trang (tối đa 1 lần / 10 phút)"""
    with _GQL_LOCK:
        if time.time() - _GQL_TRY[0] < 600:
            return False
        _GQL_TRY[0] = time.time()
    try:
        st, fu, html = _read_head('https://www.facebook.com/%s' % uid, _hdr(opt), float(opt.get('timeout') or 10) + 8, opt.get('proxy') or '', cap=450_000)
        urls = []
        for m in re.finditer(r'https:\\?/\\?/static\.xx\.fbcdn\.net\\?/rsrc\.php\\?/[^"\'\s\\]+?\.js', html):
            u = m.group(0).replace('\\/', '/').replace('\\', '')
            if u not in urls:
                urls.append(u)
        for u in urls[:14]:
            h2 = _hdr(opt)
            h2['Accept'] = '*/*'
            st2, _, js = _read_head(u, h2, 20, opt.get('proxy') or '', cap=6_000_000)
            m = re.search(r'__d\("%s_facebookRelayOperation",\[\],\(function\([^)]*\)\{[a-z]\.exports="(\d+)"' % _GQL_NAME, js)
            if m:
                _GQL_DOC[0] = m.group(1)
                return True
    except Exception:
        pass
    return False


def fetch_gql(uid, opt, variant=0):
    """-> (kind, dòng giới thiệu, lý do). kind: 'page' | 'profile' | None"""
    def go():
        h = _hdr(opt, variant)
        h.update({'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://www.facebook.com',
                  'Referer': 'https://www.facebook.com/', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
                  'X-FB-Friendly-Name': _GQL_NAME})
        h.pop('Upgrade-Insecure-Requests', None)
        h.pop('Sec-Fetch-User', None)
        return _read_head(_GQL_URL, h, float(opt.get('timeout') or 10) + 5, opt.get('proxy') or '', cap=16_000, data=_gql_body(uid, _GQL_DOC[0]))
    st, fu, body = _G_GQL.run(go, opt)
    _TL.log = getattr(_TL, 'log', []) + ['gql:%s' % st]
    if st == 200:
        k, t = parse_gql(body)
        _G_GQL.note(True)
        if k:
            return k, t, ''
        if '"errors"' in body[:400] or 'data' not in body[:20]:
            if _gql_discover(uid, opt):
                return None, '', 'doc_id đã đổi (đã dò lại)'
        return None, t, 'không thấy dòng Page / Profile'
    _G_GQL.note(False, hard=st == 429)
    return None, '', 'gql HTTP %s' % st

_OK_HOST = lambda h: h == 'facebook.com' or h.endswith('.facebook.com')


class _NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _fix_url(loc, base):
    """Facebook trả Location dạng JSON-escape: /people/Th\\u0025C3\\u0025B9y-Trang/... (\\u0025 = %) -> urllib theo nguyên văn thì Facebook trả HTTP 400.
    Giải mã \\uXXXX, ghép với URL gốc, mã hóa % đúng chuẩn."""
    loc = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), loc.strip())
    p = urlsplit(urljoin(base, loc))
    return urlunsplit((p.scheme, p.netloc, quote(p.path, safe="/%:@!$&'()*+,;=-._~"), quote(p.query, safe="=&%:/?+,;@-._~"), ''))


_CF = None


def _cf():
    """curl_cffi (giả lập TLS/HTTP2 của Chrome thật) nếu đã cài: pip install curl_cffi · không có -> dùng urllib"""
    global _CF
    if _CF is None:
        try:
            from curl_cffi import requests as r
            _CF = r
        except Exception:
            _CF = False
    return _CF


def _cf_sess(proxy):
    s = getattr(_TL, 'cfs', None)
    if s is None or getattr(_TL, 'cfp', None) != proxy:
        try:
            s = _cf().Session(impersonate='chrome')
        except Exception:
            s = _cf().Session(impersonate='chrome120')
        _TL.cfs, _TL.cfp = s, proxy
    return s


def _read_cffi(url, hdr, timeout, proxy, cap, data=None):
    s = _cf_sess(proxy)
    h = {k: v for k, v in hdr.items() if k in ('Cookie', 'Referer', 'Accept-Language', 'Sec-Fetch-Site', 'Sec-Fetch-Dest', 'Content-Type', 'Origin', 'X-FB-Friendly-Name')}    # UA / sec-ch-ua / Accept / ... do curl_cffi tự đặt theo Chrome thật
    kw = {'headers': h, 'timeout': timeout, 'allow_redirects': False}
    if proxy:
        p = proxy if '://' in proxy else 'http://' + proxy
        kw['proxies'] = {'http': p, 'https': p}
    _TL.chain = []
    for _hop in range(6):
        _TL.chain.append(url)
        r = s.post(url, data=data, stream=True, **kw) if data is not None else s.get(url, stream=True, **kw)
        code = r.status_code
        loc = r.headers.get('Location')
        if code in (301, 302, 303, 307, 308) and loc and _hop < 5:
            r.close()
            nxt = _fix_url(loc, url)
            if not _OK_HOST(urlsplit(nxt).hostname or ''):
                return code, nxt, ''
            url = nxt
            continue
        buf = b''
        try:
            for ch in r.iter_content():
                buf += ch
                if len(buf) >= cap or (code == 200 and _RTB.search(buf[-130000:])):
                    break
        finally:
            r.close()
        return code, url, buf.decode('utf-8', 'replace')[:cap]
    return 310, url, ''


def _read_head(url, hdr, timeout, proxy, cap=450_000, data=None):
    global _CF
    if _cf():
        try:
            return _read_cffi(url, hdr, timeout, proxy, cap, data)
        except (TypeError, AttributeError, NotImplementedError, ImportError):      # bản curl_cffi lạ -> bỏ, dùng urllib
            _CF = False
    return _read_urllib(url, hdr, timeout, proxy, cap, data)


def _read_urllib(url, hdr, timeout, proxy, cap=450_000, data=None):
    """tải HTML tối đa cap byte (giải nén gzip theo luồng, dừng ngay khi đã thấy route) -> (status, final_url, html).
    Tự đi theo chuyển hướng (≤5 lần, có cookie, sửa URL Facebook mã hóa sai); lỗi HTTP thì html = phần đầu nội dung lỗi."""
    hs = [_NoRedir(), urllib.request.HTTPCookieProcessor(_JAR if not hdr.get('Cookie') else http.cookiejar.CookieJar())]
    if proxy:
        p = proxy if '://' in proxy else 'http://' + proxy
        hs.append(urllib.request.ProxyHandler({'http': p, 'https': p}))
    op = urllib.request.build_opener(*hs)
    _TL.chain = []
    for _hop in range(6):
        _TL.chain.append(url)
        try:
            r = op.open(urllib.request.Request(url, data=data, headers=hdr), timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get('Location') and _hop < 5:
                nxt = _fix_url(e.headers.get('Location'), url)
                if not _OK_HOST(urlsplit(nxt).hostname or ''):
                    return e.code, nxt, ''
                url = nxt
                continue
            try:
                raw = e.read(6000)
                if raw[:2] == b'\x1f\x8b':
                    raw = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw)
                body = raw.decode('utf-8', 'replace')
            except Exception:
                body = ''
            return e.code, url, body
        gz = 'gzip' in (r.headers.get('Content-Encoding') or '').lower()
        d = zlib.decompressobj(16 + zlib.MAX_WBITS) if gz else None
        buf = b''
        while len(buf) < cap:
            ch = r.read(32768)
            if not ch:
                break
            buf += d.decompress(ch) if d else ch
            if _RTB.search(buf[-130000:]):
                break
        r.close()
        return r.status, url, buf.decode('utf-8', 'replace')
    return 310, url, ''


_CH = ('"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"', '"Chromium";v="123", "Microsoft Edge";v="123", "Not:A-Brand";v="8"')
_PROF = [   # bộ header ĐỒNG BỘ theo từng trình duyệt (UA khớp sec-ch-ua / sec-fetch-*) - Facebook chặn 400 khi UA nói Chrome mà thiếu/lệch header đi kèm
    ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', _CH[0]),
    ('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0', ''),
    ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0', _CH[1])]
_UAS = [p[0] for p in _PROF]


def _hdr(opt, variant=0, plugin=False):
    """header giống trình duyệt thật (thứ tự + sec-ch-ua + sec-fetch). variant đổi trình duyệt khi bị 400. plugin=True: kiểu iframe nhúng từ trang khác"""
    ua, ch = _PROF[(random.randrange(len(_PROF)) + variant) % len(_PROF)]
    hdr = {}
    if ch:
        hdr.update({'sec-ch-ua': ch, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"'})
    hdr.update({'Upgrade-Insecure-Requests': '1', 'User-Agent': ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Sec-Fetch-Site': 'cross-site' if plugin else 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' if plugin else 'document',
                'Accept-Encoding': 'gzip', 'Accept-Language': 'en-US,en;q=0.9'})
    if not plugin:
        hdr['Sec-Fetch-User'] = '?1'
    else:
        hdr['Referer'] = 'https://developers.facebook.com/'
    ck = str((opt.get('x') or {}).get('cookie') or '').strip()
    if ck:
        hdr['Cookie'] = ck
    return hdr


def fetch(uid, opt, variant=0):
    return _read_head('https://www.facebook.com/%s' % uid, _hdr(opt, variant), float(opt.get('timeout') or 10) + 5, opt.get('proxy') or '')


_REFRESH = re.compile(r'http-equiv="refresh"[^>]*content="\d+;\s*url=([^"]+)"|(?:location\.(?:replace|assign)\(|location(?:\.href)?\s*=\s*)["\']([^"\']+)["\']', re.I)


def _debug(uid, st, fu, html, why):
    """lưu đầu trang không đọc được tên vào checker/_fbdebug/<uid>.txt (tối đa 20 file) để soi khi cần"""
    try:
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_fbdebug')
        os.makedirs(d, exist_ok=True)
        fs = sorted((os.path.join(d, x) for x in os.listdir(d)), key=os.path.getmtime)
        for x in fs[:max(0, len(fs) - 19)]:          # giữ tối đa 20 file mới nhất
            os.remove(x)
        if True:
            with open(os.path.join(d, uid + '.txt'), 'w', encoding='utf-8') as f:
                f.write('%s\nclient=%s attempts=%s\nstatus=%s url=%s len=%d route=%s\nchain=%s\n\n%s' % (why, 'curl_cffi' if _cf() else 'urllib', ','.join(getattr(_TL, 'log', [])), st, fu, len(html), _route(html), ' -> '.join(getattr(_TL, 'chain', [])), html[:4000]))
    except Exception:
        pass


_SLUG = re.compile(r'^/(?:people|p)/([^/]+?)(?:-\d{10,20})?/(?:(pfbid\w+)|(\d{5,20}))?/?$')


def _slug_name(url):
    """dự phòng khi trang không tải được: lấy tên từ link chuyển hướng
       /people/<Tên>/pfbid…/ (profile) · /people/<Tên>/<uid>/ hoặc /p/<Tên>-<uid>/ (page) -> (tên, là_page)
       Lưu ý: Facebook bỏ dấu chấm / ký tự lạ trong link ("M.Huyền Trang" -> "MHuyền-Trang") nên tên suy từ link có thể thiếu ký tự đó."""
    path = urlparse(url or '').path
    m = _SLUG.match(path)
    if not m:
        return '', False
    nm = unquote(m.group(1)).replace('-', ' ').strip()
    if not nm or nm.lower().startswith('pfbid'):
        return '', False
    return nm, not m.group(2)


def read_name(uid, opt, fmt=('Page (%s)', '%s')):
    """-> (tên, '') | ('', lý do). Mỗi lần thử qua cổng riêng (giới hạn đồng thời + tự giãn theo tỉ lệ lỗi), đổi kiểu request khi bị 400.
    PHÂN LOẠI Page / profile (đã đối chiếu Facebook thật, kể cả Page kiểu mới & profile bật chế độ chuyên nghiệp):
      · HTML route CometPage… = Page cũ · CometProfile… = profile thường
      · HTML route CometProfilePlus… = Page mới HOẶC profile chuyên nghiệp (HTML 2 loại này giống hệt nhau) -> hỏi GraphQL công khai:
            dòng giới thiệu "Page · …" = Page · "Profile · …" = profile
      · Plugin Page kiểu cũ (class _1drp) cũng là bằng chứng Page
      · Không phân biệt được -> KHÔNG ghi tên (thà để trống, lượt sau đọc lại, còn hơn ghi nhầm)
    TÊN: HTML og:title (đã bỏ " | Địa điểm") hoặc Plugin (tên sạch).
    Thứ tự: tab FB Page (name_src='plugin'): Plugin ×2 → HTML ×2 · tab Facebook: HTML ×2 → (GraphQL khi cần loại) → Plugin."""
    q = ['plugin', 'plugin', 'html', 'html'] if opt.get('name_src') == 'plugin' else ['html', 'html', 'gql', 'plugin', 'gql', 'plugin']
    last, seen = 'chưa đọc được tên', ''
    hnm, hk = '', ''              # HTML: tên + loại ('page' | 'profile' | 'plus')
    pnm, ppage = '', False        # Plugin: tên + có _1drp (chắc chắn Page)
    gk = None                     # GraphQL: 'page' | 'profile' | None
    prog = True
    _TL.log = []
    tagged = fmt[0] != fmt[1]          # có phân biệt Page / profile khi ghi tên (tab Facebook: Page (Tên) · tab FB Page: Profile (Tên))

    def decide():
        nm = pnm if (pnm and (ppage or gk == 'page' or hk == 'page')) else (hnm or pnm)      # Page: ưu tiên tên sạch của plugin
        if not nm:
            return ''
        if not tagged:
            return fmt[0] % nm
        kind = hk if hk in ('page', 'profile') else gk or ('page' if ppage else '')
        if kind == 'page':
            return fmt[0] % nm
        if kind == 'profile':
            return fmt[1] % nm
        return ''

    def need_kind():
        return tagged and hk not in ('page', 'profile') and gk is None and not ppage

    n = 0
    st, fu, html = 0, '', ''
    while q:
        src = q.pop(0)
        if (src == 'plugin' and pnm) or (src == 'html' and hnm) or (src == 'gql' and not need_kind()):
            continue
        if n and not prog:                                  # lượt trước không tiến triển (lỗi / bị chặn) -> nghỉ rồi thử lại
            _nap((0.3, 0.8, 1.5)[min(n - 1, 2)] + random.random() * 0.4, opt)
        i, n = n, n + 1
        snap = (hnm, gk, pnm)
        st, fu, html = 0, '', ''
        try:
            if src == 'gql':
                k, t, why = fetch_gql(uid, opt, i)
                if k:
                    gk = k
                else:
                    last = 'chưa phân biệt được Page / profile (%s)' % why
            elif src == 'plugin':
                st, fu, html = fetch_plugin(uid, opt, i)
                _TL.log.append('plugin:%s' % st)
                if st == 200:
                    _G_PLG.note(True)
                    pnm, ppage = parse_plugin2(html)
                    if not pnm:
                        last = 'chưa đọc được tên (plugin không có tên)'
                else:
                    _G_PLG.note(False, hard=st == 429)
                    last = 'chưa đọc được tên (plugin HTTP %s)' % st
            else:
                st, fu, html = fetch_gated(uid, opt, i)
                _TL.log.append('html:%s' % st)
                for _hop in range(2):
                    m = _REFRESH.search(html[:20000]) if len(html) < 60000 or 'redirecting' in html[:3000].lower() else None
                    if not m:
                        break
                    nxt = _fix_url(_html.unescape(m.group(1) or m.group(2)).replace('\\/', '/'), fu)
                    if not _OK_HOST(urlsplit(nxt).hostname or '') or 'login' in nxt:
                        break
                    st, fu, html = _read_head(nxt, _hdr(opt, i), float(opt.get('timeout') or 10) + 5, opt.get('proxy') or '')
                seen = fu or seen
                if st == 200 and not urlparse(fu).path.lower().startswith(('/login', '/checkpoint')):
                    nm, kind, why = _parse(html, uid)
                    if nm:
                        hnm, hk = nm, kind
                        _G_HTML.note(True)
                    else:
                        last = why
                        _G_HTML.note(False)
                else:
                    last = 'chưa đọc được tên (HTTP %s)' % st
                    _G_HTML.note(False, hard=st == 429)
        except Stopped:
            raise
        except Exception as e:
            (_G_PLG if src == 'plugin' else _G_HTML).note(False)
            _TL.log.append('%s:%s' % (src, type(e).__name__))
            last = 'chưa đọc được tên (%s)' % type(e).__name__
        prog = (hnm, gk, pnm) != snap
        d = decide()
        if d:
            return d, ''
        if src == 'html' and hnm and need_kind():          # route ProfilePlus: cần biết Page hay profile -> GraphQL ngay
            q = ['gql', 'gql', 'plugin']
        elif src == 'plugin' and pnm and need_kind():          # plugin chỉ cho tên (không rõ loại) -> hỏi GraphQL
            q = ['gql', 'gql', 'html']
        elif src == 'gql' and gk and not (hnm or pnm):     # biết loại rồi nhưng chưa có tên -> plugin
            q = ['plugin', 'plugin', 'html']
    _debug(uid, st, fu, html, last)
    if not _cf() and '400' in last:
        last += ' · cài curl_cffi: pip install curl_cffi'
    return '', last
