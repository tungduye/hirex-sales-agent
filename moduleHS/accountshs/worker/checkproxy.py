# -*- coding: utf-8 -*-
"""Vọng gác · checker Proxy: kết nối qua proxy tới trang kiểm tra (mặc định Google generate_204), kiểm tra luôn XÁC THỰC.
Định dạng: ip:port · ip:port:user:pass · user:pass:ip:port · user:pass@ip:port · ip:port@user:pass · ip:port|user|pass
          · http://... · https://... · socks5://... · socks4://...   (không ghi loại → tự nhận HTTP / SOCKS5 / SOCKS4)
Kết quả:
  Live  = proxy chạy, ra được Internet (có user:pass thì user:pass ĐÚNG)
  Die   = không kết nối được / hết thời gian / SAI user:pass / proxy đòi user:pass mà dòng không có
  Lỗi   = giá trị không phải proxy
Số liệu thêm "Xác thực": Đúng user/pass · Sai user/pass · Thiếu user/pass · Không cần · Không yêu cầu (có user/pass nhưng proxy mở)."""
import base64
import re
import socket
import ssl
import struct
import time
from urllib.parse import urlsplit

CHECKER = {
    'id': 'proxy',
    'name': 'Proxy',
    'icon': 'shield',
    'value': 'IP / Proxy',
    # tab tách cột: IP + Port + User + Mật khẩu + Loại → tự ghép lại (cột nào trống thì lấy từ ô IP nếu ô đó đã ghi đủ)
    'parts': [{'k': 'port', 'label': 'Port', 'icon': 'hash', 'match': ['port', 'cong', 'cổng']},
              {'k': 'user', 'label': 'User', 'icon': 'user', 'match': ['user', 'username', 'user name', 'ten dang nhap', 'login', 'tai khoan proxy']},
              {'k': 'pw', 'label': 'Mật khẩu', 'icon': 'lock', 'match': ['mat khau', 'pass', 'password', 'pw', 'pwd', 'mk']},
              {'k': 'type', 'label': 'Loại', 'icon': 'list', 'match': ['loai', 'loai proxy', 'type', 'giao thuc', 'protocol', 'kieu']}],
    'hint_tab': ['proxy', 'proxies'],
    'hint_field': ['proxy', 'ip', 'ip:port', 'host'],
    'url': 'https://www.google.com/generate_204',     # trang kiểm tra (đổi được trong cấu hình)
    'no_proxy': True,                                 # không hiện ô "Proxy" dùng chung
    'extra': [{'k': 'auth', 'label': 'Xác thực', 'type': 'text', 'icon': 'key',
               'match': ['xac thuc', 'auth', 'authen', 'trang thai auth', 'user pass']}],
    'threads': 20, 'timeout': 10,
}

A_OK, A_BAD, A_MISS, A_NONE, A_OPEN = 'Đúng user/pass', 'Sai user/pass', 'Thiếu user/pass', 'Không cần', 'Không yêu cầu'

_H = r'([\w.-]+|\[[0-9a-fA-F:]+\])'
_PATS = [
    ('none', re.compile(r'^' + _H + r':(\d{1,5})$')),
    ('hp@c', re.compile(r'^' + _H + r':(\d{1,5})@(.+)$')),                         # ip:port@user:pass
    ('hp:c', re.compile(r'^' + _H + r':(\d{1,5})[:|;\s]+([^:|;\s]+)[:|;\s]+(.+)$')),   # ip:port:user:pass (pass được chứa : @)
    ('c@hp', re.compile(r'^(.+)@' + _H + r':(\d{1,5})$')),                         # user:pass@ip:port
    ('c:hp', re.compile(r'^([^:|;\s]+)[:|;\s]+(.+)[:|;\s]+' + _H + r':(\d{1,5})$')),   # user:pass:ip:port
]


