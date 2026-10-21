"""
Cu vo - kich ban "Thu thap bai viet da dang len page"
(Facebook Activity Log - GROUPPOSTS: cac bai Page da dang trong nhom)

Tu chua, khong phu thuoc file khac. Phan ket noi (cookie -> token -> graphql -> phan trang)
duoc dua tu rq_owl.py (ban goc cua du an) vao day; them bo boc tach nhieu cot.
owl.py tu nap moi file owl_*.py -> them kich ban = them 1 file.
    SCRIPT = {...}        mo ta kich ban
    run(ctx, src, p)      chay 1 nguon: src{label,cookie,uid,name}; ctx.emit/log/status/stopped/sleep/save_raw
Tuy chon: pip install curl_cffi  (gia lap Chrome -> token on dinh hon)
"""
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
try:
    from curl_cffi import requests as cffi
except Exception:                       # noqa
    cffi = None
WWW = "https://www.facebook.com"
API = WWW + "/api/graphql/"
FRIENDLY = "CometActivityLogStoriesListPaginationQuery"
DEFAULT_DOC = "27478633398483911"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
# Gio hien thi/loc theo gio Viet Nam (UTC+7) - khong phu thuoc mui gio may chay
TZ = dt.timezone(dt.timedelta(hours=7))
TS_KEYS = ("creation_time", "timestamp", "created_time", "node_timestamp")
TOKEN_RE = re.compile(
    r'"(?P<name>DTSGInitialData|DTSGInitData|LSD)"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"(?P<token>[^"\\]+)"',
    re.S)
class Fail(Exception):
    pass
def clean_cookie(s):
    s = (s or "").replace("^%", "%").replace("^", "").strip().strip("'\"")
    s = re.sub(r"^(cookie:|-b)\s*", "", s, flags=re.I).strip().strip("'\"")
    return s
def parse_cookie(s):
    """'a=b; c=d' · JSON [{name,value}] · JSON {a:b} · dòng Netscape -> dict"""
    s = (s or "").strip()
    out = {}
    if not s:
        return out
    if s[0] in "[{":
        try:
            o = json.loads(s)
            if isinstance(o, dict) and isinstance(o.get("cookies"), list):
                o = o["cookies"]
            if isinstance(o, list):
                for c in o:
                    if isinstance(c, dict) and "name" in c:
                        out[str(c["name"])] = str(c.get("value", ""))
            elif isinstance(o, dict):
                out = {str(k): str(v) for k, v in o.items()}
            return out
        except Exception:
            pass
    for line in re.split(r"[\r\n]+", s):
        cols = line.split("\t")
        if len(cols) >= 7 and not line.startswith("#"):
            out[cols[5]] = cols[6]
            continue
        for part in line.split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
    return out
def cookie_header(d):
    return "; ".join("%s=%s" % (k, v) for k, v in d.items())
def make_headers(ck, cookie, post, referer=None):
    h = {
        "User-Agent": UA,
        "Cookie": cookie,
        "Accept": "*/*" if post else
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate",
        "Referer": referer or (WWW + "/"),
        "Sec-Ch-Ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty" if post else "document",
        "Sec-Fetch-Mode": "cors" if post else "navigate",
        "Sec-Fetch-Site": "same-origin",
    }
    if not post:
        h.update({"Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1", "Cache-Control": "max-age=0"})
    if ck.get("dpr"):
        h["Dpr"] = ck["dpr"]
    m = re.match(r"^(\d+)x\d+$", ck.get("wd", ""))
    if m and not post:
        h["Viewport-Width"] = m.group(1)
    if post:
        h["Content-Type"] = "application/x-www-form-urlencoded"
        h["Origin"] = WWW
    return h
def _decode(r):
    raw = r.read(20_000_000)
    enc = (r.headers.get("Content-Encoding") or "").lower()
    try:
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    except Exception:
        pass
    return raw.decode("utf-8", "replace")
