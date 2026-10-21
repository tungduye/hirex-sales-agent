# -*- coding: utf-8 -*-
"""Vọng gác · checker Bài đăng FB (bài viết LIVE / DIE theo UID bài viết).
Logic nhận diện tham khảo từ fb_checklive.py (không phụ thuộc ngôn ngữ):
  - LIVE: facebook.com/{uid} bị chuyển hướng sang URL thật của bài viết, hoặc trang có post_id/story_fbid/og:url chứa UID.
  - DIE : HTTP 404, mã lỗi nội bộ FB (1357031, 1357004…), hoặc trang vỏ chung "Facebook" không có dữ liệu bài.
  - Bị chặn (403/429), bị đẩy về login/checkpoint, lỗi mạng -> Lỗi (giữ nguyên trạng thái).
Có cài curl_cffi (pip install curl_cffi) thì tự dùng để giống trình duyệt hơn; không có thì dùng thư viện chuẩn."""
import json
import random
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

try:
    from curl_cffi import requests as _cffi
except Exception:
    _cffi = None

CHECKER = {
    'id': 'fbpost',
    'name': 'Bài đăng FB',
    'icon': 'note',
    'value': 'UID bài viết',
    'hint_tab': ['bai dang fb', 'bai dang', 'post fb', 'fb post', 'bai viet'],
    'hint_field': ['uid bai viet', 'uid bai dang', 'post id', 'id bai viet', 'uid', 'link bai viet', 'link'],
    'fields': [{'k': 'cookie', 'label': 'Cookie', 'secret': True, 'ph': 'Tùy chọn · giúp đọc bài ổn định hơn'}],
    # số liệu đọc thêm khi bài LIVE -> ghi vào 1 cột của tab (Vọng gác tự tìm / tự tạo cột)
    'extra': [{'k': 'comments', 'label': 'Số bình luận', 'type': 'number', 'icon': 'chat',
               'match': ['so binh luan', 'binh luan', 'so comment', 'comment', 'comments', 'so cmt', 'cmt'], 'hint': 'Ghi khi bài Live'}],
    'threads': 5, 'timeout': 15,
}

URL = 'https://www.facebook.com/{uid}'
UAS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15']
DIE_CODES = ('1357031', '1357004', '1357001', '1357002', '1357033')


def norm(value):
    """UID bài từ số thuần hoặc link (story_fbid=, fbid=, posts/, videos/, permalink/)"""
    s = str(value or '').strip()
    if not s:
        return ''
    if s.isdigit():
        return s
    m = re.search(r'(?:story_fbid=|fbid=|posts/|videos/|permalink/|reel/|/)(\d{6,})', s)
    if m:
        return m.group(1)
    m = re.search(r'\d{6,}', s)
    return m.group(0) if m else ''


def classify(uid, status, final_url, html):
    u = (final_url or '').lower()
    if status == 404:
        return 'die', 'HTTP 404'
    if status in (429, 403):
        return 'error', 'Bị chặn HTTP %s (giảm luồng / đổi proxy)' % status
    if '/login' in u or 'checkpoint' in u or 'login.php' in u:
        return 'error', 'Bị chuyển về login/checkpoint'
    path = urlparse(final_url or '').path.rstrip('/')
    if uid in (final_url or '') and path != '/' + uid:
        return 'live', 'Chuyển hướng về URL bài viết'
    if status >= 500:
        return 'error', 'Lỗi server HTTP %s' % status
    for code in DIE_CODES:
        if re.search(r'"error"\s*:\s*' + code, html) or ('error_code":%s' % code) in html:
            return 'die', 'Mã lỗi FB %s' % code
    if re.search(r'"(?:story_fbid|top_level_post_id|post_id|video_id)"\s*:\s*"?' + re.escape(uid), html):
        return 'live', 'Có post_id/story_fbid'
    m = re.search(r'<meta[^>]+property="og:url"[^>]+content="([^"]+)"', html)
    if m and uid in m.group(1):
        return 'live', 'og:url chứa UID'
    m = re.search(r'<meta[^>]+property="og:type"[^>]+content="([^"]+)"', html)
    if m and m.group(1) in ('article', 'video.other', 'video.movie', 'website') and re.search(r'<meta[^>]+property="og:title"', html) and uid in html:
        return 'live', 'og:type=%s' % m.group(1)
    if status == 200 and not re.search(r'property="og:title"', html) and uid not in html:
        return 'die', 'Trang không có dữ liệu bài viết'
    t = re.search(r'<title[^>]*>(.*?)</title>', html, re.S | re.I)
    title = (t.group(1).strip()[:50] if t else '')
    if status == 200 and path == '/' + uid and title.lower() == 'facebook':
        return 'die', "Trang chung 'Facebook'"
    return 'error', 'Không xác định (HTTP %s)' % status