def parse(value):
    """-> {'sch','host','port','user','pw','auto'} hoặc None. auto=True khi dòng không ghi loại proxy."""
    v = str(value or '').strip()
    if not v:
        return None
    m = re.match(r'^(\w+)://(.+)$', v)
    sch, rest = (m.group(1).lower(), m.group(2)) if m else ('http', v)
    if sch == 'socks5h':
        sch = 'socks5'
    if sch == 'socks4a':
        sch = 'socks4'
    rest = rest.strip().rstrip('/')
    for kind, rx in _PATS:
        m2 = rx.match(rest)
        if not m2:
            continue
        g = m2.groups()
        if kind == 'none':
            host, port, user, pw = g[0], g[1], '', ''
        elif kind == 'hp@c':
            host, port = g[0], g[1]
            user, _, pw = g[2].partition(':')
        elif kind == 'c@hp':
            user, _, pw = g[0].partition(':')
            host, port = g[1], g[2]
        elif kind == 'hp:c':
            host, port, user, pw = g
        else:
            user, pw, host, port = g
        if 0 < int(port) < 65536:
            return {'sch': sch, 'host': host.strip('[]'), 'port': int(port), 'user': user, 'pw': pw, 'auto': not m}
    return None


def _ptype(t):
    t = re.sub(r'[^a-z0-9]', '', str(t or '').lower())
    return 'socks5' if 'socks5' in t or t == 'socks' else 'socks4' if 'socks4' in t else 'https' if t == 'https' else 'http' if 'http' in t else ''


def compose(v, pt):
    """ghép giá trị từ các cột: IP (+ Port + User + Mật khẩu + Loại) → 'loại://ip:port@user:pass'.
    Ô IP đã ghi đủ ip:port(:user:pass) thì giữ, chỉ bổ sung phần còn thiếu từ các cột kia."""
    v = str(v or '').strip()
    port = re.sub(r'\D', '', str(pt.get('port') or ''))
    user, pw, ty = str(pt.get('user') or '').strip(), str(pt.get('pw') or '').strip(), _ptype(pt.get('type'))
    if re.fullmatch(r'[0-9a-fA-F]*:[0-9a-fA-F:]+', v) and v.count(':') >= 2 and port:
        v = '[%s]' % v                                   # IPv6 trần + cột Port riêng
    p = parse(v)
    if not p and port:
        p = parse(v.rstrip(':') + ':' + port)
    if not p:
        return v
    if not p['user'] and user:
        p['user'], p['pw'] = user, pw
    sch = ty or ('' if p['auto'] else p['sch'])
    h = '[%s]' % p['host'] if ':' in p['host'] else p['host']
    return (sch + '://' if sch else '') + '%s:%d' % (h, p['port']) + ('@%s:%s' % (p['user'], p['pw']) if p['user'] else '')


def show(value):
    """hiển thị trong 'Kết quả gần đây': ẩn mật khẩu"""
    p = parse(value)
    if not p:
        return str(value or '')
    return '%s%s:%s%s' % ('' if p['auto'] else p['sch'] + '://', p['host'], p['port'], (' · ' + p['user'] + ':••••') if p['user'] else '')


def norm(value):
    """-> 'scheme://host:port' (không kèm mật khẩu) để hiển thị / nhận diện"""
    p = parse(value)
    return '%s://%s:%s' % (p['sch'], p['host'], p['port']) if p else ''


class Fail(Exception):
    """kết luận chắc chắn (không thử giao thức khác): res, lý do, xác thực"""
    def __init__(self, res, why, auth=None):
        Exception.__init__(self, why)
        self.res, self.why, self.auth = res, why, auth


class NotThis(Exception):
    """proxy không nói giao thức này → thử giao thức khác (khi không ghi loại)"""


def _recv_exact(s, n):
    b = b''
    while len(b) < n:
        c = s.recv(n - len(b))
        if not c:
            raise NotThis('đóng kết nối')
        b += c
    return b


def _read_head(s, lim=16384):
    b = b''
    while b'\r\n\r\n' not in b:
        c = s.recv(4096)
        if not c:
            break
        b += c
        if len(b) > lim:
            break
    return b


def _http_code(head):
    m = re.match(rb'^HTTP/\d(?:\.\d)?\s+(\d{3})', head)
    if not m:
        raise NotThis('không phải HTTP')
    return int(m.group(1))