def http(url, ck, data=None, extra=None, referer=None, timeout=30):
    """-> (text, final_url, status)"""
    post = data is not None
    cookie = cookie_header(ck)
    h = make_headers(ck, cookie, post, referer)
    if extra:
        h.update({k: v for k, v in extra.items() if v})
    body = urllib.parse.urlencode(data).encode("utf-8") if post else None
    if cffi is not None:
        try:
            r = cffi.request("POST" if post else "GET", url, data=body, headers=h,
                             impersonate="chrome", timeout=timeout, allow_redirects=True)
            return r.text, str(r.url), r.status_code
        except Exception as e:
            raise Fail("Lỗi mạng (%s)" % type(e).__name__)
    req = urllib.request.Request(url, data=body, method="POST" if post else "GET", headers=h)
    try:
        r = urllib.request.build_opener().open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        r = e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Fail("Lỗi mạng (%s)" % type(e).__name__)
    try:
        return _decode(r), r.geturl(), getattr(r, "status", getattr(r, "code", 0))
    finally:
        r.close()
def find_tokens(html):
    items = {}
    for m in TOKEN_RE.finditer(html):
        items[m.group("name")] = m.group("token")
    token = items.get("DTSGInitialData") or items.get("DTSGInitData")
    if not token:                                           # dự phòng 1: __eqmc
        m = re.search(r'<script\b[^>]*\bid=["\']__eqmc["\'][^>]*>(.*?)</script>', html, re.I | re.S)
        if m:
            try:
                token = json.loads(m.group(1)).get("f") or ""
            except (ValueError, TypeError):
                pass
    if not token:                                           # dự phòng 2: chuỗi dạng NAf...:8:171...
        m = re.search(r'"(NA[A-Za-z0-9_\-]{20,}:\d+:\d+)"', html)
        token = m.group(1) if m else ""
    if token and not re.fullmatch(r"[A-Za-z0-9_:\-]{20,}", token):
        token = ""
    return token or "", items.get("LSD") or ""
def page_config(html):
    cfg = {"__comet_req": "15"}
    m = re.search(r'"queryID"\s*:\s*"(\d+)"\s*,\s*"variables"\s*:\s*\{[^{}]*\}\s*,\s*"queryName"\s*:\s*"'
                  + re.escape(FRIENDLY) + '"', html, re.S)
    if m:
        cfg["doc_id"] = m.group(1)
    for key, out in (("__spin_r", "__spin_r"), ("__spin_t", "__spin_t"), ("__spin_b", "__spin_b"),
                     ("hsi", "__hsi"), ("comet_env", "__comet_req")):
        q = re.search(r'"' + re.escape(key) + r'"\s*:\s*("[^"\n]*"|\d+)', html)
        if q:
            v = q.group(1)
            cfg[out] = v[1:-1] if v.startswith('"') else v
    if "__spin_r" not in cfg:
        q = re.search(r'"client_revision"\s*:\s*(\d+)', html)
        if q:
            cfg["__spin_r"] = q.group(1)
    return cfg
def activity_url(uid):
    return ("%s/%s/allactivity?activity_history=false&category_key=GROUPPOSTS"
            "&manage_mode=false&should_load_landing_page=false&locale=en_US" % (WWW, uid))
def open_session(raw_cookie, uid_override=""):
    ck = parse_cookie(clean_cookie(raw_cookie))
    if not ck.get("c_user") or not ck.get("xs"):
        raise Fail("Cookie thiếu c_user / xs")
    uid = uid_override or ck.get("i_user") or ck["c_user"]
    last = "Không thấy token"
    for url in (activity_url(uid), WWW + "/"):
        html, final, status = http(url, ck)
        low = final.lower()
        if "checkpoint" in low:
            raise Fail("Tài khoản bị checkpoint")
        if any(p in low for p in ("/login", "/recover", "/two_factor")):
            raise Fail("Cookie hết hạn")
        if status != 200:
            last = "HTTP %s" % status
            continue
        dtsg, lsd = find_tokens(html)
        if dtsg:
            return {"ck": ck, "uid": uid, "dtsg": dtsg, "lsd": lsd, "cfg": page_config(html)}
    raise Fail(last + ("" if cffi else " · thử: pip install curl_cffi"))
def jazoest(t):
    return "2" + str(sum(ord(c) for c in t))