# ───────── số bình luận (theo fb_checklive.py: đọc từ HTML bài LIVE, không tốn thêm request) ─────────
_NUM = r'([\d.,]+\s?[KkMm]?)'
_CMT = [re.compile(p, re.S) for p in (
    r'"comment_count"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',
    r'"comment_rendering_instance"\s*:\s*\{\s*"comments"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',
    r'"comments"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',
    r'"total_comment_count"\s*:\s*(\d+)',
    r'"comment_total_count"\s*:\s*(\d+)',
    r'"i18n_comment_count"\s*:\s*"' + _NUM + '"',
    r'"commentCount"\s*:\s*"?(\d+)',
    r'CommentAction"[^}]{0,120}?"userInteractionCount"\s*:\s*"?(\d+)',
    r'"text"\s*:\s*"' + _NUM + r'\s+(?:comments?|bình luận)"',
    r'>' + _NUM + r'\s+(?:comments?|bình luận)<',
)]


def _count(s):
    """'1,234' -> 1234 · '1.2K' -> 1200 · '3M' -> 3000000"""
    s = str(s).strip().replace(' ', '')
    if not s:
        return None
    if s[-1] in 'KkMm':
        try:
            return int(round(float(s[:-1].replace(',', '.')) * (1000 if s[-1] in 'Kk' else 1000000)))
        except ValueError:
            return None
    s = re.sub(r'[.,]', '', s)
    return int(s) if s.isdigit() else None


def _cmt_listed(html):
    """số bình luận có sẵn trong HTML (Facebook chỉ nhúng vài bình luận đầu) - dùng làm mức tối thiểu"""
    seen = set()
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S):
        blob = m.group(1)
        if '"Comment"' not in blob:
            continue
        try:
            st = [json.loads(blob)]
        except ValueError:
            continue
        while st:
            o = st.pop()
            if isinstance(o, dict):
                if o.get('__typename') == 'Comment' and isinstance(o.get('author'), dict):
                    cid = str(o.get('legacy_fbid') or o.get('id') or '')
                    if cid:
                        seen.add(cid)
                st.extend(o.values())
            elif isinstance(o, list):
                st.extend(o)
    return len(seen)


def comments(html, uid):
    """số bình luận (int) hoặc None nếu không đọc được; nhiều chỗ khớp -> lấy chỗ gần UID bài nhất, ưu tiên > 0"""
    anchor, zero = html.find(uid), False
    n = None
    for pat in _CMT:
        found = [(m.start(), _count(m.group(1))) for m in pat.finditer(html)]
        found = [(p, v) for p, v in found if v is not None]
        if not found:
            continue
        pos = [(p, v) for p, v in found if v > 0]
        if pos:
            if anchor >= 0:
                pos.sort(key=lambda t: abs(t[0] - anchor))
            n = pos[0][1]
            break
        zero = True
    if n is None and zero:
        n = 0
    k = _cmt_listed(html)
    return max(n or 0, k) if (n is not None or k) else None


def _get(url, hdr, timeout, proxy):
    """-> (status, final_url, html)"""
    if _cffi:
        px = {'http': proxy, 'https': proxy} if proxy else None
        h = {k: v for k, v in hdr.items() if k.lower() != 'user-agent'}
        r = _cffi.get(url, headers=h, timeout=timeout, allow_redirects=True, proxies=px, impersonate='chrome')
        return r.status_code, str(r.url), r.text
    hs = []
    if proxy:
        p = proxy if '://' in proxy else 'http://' + proxy
        hs.append(urllib.request.ProxyHandler({'http': p, 'https': p}))
    op = urllib.request.build_opener(*hs)
    try:
        r = op.open(urllib.request.Request(url, headers=hdr), timeout=timeout)
        return r.status, r.geturl(), r.read(2_000_000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        try:
            body = e.read(500_000).decode('utf-8', 'replace')
        except Exception:
            body = ''
        return e.code, e.geturl() or url, body


def check(value, opt=None):
    opt = opt or {}
    uid = norm(value)
    if not uid:
        return 'error', 'UID bài viết không hợp lệ'
    hdr = {'User-Agent': random.choice(UAS),
           'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
           'Accept-Language': 'en-US,en;q=0.9',          # ép tiếng Anh để HTML ổn định
           'Upgrade-Insecure-Requests': '1'}
    ck = str((opt.get('x') or {}).get('cookie') or '').strip()
    if ck:
        hdr['Cookie'] = ck
    timeout = float(opt.get('timeout') or 15)
    last = ('error', 'Lỗi kết nối')
    for attempt in range(2):                           # thử lại 1 lần khi chưa xác định được
        try:
            st, fu, html = _get(URL.format(uid=uid), hdr, timeout, opt.get('proxy') or '')
            res = classify(uid, st, fu, html)
            if res[0] == 'live':
                n = comments(html, uid)
                if n is None and attempt == 0:                 # live nhưng chưa đọc được số bình luận -> thử lại 1 lần
                    last = (res[0], res[1] + ' · chưa đọc được số bình luận', {})
                    time.sleep(0.6)
                    continue
                return (res[0], res[1] + (' · %d bình luận' % n if n is not None else ' · không đọc được số bình luận (thêm cookie)'),
                        {'comments': n} if n is not None else {})
            if res[0] != 'error':
                return res
            last = res
        except Exception as e:
            last = ('error', type(e).__name__)
        time.sleep(0.6 + attempt)
    return last
