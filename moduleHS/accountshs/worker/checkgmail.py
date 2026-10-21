# -*- coding: utf-8 -*-
"""Vọng gác · checker Gmail qua API checkmail.live (gửi theo lô tối đa 1.000 email / request).
Kết quả: live · die (fastCheck).
Tài khoản free: gom tối đa 1.000 email mỗi lần gọi để tiết kiệm lượt; API báo lỗi (hết lượt / sai key)
thì dừng ngay cả lượt chạy và hiện lý do -> đổi API key mới trong cửa sổ cấu hình rồi chạy lại."""
import json
import re
import urllib.error
import urllib.request

API = 'https://checkmail.live/check/'
# gọi giống trình duyệt trên trang checkmail.live (cách gọi theo tài liệu không chạy)
HDR = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
    'content-type': 'application/json',
    'origin': 'https://checkmail.live',
    'referer': 'https://checkmail.live/',
    'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
}
INFO = {}            # số lượt còn lại lần gọi gần nhất (new_credit) -> hiện trong cửa sổ cấu hình


def meta():
    return dict(INFO)

CHECKER = {
    'id': 'gmail',
    'name': 'Gmail',
    'icon': 'mail',
    'value': 'Email',
    'hint_tab': ['gmail', 'email', 'mail'],
    'hint_field': ['email', 'gmail', 'mail'],
    'batch': 1000,                       # số email mỗi request (giới hạn của API)
    'threads': 1, 'timeout': 60,
    'fields': [{'k': 'api_key', 'label': 'API key', 'secret': True, 'ph': 'Dán API key checkmail.live'},
               {'k': 'session', 'label': 'Session', 'secret': True, 'ph': 'Chỉ cần khi API báo lỗi phiên'}],
    'no_proxy': True,
}


class Abort(Exception):
    pass


_EM = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')


def norm(value):
    m = _EM.search(str(value or ''))
    return m.group(0).lower() if m else ''


def check_batch(values, opt=None):
    opt = opt or {}
    key = str((opt.get('x') or {}).get('api_key') or '').strip()
    if not key:
        raise Abort('Chưa nhập API key')
    ems = [norm(v) for v in values]
    send = sorted({e for e in ems if e})
    res = {}
    if send:
        body = json.dumps({'api_key': key, 'fastCheck': True, 'checkExist': False, 'emails': send}, separators=(',', ':')).encode()
        hdr = dict(HDR)
        ss = str((opt.get('x') or {}).get('session') or '').strip()
        if ss:                                   # dán cả "PHPSESSID=..." hoặc chỉ giá trị đều được
            hdr['cookie'] = ss if '=' in ss else 'PHPSESSID=' + ss
        req = urllib.request.Request(API, data=body, method='POST', headers=hdr)
        try:
            r = urllib.request.urlopen(req, timeout=max(30.0, float(opt.get('timeout') or 60)))
            d = json.loads(r.read().decode('utf-8', 'replace') or '{}')
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode('utf-8', 'replace')).get('message') or ''
            except Exception:
                msg = ''
            if e.code in (401, 402, 403, 429):
                raise Abort('API từ chối (HTTP %s)%s - kiểm tra / đổi API key' % (e.code, ': ' + msg if msg else ''))
            return [('error', 'HTTP %s' % e.code)] * len(values)
        except Exception as e:
            return [('error', type(e).__name__)] * len(values)
        if d.get('new_credit') is not None:
            INFO['credit'] = d.get('new_credit')
        if not d.get('status'):
            raise Abort('API: %s - kiểm tra / đổi API key' % (d.get('message') or 'lỗi không rõ'))
        items = d.get('data') or []
        for i, it in enumerate(items):
            em = str(it.get('email') or '').lower() or (send[int(it.get('index', i + 1)) - 1] if 0 < int(it.get('index', i + 1)) <= len(send) else '')
            st = str(it.get('status') or '').lower()
            if em:
                res[em] = st
    out = []
    for e in ems:
        if not e:
            out.append(('error', 'Email không hợp lệ'))
        elif e in res:
            st = res[e]
            out.append((st if st in ('live', 'die', 'verify_phone', 'not_exist') else 'error', st))
        else:
            out.append(('error', 'API không trả kết quả'))
    return out


def check(value, opt=None):
    return check_batch([value], opt)[0]