def graphql(sess, variables, doc_id):
    cfg = sess["cfg"]
    data = {
        "av": sess["uid"], "__aaid": "0", "__user": sess["uid"], "__a": "1", "__req": "m",
        "__comet_req": cfg.get("__comet_req", "15"), "locale": "en_US",
        "fb_dtsg": sess["dtsg"], "jazoest": jazoest(sess["dtsg"]), "lsd": sess["lsd"],
        "__crn": "comet.fbweb.CometActivityLogMainContentRootRoute",
        "fb_api_caller_class": "RelayModern", "fb_api_req_friendly_name": FRIENDLY,
        "server_timestamps": "true",
        "variables": json.dumps(variables, separators=(",", ":")),
        "doc_id": doc_id,
    }
    if cfg.get("__spin_r"):
        data["__rev"] = data["__spin_r"] = cfg["__spin_r"]
    for k in ("__spin_b", "__spin_t", "__hsi"):
        if cfg.get(k):
            data[k] = cfg[k]
    extra = {"X-FB-Friendly-Name": FRIENDLY, "X-FB-LSD": sess["lsd"], "X-ASBD-ID": "359341"}
    text, _u, status = http(API, sess["ck"], data, extra, referer=activity_url(sess["uid"]))
    return text, status
def parse_response(text):
    text = (text or "").strip()
    out = []
    for line in text.split("\n"):
        line = re.sub(r"^\s*for\s*\(\s*;\s*;\s*\)\s*;", "", line).strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out
def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)
def find_ts(node):
    if isinstance(node, dict):                  # uu tien cap node = gio dang bai that
        for k in TS_KEYS:
            v = node.get(k)
            if isinstance(v, (int, float)) and 1_000_000_000 < v < 4_000_000_000:
                return int(v)
    for d in walk(node):
        for k in TS_KEYS:
            v = d.get(k)
            if isinstance(v, (int, float)) and 1_000_000_000 < v < 4_000_000_000:
                return int(v)
    return None
def find_texts(node):
    seen, out = set(), []
    for d in walk(node):
        v = d.get("text")
        if isinstance(v, str) and v.strip() and v not in seen:
            seen.add(v)
            out.append(v.strip())
    return out
def find_url(node):
    best = ""
    for d in walk(node):
        for k in ("url", "uri", "permalink_url"):
            v = d.get(k)
            if isinstance(v, str) and v.startswith("http") and "facebook.com" in v:
                if any(x in v for x in ("/posts/", "permalink", "/groups/", "story_fbid")):
                    return v
                best = best or v
    return best
def find_edges(o):
    if isinstance(o, dict):
        e = o.get("edges")
        if isinstance(e, list) and e and all(isinstance(x, dict) for x in e):
            return e
        for v in o.values():
            r = find_edges(v)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find_edges(v)
            if r:
                return r
    return []
def extract(objs):
    items, end_cursor, has_next = [], None, None
    for obj in objs:
        for d in walk(obj):
            pi = d.get("page_info")
            if isinstance(pi, dict):
                if pi.get("end_cursor"):
                    end_cursor = pi["end_cursor"]
                if "has_next_page" in pi:
                    has_next = pi["has_next_page"]
        for e in find_edges(obj):
            node = e.get("node", e)
            if not isinstance(node, dict):
                continue
            ts, texts = find_ts(node), find_texts(node)
            if ts is None and not texts:
                continue
            items.append({"id": str(node.get("id", "")), "ts": ts,
                          "text": " | ".join(texts)[:600], "url": find_url(node)})
    return items, end_cursor, has_next
def api_error(objs):
    for o in objs:
        errs = o.get("errors") if isinstance(o, dict) else None
        if errs and isinstance(errs, list) and isinstance(errs[0], dict):
            return str(errs[0].get("summary") or errs[0].get("message") or "Lỗi API")[:80]
    return ""
def fmt_ts(ts):
    return dt.datetime.fromtimestamp(ts, TZ).strftime("%d/%m/%Y %H:%M") if ts else ""
