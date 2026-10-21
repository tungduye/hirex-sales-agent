# -*- coding: utf-8 -*-
"""Vọng gác · checker FB Page (check live theo UID / ID page).
Cách check giống hệt Facebook cá nhân (graph.facebook.com/<id>/picture: 302 = Live · 400 = Die),
nên dùng lại hàm check() của checkfb.py; chỉ khác thông tin hiển thị + gợi ý tab/trường và có cấu hình riêng."""
import importlib.util
import os

_sp = importlib.util.spec_from_file_location('cyv_checkfb_base', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'checkfb.py'))
_fb = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(_fb)

CHECKER = {
    'id': 'fbpage',
    'name': 'FB Page',
    'icon': 'flag',
    'value': 'UID Page',
    'hint_tab': ['fb page', 'fanpage', 'page'],
    'hint_field': ['uid page', 'page id', 'id page', 'uid', 'id'],
    'fields': [{'k': 'cookie', 'label': 'Cookie', 'secret': True, 'ph': 'Tùy chọn · giúp đọc tên ổn định hơn'},
               {'k': 'refresh', 'label': 'Đọc lại tên', 'ph': 'Trống = chỉ đọc ô tên còn trống · 1 = đọc lại tất cả'}],
    'extra': [{'k': 'name', 'label': 'Tên Page', 'type': 'text', 'icon': 'flag',
               'match': ['ten page', 'ten fanpage', 'ten trang', 'page name', 'ten', 'name'], 'hint': 'Page: Tên · lẫn profile: Profile (Tên) · chỉ ghi khi Live', 'skip_filled': True, 'junk': _fb.JUNK, 'stale': r'\s\|\s'}],
    'desc': 'Giống Facebook (Graph picture + đọc tên Page từ facebook.com/<id> khi Live).',
    'threads': 5, 'timeout': 12,
}

norm = _fb.norm


def check(value, opt=None):
    return _fb.check(value, dict(opt or {}, fmt=('%s', 'Profile (%s)'), name_src='plugin'))
