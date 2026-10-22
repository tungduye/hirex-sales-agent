# Dựng giao diện gốc của AccountsHS cho HireX từ mã Python (v7.py + chatbot + owl + core_animation):
#   python moduleHS/accountshs/ui/build_ui.py <thư mục AccountsHS python> moduleHS/accountshs/ui
# Ra ui/index.html = đúng trang v7.py main() phục vụ ở "/" (HTML + CSS/JS Cú vọ + core_animation → ui_tokenize → THEME_BOOT → reduced-motion)
# và ui/owl.html = trang Cú vọ tự động (/owl, kèm bộ chọn ngày DP như owl._dp_inject). Mọi /api/…, /style/theme/…, /owl
# được đổi sang /api/hs/accountshs/… (route của HireX). Theme: chép style/themes/*.css + preview/ sang ui/themes/.
import ast, os, re, sys, importlib.util

SRC, OUT = sys.argv[1], sys.argv[2]

def consts(path, names, funcs=(), pre=None):
    """Chỉ chạy các phép gán hằng / hàm cần lấy trong file Python (không chạy cả module, không cần DB)."""
    tree = ast.parse(open(path, encoding='utf8').read())
    keep = [n for n in tree.body if (isinstance(n, (ast.Assign, ast.AugAssign)) and any(isinstance(t, ast.Name) and t.id in names for t in (n.targets if isinstance(n, ast.Assign) else [n.target])))
            or (isinstance(n, ast.FunctionDef) and n.name in funcs)]
    g = {'re': re, 'os': os, **(pre or {})}
    exec(compile(ast.Module(body=keep, type_ignores=[]), path, 'exec'), g)
    return g

v7 = consts(os.path.join(SRC, 'v7.py'), {'HTML', 'THEME_BOOT', '_XC', '_XL'}, ('ui_tokenize',))
ta = consts(os.path.join(SRC, 'chatbot', 'Think_Amation.py'), {'CSS', 'JS'})
ai = consts(os.path.join(SRC, 'chatbot', 'AI_deepSearch.py'), {'CSS', 'JS'}, pre={'TA_CSS': ta['CSS'], 'TA_JS': ta['JS']})
sp = importlib.util.spec_from_file_location('core_animation', os.path.join(SRC, 'core_animation', 'core_animation.py'))
ca = importlib.util.module_from_spec(sp); sp.loader.exec_module(ca); CA = ca.get()

# v7.py main(): owl.install() trả css/js rỗng, rồi cộng core_animation
H = v7['HTML']
H = H.replace('</style></head>', ai['CSS'] + CA['css'] + '</style></head>').replace('</script></body></html>', ai['JS'] + ';{' + CA['js'] + '}' + '</script></body></html>')
H = v7['ui_tokenize'](H).replace('</style></head>', '</style>' + v7['THEME_BOOT'] + '</head>', 1)
H = re.sub(r'prefers-reduced-motion\s*:\s*reduce', 'prefers-reduced-motion:never-match', H)

OP = consts(os.path.join(SRC, 'owl', 'owl.py'), {'OWL_PAGE'})['OWL_PAGE']
if '/*DP-JS*/' in OP:
    OP = OP.replace('/*DP-CSS*/', H[H.index('/*DP-CSS-BEGIN*/'):H.index('/*DP-CSS-END*/')], 1).replace('/*DP-JS*/', H[H.index('/*DP-JS-BEGIN*/'):H.index('/*DP-JS-END*/')], 1)

P = '/api/hs/accountshs/'
def hirex(h):
    for q in "'\"`":
        h = h.replace(q + '/api/', q + P)
    h = h.replace('/style/theme/', P + 'theme/').replace("'/owl?", "'" + P + "owl-page?")
    return h.replace("['/vendor/quill/quill.js','/vendor/quill/quill.core.css'],", '')   # không có /vendor: Quill nạp từ CDN như bản gốc khi thiếu file

# Vá thêm của HireX (ui/hirex-patch.css + .js): nạp sau CSS/JS gốc, chỉ bọc hàm của bản gốc
PJ = open(os.path.join(OUT, 'hirex-patch.js'), encoding='utf8').read()
PC = open(os.path.join(OUT, 'hirex-patch.css'), encoding='utf8').read()
PB = open(os.path.join(OUT, 'hirex-boot.js'), encoding='utf8').read()   # chạy trước JS gốc (dựng khung ngay)
assert H.count('</body></html>') == 1 and '</head>' in H
H = H.replace('</head>', '<style id="hx-patch">' + PC + '</style><script>' + PB + '</script></head>', 1).replace('</body></html>', '<script>' + PJ + '</script></body></html>')

for name, h in (('index.html', H), ('owl.html', OP)):
    h = hirex(h)
    left = re.findall(r".{20}(?<!/hs/accountshs)/api/(?!hs/).{20}", h)
    assert not left, left[:3]
    open(os.path.join(OUT, name), 'w', encoding='utf8').write(h)
    print(name, len(h))