SCRIPT = {
    "id": "fb_page_group_posts",
    "name": "Thu thập bài viết đã đăng lên page",
    "platform": "Facebook",
    "version": "1.1",
    "desc": "Đọc Nhật ký hoạt động (bài đăng trong nhóm) của từng Page bằng cookie admin. "
            "Lọc theo số lượng và khoảng ngày giờ.",
    "tabs": ["FB Page"],
    "inputs": [
        {"k": "cookie", "label": "Cookie", "match": ["Cookie admin page", "Cookie"], "required": True, "secret": True},
        {"k": "uid", "label": "UID Page", "match": ["UID Page", "UID", "ID"], "hint": "Trống = lấy từ cookie"},
        {"k": "name", "label": "Tên Page", "match": ["Tên Page", "Tên", "Name"]},
    ],
    "params": [
        {"k": "n", "label": "Số bài tối đa / page", "type": "number", "default": 25, "min": 1, "max": 5000},
        {"k": "from", "label": "Từ", "type": "datetime", "default": ""},
        {"k": "to", "label": "Đến", "type": "datetime", "default": ""},
    ],
    "defaults": {"doc_id": DEFAULT_DOC, "delay": 3, "page_gap": 4, "raw": False},
    "columns": [
        {"k": "post_uid", "label": "UID bài đăng", "main": True, "key": True},
        {"k": "content", "label": "Nội dung bài đăng", "main": True, "wide": True},
        {"k": "post_link", "label": "Link bài đăng", "type": "url", "main": True},
        {"k": "time", "label": "Thời gian", "type": "datetime", "main": True},
        {"k": "group_id", "label": "UID nhóm", "main": True},
        {"k": "group_name", "label": "Tên nhóm", "main": True},
        {"k": "group_link", "label": "Link nhóm", "type": "url", "main": True},
        {"k": "page_uid", "label": "UID page", "main": True},
        {"k": "page_name", "label": "Tên page", "main": True},
        {"k": "profile_uid", "label": "UID profile", "main": True},
        {"k": "profile_name", "label": "Tên profile", "main": True},
    ],
    "export": ["post_uid", "content", "post_link", "time", "group_id", "group_name",
               "group_link", "page_uid", "page_name", "profile_uid", "profile_name"],
    "sync": {
        "tab": "Bài đăng FB",
        "key": "post_uid",
        "map": {
            "group_name": ["Tên nhóm", "Nhóm"],
            "group_id": ["UID nhóm"],
            "group_link": ["Link nhóm"],
            "post_uid": ["UID bài đăng", "UID"],
            "post_link": ["Link bài đăng", "Link"],
            "content": ["Nội dung bài đăng", "Nội dung"],
            "time": ["Thời gian đăng", "Thời gian"],
            "page_name": ["Tên page", "Page"],
            "page_uid": ["UID page"],
            "profile_name": ["Tên profile", "Profile đăng", "Profile"],
            "profile_uid": ["UID profile"],
        },
    },
}
def _txt(v):
    if isinstance(v, dict):
        v = v.get("text")
    return v.strip() if isinstance(v, str) else ""
def _urls(node):
    out = []
    for d in walk(node):
        for k in ("url", "uri", "permalink_url", "wwwURL"):
            v = d.get(k)
            if isinstance(v, str) and v.startswith("http") and "facebook.com" in v and v not in out:
                out.append(v)
    return out
def _node_id_num(nid):
    """id node base64 -> so cuoi, lam post_uid du phong"""
    try:
        s = base64.b64decode(nid + "=" * (-len(nid) % 4)).decode("utf-8", "ignore")
        nums = re.findall(r"\d{6,}", s)
        return nums[-1] if nums else ""
    except Exception:
        return ""
def _entities(node):
    """summary.text + ranges(offset/length/entity) -> {'actor':{id,name,url}, 'group':{id,name,url}}
    Cat ten theo offset/length nen lay dung ten page va ten nhom."""
    out = {}
    roots = [r for r in (node.get("summary"), node.get("title")) if isinstance(r, dict)]
    for root in roots + [node]:                 # summary/title truoc, tranh nham @tag trong noi dung
        for d in walk(root):
            txt, rngs = d.get("text"), d.get("ranges")
            if not (isinstance(txt, str) and isinstance(rngs, list) and rngs):
                continue
            for r in rngs:
                if not isinstance(r, dict):
                    continue
                e = r.get("entity") or {}
                tn = e.get("__typename")
                if tn not in ("User", "Page", "Group"):
                    continue
                try:
                    o = int(r.get("offset", 0))
                    ln = int(r.get("length", 0))
                    nm = txt[o:o + ln].strip()
                except Exception:
                    nm = ""
                nm = nm or str(e.get("short_name") or e.get("name") or "")
                key = "group" if tn == "Group" else "actor"
                if key not in out:
                    out[key] = {"id": str(e.get("id") or ""), "name": nm,
                                "url": str(e.get("url") or e.get("profile_url") or "")}
            if out:
                break
        if out:
            break
    return out
def _find_obj(node, key):
    v = node.get(key)
    if isinstance(v, dict):
        return v
    for d in walk(node):
        v = d.get(key)
        if isinstance(v, dict):
            return v
    return {}