def _basic(p):
    return 'Basic ' + base64.b64encode(('%s:%s' % (p['user'], p['pw'])).encode()).decode()


def _http_tunnel(s, p, th, tp):
    """HTTP CONNECT (kèm Proxy-Authorization nếu có) → mở đường hầm tới th:tp"""
    req = 'CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\nUser-Agent: Mozilla/5.0\r\nProxy-Connection: keep-alive\r\n' % (th, tp, th, tp)
    if p['user']:
        req += 'Proxy-Authorization: %s\r\n' % _basic(p)
    s.sendall((req + '\r\n').encode())
    code = _http_code(_read_head(s))
    if code == 407:
        raise Fail('die', '407 sai user/pass' if p['user'] else '407 proxy cần user/pass', A_BAD if p['user'] else A_MISS)
    if code != 200:
        raise Fail('die', 'CONNECT bị từ chối (%d)' % code, None)


def _http_plain(s, p, url):
    """URL http:// → gửi thẳng GET kiểu proxy (không cần CONNECT)"""
    req = 'GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n' % (url, urlsplit(url).netloc)
    if p['user']:
        req += 'Proxy-Authorization: %s\r\n' % _basic(p)
    s.sendall((req + '\r\n').encode())
    code = _http_code(_read_head(s))
    if code == 407:
        raise Fail('die', '407 sai user/pass' if p['user'] else '407 proxy cần user/pass', A_BAD if p['user'] else A_MISS)
    return code


def _socks5(s, p, th, tp):
    meth = b'\x00\x02' if p['user'] else b'\x00'
    s.sendall(b'\x05' + bytes([len(meth)]) + meth)
    r = s.recv(2)
    if len(r) < 2 or r[0] != 5:
        raise NotThis('không phải SOCKS5')
    if r[1] == 0xFF:
        raise Fail('die', 'SOCKS5 cần user/pass' if not p['user'] else 'SOCKS5 từ chối cách xác thực', A_MISS if not p['user'] else A_BAD)
    if r[1] == 0x02:
        u, w = p['user'].encode()[:255], p['pw'].encode()[:255]
        s.sendall(b'\x01' + bytes([len(u)]) + u + bytes([len(w)]) + w)
        a = _recv_exact(s, 2)
        if a[1] != 0:
            raise Fail('die', 'SOCKS5 sai user/pass', A_BAD)
    elif r[1] != 0x00:
        raise Fail('die', 'SOCKS5 đòi cách xác thực không hỗ trợ (%d)' % r[1], None)
    hb = th.encode()
    s.sendall(b'\x05\x01\x00\x03' + bytes([len(hb)]) + hb + struct.pack('>H', tp))
    h = _recv_exact(s, 4)
    if h[1] != 0:
        raise Fail('die', 'SOCKS5 không mở được kết nối (mã %d)' % h[1], None)
    at = h[3]
    n = 4 if at == 1 else 16 if at == 4 else _recv_exact(s, 1)[0]
    _recv_exact(s, n + 2)
    return 0x02 if r[1] == 0x02 else 0


def _socks4(s, p, th, tp):
    try:
        ip = socket.inet_aton(socket.gethostbyname(th))
    except OSError:
        raise Fail('error', 'Không phân giải được %s' % th)
    s.sendall(b'\x04\x01' + struct.pack('>H', tp) + ip + p['user'].encode()[:255] + b'\x00')
    r = _recv_exact(s, 8)
    if r[0] != 0:
        raise NotThis('không phải SOCKS4')
    if r[1] != 0x5A:
        raise Fail('die', 'SOCKS4 từ chối (mã %d)' % r[1], None)


