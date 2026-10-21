# -*- coding: utf-8 -*-
"""Vọng gác · checker Telegram (check live theo username).

Mở https://t.me/<username> (trang công khai, không cần đăng nhập). Đã đối chiếu trang thật:
  · Die  : username không tồn tại -> trang chỉ có dòng "If you have Telegram, you can contact @<username> right away." (không có tên / ảnh)
  · Live : có tên hiển thị (tgme_page_title / og:title = tên) -> tài khoản, bot ("Start Bot"), kênh, nhóm ("View in Telegram")
  · Lỗi mạng / bị giới hạn / không nhận ra trang -> error: giữ nguyên trạng thái.
Live thì ghi thêm tên hiển thị vào cột "Tên Telegram" (cùng 1 request, không tốn thêm)."""
import html as _html
import random
import re
import threading
import time
import urllib.error
import urllib.request
import zlib

CHECKER = {
    'id': 'telegram',
    'name': 'Telegram',
    'icon': 'send',
    'value': 'Username Telegram',
    'hint_tab': ['telegram', 'tele', 'tg'],
    'hint_field': ['telegram', 'username', 'user name', 'tele', 'tg', 'user', 'id'],
    'fields': [],
    'extra': [{'k': 'name', 'label': 'Tên Telegram', 'type': 'text', 'icon': 'send',
               'match': ['ten telegram', 'ten tele', 'ten tg', 'telegram name', 'ten', 'name', 'ho ten'],
               'hint': 'Tên hiển thị · chỉ ghi khi Live'}],
    'desc': 't.me/<username>: có tên hiển thị = Live · "If you have Telegram, you can contact @… right away" = Die · lỗi / bị giới hạn = giữ nguyên. Nhận @user, user, t.me/user.',
    'threads': 8, 'timeout': 10,
}

_BASE = 'https://t.me/'
_LINK = re.compile(r'(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)/(?:s/)?@?([A-Za-z0-9_]+)', re.I)
_PLAIN = re.compile(r'^@?([A-Za-z0-9_]+)$')
_VALID = re.compile(r'^[A-Za-z][A-Za-z0-9_]{4,31}$')           # quy tắc username Telegram: 5–32 ký tự, bắt đầu bằng chữ
_DIE = re.compile(r'If you have\s*Telegram\s*,\s*you can contact\s*@\w+\s*right away', re.I)
_META = re.compile(r'<meta\b[^>]*>', re.I)
_TITLE_DIV = re.compile(r'class="tgme_page_title"[^>]*>(.*?)</div>', re.S | re.I)
_GENERIC = re.compile(r'^\s*Telegram\s*[:\-–]', re.I)


def norm(value):
    """lấy username từ giá trị ô: @user · user · https://t.me/user · t.me/user?start=x -> user (không hợp lệ -> '')"""
    v = str(value or '').strip()
    m = _LINK.search(v) or _PLAIN.match(v)
    u = m.group(1) if m else ''
    return u if _VALID.match(u) else ''


class Stopped(Exception):
    pass


def _stopped(opt):
    f = (opt or {}).get('stopped')
    return bool(f and f())


def _nap(sec, opt):
    end = time.time() + sec
    while True:
        if _stopped(opt):
            raise Stopped()
        left = end - time.time()
        if left <= 0:
            return
        time.sleep(min(0.1, left))


# cổng giãn nhịp: t.me chịu tải khá tốt nhưng gửi dồn dập sẽ bị 429 -> khoảng cách tối thiểu tự tăng khi bị 429
_LOCK = threading.Lock()
_NEXT = [0.0]
_IV = [0.04]


def _gate(opt):
    with _LOCK:
        now = time.time()
        slot = max(now, _NEXT[0])
        _NEXT[0] = slot + _IV[0]
    if slot > now:
        _nap(slot - now, opt)


def _meta(h, prop):
    for t in _META.findall(h[:40000]):
        if re.search(r'(?:property|name)="%s"' % re.escape(prop), t, re.I):
            c = re.search(r'content="([^"]*)"', t)
            if c:
                return _html.unescape(c.group(1)).strip()
    return ''


def parse(h):
    """-> ('live'|'die'|None, ghi chú, tên)"""
    text = _html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ', h, flags=re.S | re.I)))
    text = re.sub(r'\s+', ' ', text)
    name = ''
    m = _TITLE_DIV.search(h)
    if m:
        name = re.sub(r'\s+', ' ', _html.unescape(re.sub(r'<[^>]+>', '', m.group(1)))).strip()
    og = _meta(h, 'og:title')
    if not name and og and not _GENERIC.match(og):
        name = og
    if name:
        return 'live', 'Live', name
    if _DIE.search(text):
        return 'die', 'Die · không có tài khoản này', ''
    if 'tgme_page' in h and ('tgme_page_photo' in h or 'tgme_page_title' in h):
        return 'live', 'Live', ''
    return None, 'không nhận ra trang t.me', ''


def _get(u, opt):
    hs = []
    px = opt.get('proxy') or ''
    if px:
        p = px if '://' in px else 'http://' + px
        hs.append(urllib.request.ProxyHandler({'http': p, 'https': p}))
    req = urllib.request.Request(_BASE + u, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'gzip'})
    try:
        r = urllib.request.build_opener(*hs).open(req, timeout=float(opt.get('timeout') or 10))
        code, hd, raw = r.status, r.headers, r.read(200000)
    except urllib.error.HTTPError as e:
        code, hd = e.code, e.headers
        try:
            raw = e.read(20000)
        except Exception:
            raw = b''
    if raw[:2] == b'\x1f\x8b':
        try:
            raw = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw)
        except Exception:
            pass
    return code, hd, raw.decode('utf-8', 'replace')


def check(value, opt=None):
    opt = opt or {}
    u = norm(value)
    if not u:
        return 'error', 'Username không hợp lệ (5–32 ký tự, chữ / số / _)'
    want = 'name' in (opt.get('xon') if opt.get('xon') is not None else ['name'])
    why = ''
    try:
        for i in range(3):
            _gate(opt)
            try:
                code, hd, h = _get(u, opt)
            except Exception as e:
                why = type(e).__name__
                _nap(0.4 * (i + 1) + random.random() * 0.3, opt)
                continue
            if code == 429:
                with _LOCK:
                    _IV[0] = min(1.0, _IV[0] * 2 + 0.05)
                    _NEXT[0] = max(_NEXT[0], time.time() + 1.5)
                why = 'Telegram giới hạn tốc độ (giảm luồng / dùng proxy)'
                try:
                    _nap(min(5.0, float(hd.get('Retry-After') or 1.5)), opt)
                except ValueError:
                    _nap(1.5, opt)
                continue
            if code != 200:
                why = 'HTTP %s' % code
                _nap(0.4 * (i + 1), opt)
                continue
            with _LOCK:
                _IV[0] = max(0.04, _IV[0] * 0.9)
            res, info, name = parse(h)
            if res == 'live':
                return ('live', 'Live · %s' % name if name else 'Live', {'name': name}) if (want and name) else ('live', 'Live')
            if res == 'die':
                return 'die', info
            why = info
            _nap(0.4 * (i + 1), opt)
    except Stopped:
        return 'error', 'Đã dừng'
    return 'error', why or 'chưa đọc được trang t.me'