def parse_node(node):
    """1 node Activity Log (Story) -> dict cac cot"""
    ts = find_ts(node)
    urls = _urls(node)
    title = _txt(node.get("title")) or _txt(node.get("story_title"))
    content = _txt(node.get("message")) or _txt(node.get("summary"))
    if not content:
        for k in ("body", "snippet", "description"):
            content = _txt(node.get(k))
            if content:
                break
    if content and title and content.strip() == title.strip():
        content = ""                                     # summary == title -> khong phai noi dung
    ent = _entities(node)
    g = ent.get("group") or {}
    a = ent.get("actor") or {}
    pid = str(node.get("post_id") or "")
    if not pid.isdigit():
        for d in walk(node):
            v = d.get("post_id") or d.get("story_fbid")
            if v and str(v).isdigit():
                pid = str(v)
                break
    if not pid.isdigit():
        for u in urls:
            m = re.search(r"/(?:permalink|posts)/(\d+)", u)
            if m:
                pid = m.group(1)
                break
    if not pid:
        pid = _node_id_num(str(node.get("id", "")))
    gseg = ""
    m = re.search(r"facebook\.com/groups/([^/?#]+)", g.get("url") or "")
    if m:
        gseg = m.group(1)
    if not gseg:
        for u in urls:
            m = re.search(r"facebook\.com/groups/([^/?#]+)/(?:permalink|posts)/", u)
            if m:
                gseg = m.group(1)
                break
    if not gseg:
        for u in urls:
            m = re.search(r"facebook\.com/groups/([^/?#]+)", u)
            if m:
                gseg = m.group(1)
                break
    if not gseg and g.get("id"):
        gseg = g["id"]
    post_link = ""
    node_url = str(node.get("url") or "")
    if re.search(r"facebook\.com/.+/(?:permalink|posts)/\d+", node_url):
        post_link = node_url                    # link goc FB tra ve -> chinh xac nhat
    elif gseg and pid:
        post_link = "%s/groups/%s/posts/%s/" % (WWW, gseg, pid)
    elif pid and a.get("id"):
        post_link = "%s/%s/posts/%s/" % (WWW, a["id"], pid)
    if not post_link:
        for u in urls:
            if re.search(r"/(?:permalink|posts)/\d+", u):
                post_link = u
                break
    gname = g.get("name") or ""
    gid = g.get("id") or ""
    glink = g.get("url") or (("%s/groups/%s/" % (WWW, gseg)) if gseg else "")
    if not gname and title:
        m = re.search(r"(?:posted in|shared .* in|đã đăng trong|đã chia sẻ .* trong)\s+(.+?)\.?$", title, re.I)
        if m:
            gname = m.group(1).strip()
    pg_name = a.get("name") or ""
    pg_uid = a.get("id") or ""
    if not pg_uid:
        for d in walk(node):
            ac = d.get("actors")
            if isinstance(ac, list) and ac and isinstance(ac[0], dict) and ac[0].get("id"):
                pg_uid = str(ac[0]["id"])
                pg_name = pg_name or str(ac[0].get("name") or "")
                break
    if not pg_name and title:
        m = re.match(r"\s*(.+?)\s+(?:posted|shared|đã đăng|đã chia sẻ)\b", title)
        if m:
            pg_name = m.group(1).strip()
    ua = _find_obj(node, "underlying_admin_creator")
    pf_name = str(ua.get("name") or "")
    pf_uid = str(ua.get("id") or "")
    attach = ""
    for d in walk(node):
        if d.get("__typename") in ("Photo", "Video", "ExternalUrl", "GenericAttachmentMedia", "Link"):
            attach = d["__typename"]
            break
    return {"ts": ts, "time": dt.datetime.fromtimestamp(ts, TZ).strftime("%Y-%m-%d %H:%M") if ts else "",
            "group_name": gname, "group_id": gid, "group_link": glink,
            "post_uid": pid, "post_link": post_link, "content": content[:5000],
            "page_name": pg_name, "page_uid": pg_uid,
            "profile_name": pf_name, "profile_uid": pf_uid,
            "title": title, "attach": attach, "node_id": str(node.get("id", "")),
            "texts": " | ".join(find_texts(node))[:3000]}
def _edges_nodes(objs):
    items, end_cursor, has_next = [], None, None
    for obj in objs:
        for d in walk(obj):
            pi = d.get("page_info")
            if isinstance(pi, dict):
                if pi.get("end_cursor"):
                    end_cursor = pi["end_cursor"]
                if "has_next_page" in pi:
                    has_next = pi["has_next_page"]
        for ed in find_edges(obj):
            node = ed.get("node", ed)
            if isinstance(node, dict):
                it = parse_node(node)
                if it["ts"] is not None or it["texts"]:
                    items.append(it)
    return items, end_cursor, has_next