def _try(p, sch, url, tmo):
    """thử 1 giao thức: -> (code, ms, auth_used) ; lỗi chắc chắn → Fail ; sai giao thức → NotThis"""
    u = urlsplit(url)
    th, tp = u.hostname, u.port or (443 if u.scheme == 'https' else 80)
    path = (u.path or '/') + ('?' + u.query if u.query else '')
    t = time.time()
    try:
        s = socket.create_connection((p['host'], p['port']), timeout=tmo)
    except socket.timeout:
        raise Fail('die', 'Hết thời gian kết nối proxy')
    except OSError as e:
        raise Fail('die', 'Không kết nối được proxy (%s)' % (getattr(e, 'strerror', '') or type(e).__name__))
    s.settimeout(tmo)
    used = bool(p['user'])
    try:
        if sch in ('http', 'https') and u.scheme == 'http':
            code = _http_plain(s, p, url)
            return code, int((time.time() - t) * 1000), used
        if sch in ('http', 'https'):
            _http_tunnel(s, p, th, tp)
        elif sch == 'socks5':
            used = _socks5(s, p, th, tp) == 0x02
        elif sch == 'socks4':
            _socks4(s, p, th, tp)
            used = False
        else:
            raise Fail('error', 'Loại proxy %s chưa hỗ trợ' % sch)
        if u.scheme == 'https':
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE           # chỉ kiểm tra proxy thông đường, không xét chứng chỉ trang đích
            s = ctx.wrap_socket(s, server_hostname=th)
        s.sendall(('GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n' % (path, th)).encode())
        head = _read_head(s)
        try:
            code = _http_code(head)
        except NotThis:
            raise Fail('die', 'Trang kiểm tra không trả lời qua proxy')
        return code, int((time.time() - t) * 1000), used
    except socket.timeout:
        raise Fail('die', 'Hết thời gian (%s)' % sch.upper())
    except ssl.SSLError as e:
        raise Fail('die', 'Lỗi TLS qua proxy (%s)' % (e.reason or 'SSL'))
    except (ConnectionError, OSError) as e:
        raise NotThis(type(e).__name__)
    finally:
        try:
            s.close()
        except Exception:
            pass


def _needs_auth(p, url, tmo):
    u = urlsplit(url)
    th, tp = u.hostname, u.port or (443 if u.scheme == 'https' else 80)
    try:
        s = socket.create_connection((p['host'], p['port']), timeout=tmo)
        s.settimeout(tmo)
        try:
            if u.scheme == 'http':
                s.sendall(('GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' % (url, u.netloc)).encode())
            else:
                s.sendall(('CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n\r\n' % (th, tp, th, tp)).encode())
            return _http_code(_read_head(s)) == 407
        finally:
            s.close()
    except Exception:
        return True                                # không rõ → coi như user/pass có tác dụng


def check(value, opt=None):
    opt = opt or {}
    p = parse(value)
    if not p:
        return 'error', 'Proxy không hợp lệ'
    url = opt.get('url') or CHECKER['url']
    if not urlsplit(url).hostname:
        return 'error', 'Trang kiểm tra không hợp lệ'
    tmo = float(opt.get('timeout') or 10)
    order = ['http', 'socks5', 'socks4'] if p['auto'] else [p['sch']]
    last = None
    for sch in order:
        try:
            code, ms, used = _try(p, sch, url, tmo)
        except NotThis as e:
            last = last or Fail('die', 'Proxy không phản hồi đúng giao thức (%s)' % e, None)
            continue
        except Fail as f:
            if f.res == 'die' and f.auth is None and p['auto'] and sch != order[-1] and 'Không kết nối' not in f.why and 'Hết thời gian kết nối' not in f.why:
                last = last if (last and sch != 'http') else f       # chưa chắc là giao thức này → thử tiếp, giữ lý do của HTTP
                continue
            ex = {'auth': f.auth} if f.auth else None
            return (f.res, f.why, ex) if ex else (f.res, f.why)
        name = sch.upper()
        if p['user'] and used and sch in ('http', 'https'):
            used = _needs_auth(p, url, tmo)       # thử lại KHÔNG gửi user/pass: bị 407 → user/pass có tác dụng
        if p['user']:
            auth = A_OK if used else A_OPEN
        else:
            auth = A_NONE
        if 200 <= code < 400:
            return 'live', '%s · %dms · %s · %s' % (code, ms, name, auth), {'auth': auth}
        return 'error', 'HTTP %s · %s · %s' % (code, name, auth), {'auth': auth}
    f = last or Fail('die', 'Không kết nối được proxy')
    return 'die', f.why