def _open_session(cookie, uid):
    """Luon ep i_user = UID Page khi khac c_user (cookie admin) -> doc dung nhat ky cua Page."""
    uid = re.sub(r"\D", "", str(uid or ""))
    if uid:
        ck = parse_cookie(clean_cookie(cookie))
        if ck.get("c_user") and ck["c_user"] != uid:
            ck["i_user"] = uid
            cookie = cookie_header(ck)
    return open_session(cookie, uid)
def to_ts(s, end=False):
    s = (s or "").strip()
    if not s:
        return None
    for f in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            d = dt.datetime.strptime(s, f)
            if end:
                d = d.replace(hour=23, minute=59, second=59) if f == "%Y-%m-%d" else d.replace(second=59)
            return int(d.replace(tzinfo=TZ).timestamp())
        except ValueError:
            pass
    return None
def run(ctx, src, p):
    dft = SCRIPT.get("defaults", {})
    cookie = src.get("cookie") or ""
    uid = re.sub(r"\D", "", str(src.get("uid") or ""))
    name = src.get("name") or src.get("label") or uid or "?"
    n = int(p.get("n") or 25)
    start, end = to_ts(p.get("from")), to_ts(p.get("to"), True)
    doc = str(p.get("doc_id") or dft.get("doc_id") or DEFAULT_DOC).strip()
    delay = float(p.get("delay", dft.get("delay", 3)) or 0)
    raw = bool(p.get("raw", dft.get("raw", False)))
    if not cookie:
        raise Fail("Không có cookie")
    ctx.status("Lấy token")
    sess = _open_session(cookie, uid)
    uid = sess["uid"]
    ctx.log("Token OK - uid %s" % uid)
    cursor, seen, got, page, empty, refreshed = None, set(), 0, 0, 0, False
    per = min(n, 50)
    while not ctx.stopped() and got < n:
        page += 1
        variables = {"audience": None, "category": "GROUPPOSTS", "category_key": "GROUPPOSTS",
                     "count": per, "cursor": cursor, "feedLocation": None,
                     "media_content_filters": [], "month": None, "person_id": None,
                     "privacy": "NONE", "scale": 1, "timeline_visibility": "ALL",
                     "year": None, "id": uid}
        text, status = graphql(sess, variables, doc)
        if raw and page == 1:
            ctx.save_raw("postfb_%s" % uid, text)
        objs = parse_response(text)
        err = api_error(objs)
        if (status != 200 or not objs or err) and not refreshed:
            refreshed = True
            ctx.log("Làm mới token", "warn")
            sess = _open_session(cookie, uid)
            page -= 1
            continue
        if not objs or err:
            raise Fail(err or "Phản hồi lỗi (HTTP %s)" % status)
        items, end_cursor, has_next = _edges_nodes(objs)
        if page == 1 and not items:
            ctx.save_raw("postfb_empty_%s" % uid, text)
            ctx.log("Trang 1 không có bài (đã lưu raw)", "warn")
            break
        fresh, oldest = [], None
        for it in items:
            key = it["post_uid"] or it["node_id"] or (it["ts"], it["texts"][:80])
            if key in seen:
                continue
            seen.add(key)
            ts = it["ts"]
            if ts:
                oldest = ts if oldest is None else min(oldest, ts)
                if end and ts > end:
                    continue
                if start and ts < start:
                    continue
            it.pop("ts", None)
            if not it.get("page_name"):
                it["page_name"] = name
            if not it.get("page_uid"):
                it["page_uid"] = uid
            fresh.append(it)
            if got + len(fresh) >= n:
                break
        got += len(fresh)
        if fresh:
            ctx.emit(fresh)
        ctx.status(("%d bài - trang %d" % (got, page)) if (start or end) else ("%d / %d bài - trang %d" % (got, n, page)))
        empty = empty + 1 if not items else 0
        if empty >= 2 or not has_next or not end_cursor or end_cursor == cursor:
            break
        if start and oldest and oldest < start:
            break
        cursor = end_cursor
        if delay:
            ctx.sleep(random.uniform(max(0.0, delay - 1), delay + 1))
    ctx.log("%s: %d bài" % (name, got), "ok")
