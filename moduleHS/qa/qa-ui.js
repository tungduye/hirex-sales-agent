/* Kiểm thử phần mềm (Tiện ích › Kiểm thử) — giao diện.
   Mới: dán link + nói muốn test gì (kèm ảnh) → agent tự mở trình duyệt trên máy chủ và làm.
   Một lượt test: bên trái là trình duyệt TRỰC TIẾP (video từ máy chủ, con trỏ ảo chỉ chỗ agent đang bấm, bấm “Điều khiển” để tự thao tác),
   bên phải là TRÒ CHUYỆN với agent (nhắn bất cứ lúc nào — kể cả sau khi xong: agent mở lại trình duyệt và làm tiếp), từng bước test hiện ngay trong khung chat.
   Báo cáo (tải Word) và Nhật ký kỹ thuật ở 2 tab còn lại. Vẽ vào khung .hs-rec.hs-qa; nút / ô nhập / token màu dùng chung meeting.css, bố cục ở qa.css. */
const API = '/api/hs/qa';
let ROOT = null, ON = null;
const IC = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>', pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>', send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  minus: '<path d="M5 12h14"/>', loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>', flask: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/>',
  clip2: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-9M6 13H2M22 13h-4M3 7l3 2M21 7l-3 2M3 19l3-2M21 19l-3-2M9 6l-1-3M15 6l1-3"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>', layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>', back: '<path d="m15 6-6 6 6 6"/>', scroll: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', kbd: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', note: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', min: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.7-2.5 2s1.1 1.7 2.5 2 2.5.7 2.5 2-1.1 2-2.5 2a2.5 2 0 0 1-2.5-1.5M12 6.5v11"/>',
};
const ico = (n, sz = 16, cls = '') => `<svg class="i ${cls}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sz <= 14 ? 2 : 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.help}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Chữ của agent: **đậm**, `mã`, gạch đầu dòng "- ", xuống dòng. */
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').split('\n').map(l => /^\s*[-•]\s+/.test(l) ? `<span class="li">${l.replace(/^\s*[-•]\s+/, '')}</span>` : l).join('<br>').replace(/<br>(<span class="li">)/g, '$1').replace(/(<\/span>)<br>/g, '$1');
const $ = s => ROOT?.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dm = t => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const secs = ms => ms >= 60000 ? `${Math.floor(ms / 60000)}p ${Math.round(ms % 60000 / 1000)}s` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const hostOf = u => { try { return new URL(u).host; } catch { return u || ''; } };
async function get(a, q = '') { const r = await fetch(`${API}?action=${a}${q}`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.stage || 'Lỗi máy chủ'); return j; }
async function post(a, body, q = '') { const r = await fetch(`${API}?action=${a}${q}`, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.stage || 'Lỗi máy chủ'); return j; }
function toast(msg, ok) { const t = $('#qToast'); if (!t) return; for (const o of t.children) if (o.textContent === msg) { clearTimeout(o._t); o._t = setTimeout(() => o.remove(), 3500); return; } const el = document.createElement('div'); el.className = 'toast' + (ok ? ' ok' : ''); el.innerHTML = ico(ok ? 'check' : 'alert', 16) + `<span>${esc(msg)}</span>`; t.append(el); el._t = setTimeout(() => el.remove(), 3500); while (t.children.length > 3) t.firstChild.remove(); }

/* ================= trạng thái ================= */
const ST = { runs: [], sel: '', tab: 'live', data: null, imgs: [], login: false, depth: 'auto', poll: 0, fpoll: 0, frame: -1, ctrl: false, busy: false, stream: null, sending: [], seen: new Set(), curAt: 0, gopen: new Set(), gclose: new Set(), xopen: new Set(), lf: 'all', side: false, zoom: false, nochat: lsGet('qa.nochat') === '1', chatW: +lsGet('qa.chatw') || 0 };
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* trình duyệt chặn lưu: bỏ qua */ } }
const LIVE = new Set(['starting', 'running', 'waiting', 'paused', 'reporting', 'idle']);
const WORKING = new Set(['starting', 'running', 'reporting']);
/** trạng thái → [chấm, nhãn ngắn] */
const STL = { starting: ['warn pulse', 'Đang khởi động'], running: ['rec pulse', 'Đang test'], waiting: ['warn pulse', 'Chờ bạn'], paused: ['warn', 'Tạm dừng'], reporting: ['warn pulse', 'Viết báo cáo'], idle: ['ok', 'Sẵn sàng'], done: ['ok', 'Xong'], error: ['err', 'Lỗi'] };
/** pha đang làm → biểu tượng + kiểu hiệu ứng */
const PH = { open: ['loader', 'load'], load: ['loader', 'load'], look: ['eye', 'think'], think: ['', 'think'], act: ['pointer', 'act'], wait: ['hand', 'wait'], pause: ['pause', 'wait'], report: ['file', 'think'], idle: ['check', 'idle'] };
const KIND = { goto: 'globe', click: 'pointer', fill: 'edit', select: 'list', press: 'kbd', hover: 'eye', scroll: 'scroll', back: 'back', wait: 'clock', note: 'note', ask: 'help', finish: 'check', dialog: 'alert', info: 'image' };
const NOTE = { bug: ['bug', 'Lỗi'], ux: ['layout', 'UX'], perf: ['gauge', 'Tốc độ'], content: ['text', 'Nội dung'], a11y: ['eye', 'Truy cập'], security: ['shield', 'Bảo mật'], ok: ['check', 'Tốt'] };
const SEV = { cao: 'err', 'trung bình': 'warn', 'thấp': '' };
const RES = { pass: ['check', 'ok', 'Đạt'], fail: ['x', 'err', 'Lỗi'], warn: ['alert', 'warn', 'Cần xem'], skip: ['minus', '', 'Bỏ qua'] };
/** thời gian test: [giá trị, nhãn, gợi ý, số bước tối đa] — Tự động: agent tự lập kế hoạch và ước lượng thời gian (≤ 20 phút). */
const BUDGETS = [['auto', 'Tự động', 'Agent tự lập kế hoạch và ước lượng thời gian', 50], [5, '5 phút', 'Test nhanh luồng chính', 20], [10, '10 phút', 'Test chuẩn', 40], [20, '20 phút', 'Test kỹ, nhiều trường hợp', 70]];
const EXAMPLES = ['Form đăng nhập: bỏ trống, sai mật khẩu, email sai', 'Trang chủ: link hỏng, tốc độ, bố cục', 'Luồng tạo mới → sửa → tìm kiếm (dữ liệu test)'];

/* ================= khung ================= */
function render() {
  ROOT.innerHTML = `<div class="q-app"><aside class="q-side">
    <div class="q-sh">${ico('clip2', 16, 'mut')}<b>Kiểm thử</b><span class="grow"></span><button type="button" class="btn sm" data-a="new" title="Lượt test mới">${ico('plus', 14)}Mới</button></div>
    <div class="q-hist" id="qHist"></div>
  </aside><div class="q-scrim" data-a="side"></div><main class="q-main" id="qMain"></main></div><div id="qToast" class="q-toast"></div><div id="qLb" class="q-lb" hidden></div>`;
  ROOT.onclick = onClick;
  paintHist(); paintMain();
}

/* ---------- lượt mới ---------- */
function newHtml() {
  return `<button type="button" class="btn ghost icon q-sidebtn q-sidefloat" data-a="side" title="Lịch sử">${ico('list', 16)}</button><div class="q-hero"><div class="q-hero-in">
    <h2>Kiểm thử phần mềm</h2>
    <form class="q-new" id="qNew" autocomplete="off">
      <label class="q-url">${ico('globe', 16)}<input class="in" id="qUrl" placeholder="Nhập link trình duyệt cần kiểm thử" inputmode="url" spellcheck="false"></label>
      <div class="q-goal" id="qGoalBox"><textarea class="in" id="qGoal" rows="3" placeholder="Mô tả những gì cần kiểm thử — có thể dán ảnh minh hoạ"></textarea><div class="q-thumbs" id="qThumbs"></div></div>
      <div class="q-login" id="qLogin" hidden><input class="in sm" id="qUser" placeholder="Tài khoản" autocomplete="off"><input class="in sm" id="qPass" type="password" placeholder="Mật khẩu" autocomplete="new-password"></div>
      <div class="q-bar"><button type="button" class="btn ghost icon" data-a="pick" title="Đính kèm ảnh (hoặc dán / kéo thả)">${ico('clip', 16)}</button><button type="button" class="btn ghost icon" data-a="login" title="Tài khoản đăng nhập (AI chỉ thấy {{user}} / {{pass}}, không lưu)">${ico('key', 16)}</button>
        <div class="q-seg q-depth" title="Thời gian kiểm thử tối đa">${BUDGETS.map(([v, l, t]) => `<button type="button" data-depth="${v}" title="${t}">${l}</button>`).join('')}<span class="q-segcur"></span></div>
        <span class="grow"></span><button type="submit" class="btn pri" id="qRun" title="Ctrl + Enter">${ico('play', 14)}Bắt đầu kiểm thử</button></div>
      <input type="file" id="qFile" accept="image/png,image/jpeg,image/webp" multiple hidden>
    </form>
    <div class="q-ex">${EXAMPLES.map(t => `<button type="button" class="q-exi" data-ex="${esc(t)}">${esc(t)}</button>`).join('')}</div>
  </div></div>`;
}
function bindNew() {
  const f = $('#qNew'); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); run(); };
  $('#qGoal').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } };
  $('#qGoal').onpaste = e => { const fs = [...(e.clipboardData?.files || [])].filter(x => /^image\//.test(x.type)); if (fs.length) { e.preventDefault(); addImgs(fs); } };
  const box = $('#qGoalBox'); box.ondragover = e => { e.preventDefault(); box.classList.add('drag'); }; box.ondragleave = () => box.classList.remove('drag');
  box.ondrop = e => { e.preventDefault(); box.classList.remove('drag'); addImgs([...(e.dataTransfer?.files || [])].filter(x => /^image\//.test(x.type))); };
  $('#qFile').onchange = e => { addImgs([...e.target.files]); e.target.value = ''; };
  paintForm(); setTimeout(() => $('#qUrl')?.focus(), 30);
}
function paintForm() {
  if (!$('#qNew')) return;
  ROOT.querySelectorAll('[data-depth]').forEach(b => b.classList.toggle('on', b.dataset.depth === String(ST.depth))); requestAnimationFrame(() => segs($('#qNew'), !$('#qNew')?._seg)); if ($('#qNew')) $('#qNew')._seg = 1;
  $('#qLogin').hidden = !ST.login; ROOT.querySelector('[data-a=login]').classList.toggle('on', ST.login);
  $('#qThumbs').innerHTML = ST.imgs.map((x, i) => `<span class="q-th"><img src="${x.url}" alt=""><button type="button" data-rm="${i}" title="Bỏ ảnh">${ico('x', 12)}</button></span>`).join('');
  $('#qRun').disabled = ST.busy; $('#qRun').innerHTML = `${ico('play', 14)}Bắt đầu kiểm thử`;
}
function addImgs(fs) {
  for (const f of fs) { if (ST.imgs.length >= 6) { toast('Tối đa 6 ảnh'); break; } if (f.size > 8 * 1048576) { toast('Ảnh tối đa 8 MB'); continue; } ST.imgs.push({ f, url: URL.createObjectURL(f) }); }
  paintForm();
}
/** Ảnh đính kèm: thu nhỏ còn ≤ 1600px JPEG trước khi gửi (tải lên nhanh hơn nhiều, AI đọc vẫn rõ, đỡ token). */
async function shrink(f) {
  try {
    const bm = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bm.width, bm.height));
    if (k === 1 && f.size < 600 * 1024) return f;
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < f.size ? new File([blob], (f.name || 'anh').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}
/** Gửi có tiến độ (XHR) để biết đang tải ảnh lên bao nhiêu %. */
function upload(fd, onp) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', `${API}?action=start`); x.timeout = 120000;
    x.upload.onprogress = e => { if (e.lengthComputable) onp(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* không phải JSON */ } if (x.status >= 400 || j.ok === false) rej(new Error(j.stage || 'Lỗi máy chủ')); else res(j); };
    x.onerror = () => rej(new Error('Mất kết nối')); x.ontimeout = () => rej(new Error('Máy chủ phản hồi quá lâu'));
    x.send(fd);
  });
}
/** Màn "đang khởi động" hiện ngay khi bấm Bắt đầu: 3 bước Chuẩn bị → Kết nối máy chủ → Khởi chạy trình duyệt. */
const BOOT = ['Chuẩn bị', 'Kết nối máy chủ', 'Khởi chạy trình duyệt'];
function startingHtml(url) {
  return `<header class="q-rh"><button type="button" class="btn ghost icon q-sidebtn" data-a="side" title="Lịch sử">${ico('list', 16)}</button><div class="q-rt"><b>${esc(hostOf(url))}</b></div></header>
    <div class="q-empty"><div class="q-boot" id="qBoot">${ico('loader', 20, 'spin')}<b class="q-shine">${BOOT[0]}</b><ol>${BOOT.map((t, i) => `<li data-i="${i}"${i ? '' : ' class="on"'}><i></i><span>${t}</span></li>`).join('')}</ol></div></div>`;
}
function bootStep(i) { const b = $('#qBoot'); if (!b) return; b.querySelector('b').textContent = BOOT[i]; b.querySelectorAll('li').forEach(li => { const k = +li.dataset.i; li.className = k < i ? 'ok' : k === i ? 'on' : ''; }); }
async function run() {
  const url = $('#qUrl').value.trim(), goal = $('#qGoal').value.trim();
  if (!url) { $('#qUrl').focus(); toast('Nhập link cần kiểm thử'); return; }
  if (ST.busy) return;
  const B = BUDGETS.find(x => String(x[0]) === String(ST.depth)) || BUDGETS[0], login = ST.login ? [$('#qUser').value, $('#qPass').value] : null, imgs = ST.imgs.slice();
  ST.busy = true;
  const m = $('#qMain'); m.innerHTML = startingHtml(url); m._vid = 'boot';
  try {
    const fd = new FormData(); fd.append('url', url); fd.append('goal', goal); fd.append('max_steps', B[3]); fd.append('minutes', B[0]);
    if (login) { fd.append('user', login[0]); fd.append('pass', login[1]); }
    for (const x of imgs) { const f = await shrink(x.f); fd.append('img', f, f.name || 'anh.jpg'); }
    bootStep(1);
    const d = await upload(fd, p => { if (p >= 100) bootStep(2); });
    bootStep(2);
    ST.imgs = []; ST.login = false; ST.busy = false;
    loadList(); select(d.id);
  } catch (e) {
    ST.busy = false; toast(e.message); m._vid = ''; ST.sel = ''; paintMain();
    const u = $('#qUrl'), g = $('#qGoal'); if (u) u.value = url; if (g) g.value = goal; paintForm();
  }
}

/* ================= lịch sử ================= */
async function loadList() { try { ST.runs = (await get('list')).runs || []; } catch (e) { toast(e.message); } paintHist(); }
function paintHist() {
  const el = $('#qHist'); if (!el) return;
  if (!ST.runs.length) { el.innerHTML = `<div class="q-empty sm"><span>Chưa có lượt test</span></div>`; return; }
  el.innerHTML = ST.runs.map(r => { const [, lb] = STL[r.status] || ['', r.status]; return `<div class="q-hi${r.id === ST.sel ? ' on' : ''}" data-run="${r.id}" data-id="${r.id}" role="button" tabindex="0">
    <span class="q-hm"><b>${esc(r.title || hostOf(r.url))}</b><span>${LIVE.has(r.status) ? esc(lb) : `${dm(r.created)} ${hm(r.created)}`}</span></span>
    ${r.score != null ? `<span class="q-sc">${r.score}</span>` : ''}<span class="q-hxs"><button type="button" class="btn ghost icon sm q-hx" data-a="ren" title="Đổi tên">${ico('edit', 14)}</button><button type="button" class="btn ghost icon sm q-hx" data-a="delh" title="Xoá">${ico('trash', 14)}</button></span></div>`; }).join('');
}

/* ================= một lượt test ================= */
function select(id) {
  stopStream(); ST.sel = id; ST.data = null; ST.frame = -1; ST.ctrl = false; ST.sending = []; ST.seen = new Set(); ST.gopen = new Set(); ST.gclose = new Set(); ST.xopen = new Set(); ST.lf = 'all'; ST.planKey = ''; ST.planOpen = null; ST.stick = true; ST.side = false; ST.planOpen = null; ST.tab = 'live'; ROOT.querySelector('.q-app')?.classList.remove('side');
  const m = $('#qMain'); if (m) { m._vid = ''; m._vtab = ''; }
  paintHist(); paintMain(); poll();
}
async function poll() {
  clearTimeout(ST.poll); if (!ST.sel || !ROOT) return;
  const id = ST.sel;
  try { const d = await get('state', '&id=' + id); if (id !== ST.sel) return; const was = ST.data?.state?.status; ST.data = d; paintMain(); if (was !== d.state.status) loadList(); }
  catch (e) { if (id === ST.sel) { ST.data = { error: e.message }; paintMain(); } ST.poll = setTimeout(poll, 4000); return; }
  const s = ST.data.state.status;
  ST.poll = setTimeout(poll, WORKING.has(s) || s === 'waiting' || ST.sending.length ? 700 : LIVE.has(s) ? 1800 : 6000);
}
function paintMain() {
  const m = $('#qMain'); if (!m) return;
  if (!ST.sel) { if (m._vid !== 'new') { m.innerHTML = newHtml(); m._vid = 'new'; m._vtab = ''; bindNew(); } return; }
  const d = ST.data;
  if (!d) { m.innerHTML = `<div class="q-empty">${ico('loader', 22, 'spin')}</div>`; m._vid = ''; return; }
  if (d.error) { m.innerHTML = `<div class="q-empty">${ico('alert', 22)}<span>${esc(d.error)}</span></div>`; m._vid = ''; return; }
  const same = m._vid === ST.sel && m._vtab === ST.tab;
  if (!same) {
    m.innerHTML = `<div class="q-top"><header class="q-rh" id="qHead"></header><div class="q-tabs" id="qTabs"></div></div><div class="q-body${ST.tab === 'live' ? ' q-lv' : ''}" id="qBody">${ST.tab === 'live' ? liveHtml() : ''}</div>`;
    m._vid = ST.sel; m._vtab = ST.tab; ST.seen = new Set();
    if (ST.tab === 'live') bindLive();
  }
  paintHead(); paintTabs();
  if (ST.tab === 'live') paintLive();
  else { const b = $('#qBody'), keep = b.scrollTop, html = ST.tab === 'report' ? reportHtml() : logHtml(); if (b._h !== html) { const was = b._h; b.innerHTML = html; b._h = html; b.scrollTop = keep; segs(b, !was); if (ST.tab === 'report' && !was) reveal(b); } }
}
function paintHead() {
  const d = ST.data, s = d.state, R = d.report, [, lb] = STL[s.status] || ['', s.status], done = !LIVE.has(s.status);
  const html = `<button type="button" class="btn ghost icon q-sidebtn" data-a="side" title="Lịch sử">${ico('list', 16)}</button><div class="q-rt"><b title="${esc(lb)} · ${esc(hostOf(d.run.url))} · ${dm(d.run.created)} ${hm(d.run.created)}">${esc(d.run.name || R?.title || s.title || hostOf(d.run.url))}</b></div><span class="grow"></span>
<div class="q-bg">${done ? `<button type="button" class="btn" data-a="rerun" title="Chạy lại với cùng link và yêu cầu">${ico('play', 14)}Chạy lại</button>` : ''}${R ? `<a class="btn icon" href="${API}?action=docx&id=${ST.sel}" title="Tải báo cáo Word">${ico('download', 15)}</a>` : ''}<a class="btn icon" href="${esc(d.run.url)}" target="_blank" rel="noopener" title="Mở trang">${ico('ext', 15)}</a><button type="button" class="btn icon q-del" data-a="del" title="Xoá lượt test">${ico('trash', 15)}</button></div>`;
  const h = $('#qHead'); if (h._h !== html) { h.innerHTML = html; h._h = html; }
}
const mmss = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };
/** Thanh điều khiển của trình duyệt: tiến độ (bước · thời gian / ngân sách) + Tạm dừng / Tiếp tục / Dừng / Điều khiển. */
function paintCtl() {
  const s = ST.data.state, st = s.status, el = $('#qCtl'), pr = $('#qProg'); if (!el) return;
  const round0 = s.roundAt || s.started || Date.now(), budget = s.budgetMs || 0, used = (s.ended || Date.now()) - round0;
  const stepN = (s.step || 0) - (s.roundStep || 0), stepMax = Math.max(1, (s.max || 40) - (s.roundStep || 0));
  const working = WORKING.has(st) || st === 'waiting' || st === 'paused';
  const B = (a, i, l, cls = '') => `<button type="button" class="btn sm ${cls}" data-a="${a}">${ico(i, 14)}${l}</button>`;
  const btns = st === 'running' || st === 'starting' ? B('pause', 'pause', 'Tạm dừng') + B('stop', 'stop', 'Dừng', 'q-stop') + `<button type="button" class="btn sm icon${ST.ctrl ? ' on' : ''}" data-a="ctrl" title="Tự điều khiển (agent tạm dừng)">${ico('hand', 14)}</button>`
    : st === 'paused' ? B('go', 'play', 'Tiếp tục', 'pri') + B('stop', 'stop', 'Dừng', 'q-stop') + `<button type="button" class="btn sm icon${ST.ctrl ? ' on' : ''}" data-a="ctrl" title="Tự điều khiển">${ico('hand', 14)}</button>`
    : st === 'waiting' ? B('go', 'play', 'Tiếp tục', 'pri') + B('stop', 'stop', 'Dừng', 'q-stop')
    : st === 'idle' ? B('stop', 'x', 'Đóng trình duyệt') : '';
  const meta = working && st !== 'starting' ? `<span class="q-meta num" title="Bước đã chạy / tối đa · thời gian / giới hạn">${stepN}/${stepMax}<em>·</em>${budget ? `${mmss(used)} / ${mmss(budget)}` : mmss(used)}</span>` : '';
  const html = meta || btns ? `<div class="q-bg sm">${meta}${btns}</div>` : ''; if (el._h !== html) { el.innerHTML = html; el._h = html; }
  const pct = working ? Math.min(100, Math.max(stepN / stepMax, budget ? used / budget : 0) * 100) : st === 'reporting' ? 100 : 0;
  pr.classList.toggle('on', working || st === 'reporting'); pr.classList.toggle('ind', st === 'starting' || st === 'reporting'); pr.firstElementChild.style.width = pct + '%';
}
/** Nút xem: ẩn / hiện trò chuyện · phóng to (toàn màn hình, vẫn thấy trò chuyện). */
function paintView() {
  const v = $('#qView'); if (!v) return;
  const html = `<button type="button" class="btn icon${ST.nochat ? '' : ' on'}" data-a="chat" title="${ST.nochat ? 'Hiện' : 'Ẩn'} trò chuyện">${ico('panel', 14)}</button><button type="button" class="btn icon" data-a="zoom" title="${ST.zoom ? 'Thu nhỏ (Esc)' : 'Phóng to toàn màn hình'}">${ico(ST.zoom ? 'min' : 'max', 14)}</button>`;
  if (v._h !== html) { v.innerHTML = html; v._h = html; }
  $('.q-live')?.classList.toggle('nochat', ST.nochat); ROOT.querySelector('.q-app')?.classList.toggle('zoom', ST.zoom);
}
/** − 75% + : thu phóng trang web đang test (agent vẫn bấm đúng chỗ). Bấm số % để về 75%. */
function paintZm() {
  const el = $('#qZm'), s = ST.data?.state; if (!el || !s) return;
  const on = LIVE.has(s.status); el.hidden = !on; if (!on) return;
  if (ST.zoomPend && Math.abs(ST.zoomPend - (s.zoom ?? 0.75)) < 0.01) ST.zoomPend = 0;
  const z = ST.zoomPend || s.zoom || 0.75, pct = Math.round(z * 100);
  const html = `<button type="button" class="btn icon" data-a="zm-" title="Thu nhỏ trang"${z <= 0.5 ? ' disabled' : ''}>${ico('minus', 14)}</button><button type="button" class="btn q-zv num" data-a="zm0" title="Về mặc định 75%">${pct}%</button><button type="button" class="btn icon" data-a="zm+" title="Phóng to trang"${z >= 1.5 ? ' disabled' : ''}>${ico('plus', 14)}</button>`;
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
const ZL = [0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
function zoomBy(d) { const s = ST.data?.state; if (!s) return; const cur = ST.zoomPend || s.zoom || 0.75; const z = !d ? 0.75 : d > 0 ? ZL.find(v => v > cur + 0.001) ?? 1.5 : [...ZL].reverse().find(v => v < cur - 0.001) ?? 0.5; if (Math.abs(z - cur) < 0.001) return; ST.zoomPend = z; paintZm(); cmd({ type: 'zoom', z }); clearTimeout(ST.poll); ST.poll = setTimeout(poll, 400); }
function setZoom(on) {
  ST.zoom = on; paintView();
  try { if (on && !document.fullscreenElement) ROOT.requestFullscreen?.().catch(() => {}); else if (!on && document.fullscreenElement === ROOT) document.exitFullscreen?.().catch(() => {}); } catch { /* không cho toàn màn hình: chỉ phóng trong khung */ }
  requestAnimationFrame(() => segs(ROOT, true));
}
/** Kéo vạch giữa màn hình và trò chuyện để đổi cỡ (lưu lại cho lần sau). */
function bindSplit() {
  const sp = $('#qSplit'), lv = $('.q-live'); if (!sp || !lv) return;
  sp.onpointerdown = e => {
    if (e.button !== 0) return; e.preventDefault(); sp.setPointerCapture(e.pointerId); lv.classList.add('drag');
    const r = lv.getBoundingClientRect(), max = Math.min(640, r.width - 360);
    sp.onpointermove = ev => { const w = Math.round(Math.max(280, Math.min(max, r.right - ev.clientX))); ST.chatW = w; lv.style.setProperty('--chatw', w + 'px'); };
    sp.onpointerup = () => { sp.onpointermove = sp.onpointerup = null; lv.classList.remove('drag'); if (ST.chatW) lsSet('qa.chatw', ST.chatW); };
  };
  sp.ondblclick = () => { ST.chatW = 0; lv.style.removeProperty('--chatw'); lsSet('qa.chatw', ''); };
}
/** Kế hoạch test agent lập lúc đầu (trường hợp + thời gian ước tính); tick dần khi chạy. */
function paintPlan() {
  const el = $('#qPlan'), st = ST.data.state, P = st.plan; if (!el) return;
  if (!P || !P.cases?.length) { if (el.innerHTML) { el.innerHTML = ''; el._h = ''; el._l = ''; } return; }
  const n = P.cases.filter(c => c.st === 'done').length, working = WORKING.has(st.status) || st.status === 'waiting' || st.status === 'paused';
  const di = P.cases.findIndex(c => c.st === 'doing'), cur = di >= 0 ? P.cases[di] : null;
  // sang bước mới → mở ra vài giây cho thấy đang ở đâu rồi tự thu lại; xong hết → mở hẳn
  const key = `${ST.sel}|${P.cases.length}|${di}|${cur?.name || ''}`;
  if (ST.planKey !== key) { const firstSeen = !ST.planKey; ST.planKey = key; if (cur && working) { ST.planOpen = null; ST.planPeek = Date.now() + (firstSeen ? 2500 : 4000); clearTimeout(ST.planTm); ST.planTm = setTimeout(paintPlan, (firstSeen ? 2500 : 4000) + 30); } }
  const auto = !working || n === P.cases.length || Date.now() < (ST.planPeek || 0), open = ST.planOpen ?? auto;
  const IC2 = { done: ['check', 'ok'], doing: ['loader', 'run'], todo: ['minus', ''], skip: ['x', 'skip'] };
  const head = `${ico('next', 14, 'q-chev')}<b>Kế hoạch test</b><span class="mut num">${n}/${P.cases.length}</span>${cur && working ? `<span class="q-pnow"><span class="q-shine">${esc(cur.name)}</span></span>` : ''}${P.minutes ? `<span class="q-pmin">Khoảng ${P.minutes} phút</span>` : ''}`;
  const list = `<ol class="q-pl">${P.cases.map((c, i) => { const [ic, k] = IC2[c.st] || IC2.todo; return `<li class="${k}${i === di ? ' cur' : ''}" title="${esc(c.why || '')}">${ico(ic, 13, k === 'run' ? 'spin' : '')}<span>${esc(c.name)}</span></li>`; }).join('')}</ol>`;
  if (el._h !== head || !el.firstChild) { if (!el.firstChild) el.innerHTML = `<button type="button" class="q-ph" data-a="plan"></button><div class="q-plw"><div></div></div>`; el.firstChild.innerHTML = head; el._h = head; }
  if (el._l !== list) { el.querySelector('.q-plw>div').innerHTML = list; el._l = list; }
  el.firstChild.classList.toggle('on', open); el.classList.toggle('open', open); el.classList.toggle('peek', open && ST.planOpen == null && working);
  const ol = el.querySelector('.q-pl'), li = ol?.querySelector('li.cur'); if (ol && li && open) ol.scrollTop = Math.max(0, li.offsetTop - ol.clientHeight / 2);
}
function paintTabs() {
  const s = ST.data.state, R = ST.data.report, el = $('#qTabs');
  const html = `<div class="q-seg">${[['live', 'monitor', 'Trực tiếp'], ['report', 'file', 'Báo cáo'], ['log', 'list', 'Nhật ký']].map(([k, i, l]) => `<button type="button" class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${ico(i, 14)}${l}${k === 'log' ? `<em>${(s.log || []).length}</em>` : k === 'report' && s.status === 'reporting' ? ico('loader', 12, 'spin') : k === 'report' && R ? `<em>${R.verdict.score}</em>` : ''}</button>`).join('')}<span class="q-segcur"></span></div>`;
  if (el._h !== html) { const first = !el._h; el.innerHTML = html; el._h = html; segs(el, first); }
}
/** Nhóm nút dạng viên thuốc (HeroUI): nền trắng trượt tới nút đang chọn. */
function segs(root = ROOT, instant = false) {
  if (!root) return;
  for (const g of root.querySelectorAll('.q-seg')) {
    const on = g.querySelector('button.on'), cur = g.querySelector('.q-segcur'); if (!cur) continue;
    if (!on) { cur.style.opacity = '0'; continue; }
    if (instant) cur.style.transition = 'none';
    cur.style.opacity = '1'; cur.style.width = on.offsetWidth + 'px'; cur.style.transform = `translateX(${on.offsetLeft - 3}px)`;
    if (instant) { void cur.offsetWidth; cur.style.transition = ''; }
  }
}

/* ---------- Trực tiếp: trình duyệt + trò chuyện ---------- */
function liveHtml() {
  const d = ST.data;
  return `<div class="q-live${ST.nochat ? ' nochat' : ''}"${ST.chatW ? ` style="--chatw:${ST.chatW}px"` : ''}><section class="q-browser"><div class="q-stage"><div class="q-chrome"><span class="q-lights"><i></i><i></i><i></i></span><span class="q-addr" id="qAddr">${esc(d.state.url || d.run.url)}</span><div class="q-ctl" id="qCtl"></div><div class="q-bg sm q-zm" id="qZm" hidden></div><div class="q-bg sm q-view" id="qView"></div></div><div class="q-prog" id="qProg"><i></i></div>
      <div class="q-screen" id="qScreen" tabindex="0"><img id="qFrame" alt="Màn hình trình duyệt kiểm thử" draggable="false"><div class="q-cur" id="qCur" hidden>${ico('pointer', 22)}<i></i></div>
        <div class="q-phase" id="qPhase" hidden></div><div class="q-take" id="qTake" hidden></div><div class="q-load" id="qLoad">${ico('loader', 18, 'spin')}</div></div></div></section><div class="q-split" id="qSplit" title="Kéo để đổi cỡ khung trò chuyện · bấm đúp để về mặc định"></div>
    <section class="q-chat"><div class="q-plan" id="qPlan"></div><div class="q-feed" id="qFeed"></div><div class="q-typing" id="qTyping" hidden></div><div class="q-quick" id="qQuick"></div>
      <form class="q-cmp" id="qCmp"><textarea class="in" id="qSay" rows="1" placeholder="Nhắn agent…"></textarea><button type="submit" class="btn pri icon" title="Gửi (Enter)">${ico('send', 16)}</button></form></section></div>`;
}
function bindLive() {
  const sc = $('#qScreen'), img = $('#qFrame');
  const can = () => ST.ctrl || ['waiting', 'paused', 'idle'].includes(ST.data?.state?.status);
  img.onclick = e => { if (!can()) { const st = ST.data?.state?.status; if (LIVE.has(st)) toast('Bấm nút bàn tay trên thanh trình duyệt để tự điều khiển', 1); else toast('Trình duyệt đã đóng — nhắn ở khung bên phải để test tiếp', 1); return; } const r = img.getBoundingClientRect(); tap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); cmd({ type: 'click', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); sc.focus(); };
  let buf = '', tm = 0; const flush = () => { if (buf) { cmd({ type: 'type', text: buf }); buf = ''; } };
  sc.onkeydown = e => {
    if (!can() || e.target !== sc) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { buf += e.key; clearTimeout(tm); tm = setTimeout(flush, 220); e.preventDefault(); return; }
    const k = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Delete: 'Delete' }[e.key];
    if (k) { e.preventDefault(); flush(); cmd({ type: 'key', key: k }); }
  };
  sc.onpaste = e => { if (!can()) return; const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); flush(); cmd({ type: 'type', text: t }); } };
  let wl = 0; sc.onwheel = e => { if (!can()) return; e.preventDefault(); const t = Date.now(); if (t - wl < 140) return; wl = t; cmd({ type: 'scroll', dy: Math.sign(e.deltaY) * 450 }); };
  const ta = $('#qSay');
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendSay(); } };
  $('#qCmp').onsubmit = e => { e.preventDefault(); sendSay(); };
  bindSplit(); bindStick(); startStream();
}
/* Hình trực tiếp: hỏi ảnh mới ~5 lần / giây khi agent đang làm (máy chủ trả 204 nếu chưa có ảnh mới → rất nhẹ), 1 lần / giây khi chờ,
   dừng thì lấy ảnh cuối. Ảnh mới tải xong mới thay (không nháy). Ổn định qua Cloudflare hơn luồng video dài. */
const FR = { t: 0, busy: false, tm: 0, url: '', id: '' };
function startStream() { stopStream(); FR.t = 0; FR.id = ST.sel; frameTick(); }
function stopStream() { clearTimeout(FR.tm); FR.tm = 0; }
async function frameTick() {
  clearTimeout(FR.tm); FR.tm = 0;
  const img = $('#qFrame'), id = ST.sel; if (!img || !id || !ST.data?.state) return;
  if (FR.id !== id) { FR.id = id; FR.t = 0; }
  if (!FR.busy) {
    FR.busy = true;
    try {
      const r = await fetch(`${API}?action=frame&id=${id}&t=${FR.t}`, { cache: 'no-store' });
      if (r.status === 200 && id === ST.sel) {
        FR.t = +r.headers.get('X-Frame-T') || Date.now();
        const u = URL.createObjectURL(await r.blob()), n = new Image();
        n.onload = () => { const cur = $('#qFrame'); if (cur && id === ST.sel) { cur.src = u; if (FR.url && FR.url !== u) URL.revokeObjectURL(FR.url); FR.url = u; $('#qLoad')?.remove(); } else URL.revokeObjectURL(u); };
        n.src = u;
      } else if (r.status === 204 && FR.url) $('#qLoad')?.remove();
    } catch { /* mạng chập chờn: lần sau */ } finally { FR.busy = false; }
  }
  const st = ST.data?.state?.status, ms = WORKING.has(st) || st === 'waiting' ? 200 : LIVE.has(st) ? 1000 : 0;
  if (ms && id === ST.sel) FR.tm = setTimeout(frameTick, document.visibilityState === 'hidden' ? 2500 : ms);
}
function paintLive() {
  const d = ST.data, s = d.state, live = LIVE.has(s.status), ph = s.phase;
  const a = $('#qAddr'); if (a) a.textContent = s.url || d.run.url;
  if (live && !FR.tm && !FR.busy) frameTick();   // đang chạy lại (nhắn sau khi xong) → hỏi ảnh tiếp
  const take = ST.ctrl || ['waiting', 'paused'].includes(s.status);
  $('#qScreen').classList.toggle('q-ctl', take); $('#qScreen').classList.toggle('beam', WORKING.has(s.status) && !take);
  const tk = $('#qTake'); tk.hidden = !take;
  if (take) tk.innerHTML = s.status === 'waiting' ? `${ico('hand', 14)}<span>${esc(s.ask?.kind === 'login' ? 'Đăng nhập trên màn hình' : s.ask?.kind === 'otp' ? 'Nhập mã trên màn hình' : 'Agent chờ bạn trả lời')}</span><button type="button" class="btn pri sm" data-a="go">Tiếp tục</button>`
    : `${ico('hand', 14)}<span>Bạn đang điều khiển</span><button type="button" class="btn sm" data-a="ctrl">Trả lại agent</button>`;
  // pha đang làm (góc dưới màn hình)
  const P = $('#qPhase'), showPh = live && ph && !take && s.status !== 'idle';
  P.hidden = !showPh;
  if (showPh) { const [i, k] = PH[ph.k] || ['loader', 'load']; const key = ph.k + ph.label; if (P.dataset.k !== key) { P.dataset.k = key; P.className = 'q-phase ' + k; P.innerHTML = `${i ? ico(i, 14, k === 'load' ? 'spin' : '') : ''}<span class="${k === 'think' ? 'q-shine' : ''}">${esc(ph.label || '')}</span>`; } }
  // con trỏ ảo
  const c = s.cursor, cur = $('#qCur');
  if (c && c.at !== ST.curAt && live) { ST.curAt = c.at; cur.hidden = false; cur.style.left = c.x * 100 + '%'; cur.style.top = c.y * 100 + '%'; cur.classList.toggle('user', c.k === 'user'); if (c.k === 'click' || c.k === 'user') { cur.classList.remove('tap'); void cur.offsetWidth; cur.classList.add('tap'); } clearTimeout(cur._h); cur._h = setTimeout(() => { cur.hidden = true; }, 4000); }
  if (!live) cur.hidden = true;
  paintView(); paintZm(); paintCtl(); paintPlan(); paintFeed();
  // dòng "đang làm" cuối khung chat + gợi ý nhanh + ô nhắn
  const ty = $('#qTyping'), working = WORKING.has(s.status) && !take;
  ty.hidden = !working;
  if (working) { const lab = s.status === 'reporting' ? 'Đang viết báo cáo' : s.status === 'starting' ? (ph?.label || 'Đang khởi động') : ph?.k === 'think' ? (s.thought ? 'Đang nghĩ · ' + s.thought : 'Đang suy nghĩ') : (ph?.label || 'Đang làm'); if (ty.dataset.t !== lab) { ty.dataset.t = lab; ty.innerHTML = `${ico('loader', 13, 'spin')}<span class="q-tl q-shine">${esc(lab)}</span>`; } }
  const q = $('#qQuick'), chips = s.status === 'waiting' ? (s.ask?.kind === 'login' || s.ask?.kind === 'otp' ? [['go', 'Đã xong'], ['say', 'Bỏ qua đăng nhập']] : [['go', 'Tiếp tục']])
    : s.status === 'idle' || s.status === 'done' ? (d.report ? [['say', 'Test thêm'], ['say', 'Giải thích lỗi nặng nhất'], ['tab', 'Báo cáo']] : [['say', 'Test tiếp']]) : [];
  const qh = chips.map(([k, t]) => `<button type="button" class="btn sm" data-q="${k}" data-t="${esc(t === 'Test thêm' ? 'Test kỹ thêm các trường hợp còn lại' : t)}">${esc(t)}</button>`).join('');
  if (q.dataset.h !== qh) { q.dataset.h = qh; q.innerHTML = qh; }
  const ta = $('#qSay'), ph2 = s.status === 'waiting' ? 'Trả lời agent…' : live ? 'Nhắn cho agent…' : 'Nhắn để kiểm thử tiếp…';
  if (ta.placeholder !== ph2) ta.placeholder = ph2;
}
/** Khung chat = tin nhắn (người dùng / agent / hệ thống) + từng bước test, xếp theo thời gian; chỉ thêm phần mới (không vẽ lại cả khung). */
function feedItems() {
  const s = ST.data.state, t0 = s.started || ST.data.run.created || 0, out = [];
  // gọn: tin hệ thống và tin "xong" chỉ giữ cái mới nhất; lời "Em sẽ test N trường hợp" đã có ở khung Kế hoạch
  const C = (s.chat || []).filter(m => m.kind !== 'plan'), lastSys = C.filter(m => m.who === 'sys').pop(), lastDone = C.filter(m => m.kind === 'done').pop();
  for (const m of C) if ((m.who !== 'sys' || m === lastSys) && (m.kind !== 'done' || m === lastDone)) out.push({ key: 'c' + m.id, at: m.at, m });
  for (const x of s.log || []) if (!['note', 'ask'].includes(x.kind)) out.push({ key: 'l' + x.n, at: x.at || t0 + (x.t || 0), x });
  out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  const cids = new Set((s.chat || []).map(m => m.cid).filter(Boolean));
  ST.sending = ST.sending.filter(p => !cids.has(p.cid) && Date.now() - p.at < 60000);
  for (const p of ST.sending) out.push({ key: 'p' + p.cid, at: p.at, m: { who: 'user', text: p.text, pending: true } });
  return out;
}
/** Khung chat gọn như Cú vọ: các bước liền nhau cùng một trường hợp gộp thành 1 dòng (bấm để xem từng bước), phát hiện chỉ hiện tiêu đề. */
function feedBlocks() {
  const out = [];
  for (const it of feedItems()) {
    if (it.x) { const l = out[out.length - 1], c = it.x.case || ''; if (l && l.g && l.case === c) l.steps.push(it.x); else out.push({ g: true, key: 'g' + it.x.n, case: c, steps: [it.x] }); }
    else out.push({ key: it.key, m: it.m });
  }
  return out;
}
const stepHtml = x => `<div class="q-step${x.ok ? '' : ' bad'}"${x.shot ? ` data-shot="${esc(x.shot)}"` : ''}${x.res ? ` title="${esc(x.res)}"` : ''}>${ico(x.ok ? KIND[x.kind] || 'pointer' : 'alert', 14)}<span class="q-sl">${esc(x.label)}</span>${x.ms ? `<em>${secs(x.ms)}</em>` : ''}</div>`;
function groupHtml(b, live) {
  const n = b.steps.length, bad = b.steps.filter(x => !x.ok).length, ms = b.steps.reduce((a, x) => a + (x.ms || 0), 0);
  const open = ST.gopen.has(b.key) || (!ST.gclose.has(b.key) && live);
  return `<button type="button" class="q-gh${open ? ' on' : ''}" data-g="${b.key}">${ico('next', 14, 'q-chev')}<b>${esc(b.case || 'Thao tác')}</b><span class="q-gm">${n} bước${bad ? ` · <i>${bad} lỗi</i>` : ''}</span>${ms ? `<em>${secs(ms)}</em>` : ''}</button>${open ? `<div class="q-gb">${b.steps.map(stepHtml).join('')}</div>` : ''}`;
}
function msgHtml(m, key) {
  if (m.who === 'user') return `<div class="q-msg u${m.pending ? ' pend' : ''}"><div class="q-bub">${esc(m.text)}</div></div>`;
  if (m.who === 'sys') return `<div class="q-sys">${esc(String(m.text || '').replace(/^Đã đóng trình duyệt.*$/, 'Trình duyệt đã đóng · nhắn để test tiếp'))}</div>`;
  const open = ST.xopen.has(key);
  if (m.kind === 'note') { const l = (NOTE[m.note] || NOTE.bug)[1]; return `<div class="q-ncard${open ? ' on' : ''}" data-tg="${key}" title="${esc(l)}"><div class="q-nt"><span class="q-nl ${SEV[m.sev] ?? ''}">Phát hiện</span><b>${esc(m.text)}</b><span class="q-sev2 ${SEV[m.sev] ?? ''}">${SEVL[m.sev] || l}</span></div>${open && m.detail ? `<p>${esc(m.detail)}</p>${m.shot ? `<button type="button" class="btn ghost sm" data-shot="${esc(m.shot)}">${ico('image', 14)}Màn hình</button>` : ''}` : ''}</div>`; }
  if (m.kind === 'done') { const sc = m.score ?? ST.data?.report?.verdict?.score, k = sc >= 80 ? 'ok' : sc >= 55 ? 'warn' : 'err'; return `<div class="q-done"><span class="q-dsc ${k}">${sc ?? '–'}</span><div class="q-dt">${md(String(m.text || '').split('\n')[0].replace(/\*\*/g, '').replace(/^Báo cáo:\s*/, '').replace(/\s*·\s*\d+\/100.*$/, ''))}</div><button type="button" class="btn sm" data-tab="report">Báo cáo</button></div>`; }
  const long = String(m.text || '').length > 170;
  return `<div class="q-msg a${m.kind === 'ask' ? ' ask' : ''}"><div class="q-bub"><div class="q-bt${long && !open ? ' clamp' : ''}">${md(m.text)}</div></div>${long ? `<button type="button" class="q-more" data-tg="${key}">${open ? 'Thu gọn' : 'Xem thêm'}</button>` : ''}</div>`;
}
/** Vẽ theo khối có khoá: chỉ khối mới / khối đổi mới vẽ lại (không giật, không mất chỗ đang đọc). */
function paintFeed() {
  const f = $('#qFeed'); if (!f) return;
  const s = ST.data.state, live = WORKING.has(s.status) || s.status === 'waiting', blocks = feedBlocks();
  const lastG = blocks.map(b => !!b.g).lastIndexOf(true), first = !f.children.length, atEnd = f.scrollHeight - f.scrollTop - f.clientHeight < 90;
  const have = new Map([...f.children].map(el => [el.dataset.key, el])); let prev = null;
  blocks.forEach((b, i) => {
    const h = b.g ? groupHtml(b, live && i === lastG) : msgHtml(b.m, b.key);
    let el = have.get(b.key);
    if (!el) { el = document.createElement('div'); el.dataset.key = b.key; el.className = b.g ? 'q-blk g' : b.m?.who === 'agent' && !['note', 'done'].includes(b.m.kind) ? 'q-blk a' : 'q-blk'; el.innerHTML = h; el._h = h; if (!first) fresh(el, b); }
    else if (el._h !== h) { el.innerHTML = h; el._h = h; }
    have.delete(b.key);
    const pos = prev ? prev.nextSibling : f.firstChild; if (el !== pos) f.insertBefore(el, pos); prev = el;
  });
  for (const el of have.values()) el.remove();
  if (first || ST.stick || atEnd) f.scrollTop = f.scrollHeight;
}
/** Khối mới xuất hiện: tin của agent gõ ra từng chữ (như Gemini, ≤ 0.7 giây); kết quả cuối bật nhẹ; còn lại hiện thẳng — không hiệu ứng thừa. */
function fresh(el, b) {
  if (b.g || !b.m) return;
  if (b.m.kind === 'done') { el.classList.add('q-pop'); return; }
  if (b.m.who !== 'agent' || b.m.kind === 'note') { if (b.m.who === 'user') el.classList.add('q-fade'); return; }
  const bub = el.querySelector('.q-bub'); if (!bub) return;
  const nodes = [], w = document.createTreeWalker(bub, NodeFilter.SHOW_TEXT); while (w.nextNode()) nodes.push([w.currentNode, w.currentNode.data]);
  const total = nodes.reduce((a, [, t]) => a + t.length, 0); if (!total) return;
  for (const [n] of nodes) n.data = '';
  const dur = Math.min(700, total * 14), t0 = performance.now();
  const step = now => { let k = Math.ceil(total * Math.min(1, (now - t0) / dur)); for (const [n, t] of nodes) { const c = Math.min(t.length, k); n.data = t.slice(0, c); k -= c; } stickBottom(); if (now - t0 < dur) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
/** Khung chat bám đáy: có tin mới / khung đổi cỡ thì tự cuộn xuống tin mới nhất — trừ khi người dùng đang cuộn lên đọc lại. */
function stickBottom() { const f = $('#qFeed'); if (f && ST.stick) f.scrollTop = f.scrollHeight; }
function bindStick() {
  const f = $('#qFeed'); if (!f) return; ST.stick = true;
  f.addEventListener('scroll', () => { ST.stick = f.scrollHeight - f.scrollTop - f.clientHeight < 60; }, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(stickBottom).observe(f);
  f.addEventListener('load', stickBottom, true);
}
function toggleFeed(set, key) { if (set === 'g') { const was = ST.gopen.has(key) || (!ST.gclose.has(key) && $(`[data-g="${key}"]`)?.classList.contains('on')); if (was) { ST.gopen.delete(key); ST.gclose.add(key); } else { ST.gclose.delete(key); ST.gopen.add(key); } } else { if (ST.xopen.has(key)) ST.xopen.delete(key); else ST.xopen.add(key); } paintFeed(); }
function tap(x, y) { const cur = $('#qCur'); if (!cur) return; cur.hidden = false; cur.classList.add('user'); cur.style.left = x * 100 + '%'; cur.style.top = y * 100 + '%'; cur.classList.remove('tap'); void cur.offsetWidth; cur.classList.add('tap'); clearTimeout(cur._h); cur._h = setTimeout(() => { cur.hidden = true; }, 2500); }
const cmd = c => post('cmd', c, '&id=' + ST.sel).catch(e => toast(e.message));
async function sendSay(text) {
  const ta = $('#qSay'), t = (text ?? ta?.value ?? '').trim(); if (!t || !ST.sel) return;
  const cid = Math.random().toString(36).slice(2, 10);
  ST.sending.push({ cid, text: t, at: Date.now() }); ST.stick = true; if (text == null && ta) { ta.value = ''; ta.style.height = 'auto'; }
  paintFeed();
  try { const r = await post('say', { text: t, cid }, '&id=' + ST.sel); if (r.resumed) toast('Đang mở lại trình duyệt để làm tiếp', 1); }
  catch (e) { ST.sending = ST.sending.filter(p => p.cid !== cid); paintFeed(); toast(e.message); if (ta && !ta.value) ta.value = t; }
  clearTimeout(ST.poll); ST.poll = setTimeout(poll, 300);
}

/* ---------- Báo cáo ---------- */
/* ---------- Báo cáo ---------- */
const USD_VND = 26000;   // tỷ giá ước tính để quy đổi chi phí AI
const vnd = n => (Math.round(n * USD_VND / 100) * 100).toLocaleString('vi-VN') + ' ₫';
const sevRank = { cao: 0, 'trung bình': 1, 'thấp': 2 };
const SEVL = { cao: 'Cao', 'trung bình': 'Vừa', 'thấp': 'Thấp' };
const kpi = (l, v, sub, cls = '') => `<div class="q-kpi ${cls}"><span>${l}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
const sec = (t, body, n, extra = '', cls = '') => body ? `<section class="q-sec${cls ? ' ' + cls : ''}"><h3>${t}${n != null ? `<em>${n}</em>` : ''}<span class="grow"></span>${extra}</h3><div class="q-sb">${body}</div></section>` : '';
function speed(s) {
  const navs = s.metrics?.navs || [], M = s.metrics || {}, mx = k => Math.max(0, ...navs.map(x => x[k] || 0)), avg = k => navs.length ? Math.round(navs.reduce((a, x) => a + (x[k] || 0), 0) / navs.length) : 0;
  const v = (n, unit, bad) => n ? `<b class="${bad ? 'bad' : ''}">${unit === 's' ? (n / 1000).toFixed(1) : n}<i>${unit}</i></b>` : '<b class="mut">–</b>';
  const t = (l, x) => `<div class="q-sp"><span>${l}</span>${x}</div>`;
  return `<div class="q-sps">${t('Phản hồi đầu', v(avg('ttfb'), 'ms', avg('ttfb') > 800))}${t('Hiển thị chính', v(mx('lcp'), 's', mx('lcp') > 2500))}${t('Tải xong', v(mx('load'), 's', mx('load') > 4000))}${t('Xô lệch', `<b class="${Math.max(0, ...navs.map(x => x.cls || 0)) > 0.1 ? 'bad' : ''}">${navs.length ? Math.max(...navs.map(x => x.cls || 0)).toFixed(2) : '–'}</b>`)}${t('Request chậm', `<b class="${(M.slow || []).length > 3 ? 'bad' : ''}">${(M.slow || []).length}<i>/ ${M.requests || 0}</i></b>`)}${t('Lỗi JS · HTTP', `<b class="${(M.pageerror || []).length || (M.http || []).some(x => x.status >= 500) ? 'bad' : ''}">${(M.console || []).length + (M.pageerror || []).length}<i>·</i>${(M.http || []).length + (M.failed || []).length}</b>`)}</div>`;
}
function costHtml(s) {
  const U = s.usage; if (!U || !U.calls) return '';
  const by = Object.entries(U.by || {}), rows = by.length ? by : [['—', U]];
  return `<table class="q-tb q-cost"><thead><tr><th>Model</th><th class="r">Lượt gọi</th><th class="r">Token vào</th><th class="r">Đã cache</th><th class="r">Token ra</th><th class="r">USD</th><th class="r">≈ VNĐ</th></tr></thead><tbody>${rows.map(([m, x]) => `<tr><td>${esc(m)}${x.role ? ` <span class="mut">· ${esc(x.role)}</span>` : ''}</td><td class="r num">${x.calls}</td><td class="r num">${(x.in || 0).toLocaleString('vi-VN')}</td><td class="r num mut">${(x.cached || 0).toLocaleString('vi-VN')}</td><td class="r num">${(x.out || 0).toLocaleString('vi-VN')}</td><td class="r num">$${(x.usd || 0).toFixed(4)}</td><td class="r num">${vnd(x.usd || 0)}</td></tr>`).join('')}${by.length > 1 ? `<tr class="tot"><td>Tổng</td><td class="r num">${U.calls}</td><td class="r num">${U.in.toLocaleString('vi-VN')}</td><td class="r num mut">${U.cached.toLocaleString('vi-VN')}</td><td class="r num">${U.out.toLocaleString('vi-VN')}</td><td class="r num">$${U.usd.toFixed(4)}</td><td class="r num">${vnd(U.usd)}</td></tr>` : ''}</tbody></table><p class="q-note">Giá ước tính theo bảng giá OpenAI, quy đổi ${USD_VND.toLocaleString('vi-VN')} ₫ / USD. Dùng key riêng của dự án HS.</p>`;
}
function issueRow(x) {
  return `<tr class="${x.severity === 'cao' ? 'hi' : ''}"><td class="q-lv2 ${SEV[x.severity] ?? ''}">${SEVL[x.severity] || ''}</td><td><b>${esc(x.title)}</b></td><td class="mut">${esc(x.fix || '')}</td><td class="r">${x.shot ? `<button type="button" class="btn ghost icon sm" data-shot="${esc(x.shot)}" title="Xem màn hình">${ico('image', 14)}</button>` : ''}</td></tr>`;
}
const issTable = a => `<table class="q-tb q-iss2"><thead><tr><th>Mức</th><th>Vấn đề</th><th>Cách sửa</th><th></th></tr></thead><tbody>${a.map(issueRow).join('')}</tbody></table>`;
/** Mở báo cáo: điểm đếm lên + các mục hiện dần (chỉ lần đầu mở, ~0.4 giây). */
function reveal(b) {
  const sc = b.querySelector('.q-sc2 b'); if (sc) { const v = +sc.textContent || 0, t0 = performance.now(); const f = now => { const k = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - k, 3); sc.textContent = Math.round(v * e); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
  b.querySelectorAll('.q-rep>*').forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 6)); el.classList.add('q-bf'); });
}
function reportHtml() {
  const d = ST.data, R = d.report, s = d.state;
  if (!R) return `<div class="q-rep">${s.status === 'reporting' ? `<div class="q-wait">${ico('loader', 16, 'spin')}<span>Đang viết báo cáo</span></div><div class="q-skel"><i></i><i></i><i></i></div>` : `<div class="q-empty sm"><span>${esc(LIVE.has(s.status) ? 'Báo cáo có khi test xong' : s.error || 'Chưa có báo cáo')}</span></div>`}${notesHtml(s)}</div>`;
  const v = R.verdict, k = v.score >= 80 ? 'ok' : v.score >= 55 ? 'warn' : 'err';
  const pass = R.cases.filter(c => c.result === 'pass').length, fail = R.cases.filter(c => c.result === 'fail').length, hi = R.issues.filter(x => x.severity === 'cao').length;
  const iss = [...R.issues].sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));
  const dur = (s.ended || Date.now()) - (s.started || d.run.created);
  return `<div class="q-rep">
    <section class="q-sum"><div class="q-hrow"><div class="q-sc2 ${k}"><b>${v.score}</b><span>/100</span></div><div class="q-sumt"><b class="${k}">${esc(v.status)}</b><p>${esc(v.summary)}</p></div><a class="btn" href="${API}?action=docx&id=${ST.sel}" title="Tải báo cáo Word">${ico('download', 14)}Word</a></div>
    <div class="q-kpis">${kpi('Trường hợp đạt', `${pass}<i>/ ${R.cases.length}</i>`, '', fail ? 'bad' : '')}${kpi('Vấn đề', R.issues.length, hi ? `${hi} mức cao` : '', hi ? 'bad' : '')}${kpi('Số bước', s.step || 0)}${kpi('Thời gian', secs(dur))}</div></section>
    ${sec('Vấn đề cần xử lý', iss.length ? issTable(iss) : '<p class="mut">Không thấy vấn đề.</p>', iss.length, '', iss.length ? 'flush' : '')}
    ${sec('Trường hợp kiểm thử', R.cases.length ? `<table class="q-tb q-cases"><thead><tr><th>Trường hợp</th><th>Mong đợi</th><th>Thực tế</th><th>Kết quả</th></tr></thead><tbody>${R.cases.map(c => { const [, kk, l] = RES[c.result] || RES.skip; return `<tr class="${kk === 'err' ? 'hi' : kk === 'warn' ? 'md' : ''}"><td><b>${esc(c.name)}</b></td><td class="mut">${esc(c.expected)}</td><td>${esc(c.actual)}</td><td><span class="q-res ${kk}">${l}</span></td></tr>`; }).join('')}</tbody></table>` : '', R.cases.length, '', 'flush')}
    ${sec('Tốc độ', `${speed(s)}${R.perf.summary ? `<p>${esc(R.perf.summary)}</p>` : ''}${R.perf.items.length ? `<ul class="q-ul">${R.perf.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`)}
    ${sec('Đề xuất kỹ thuật', R.tech.length ? `<table class="q-tb q-tech"><thead><tr><th>Vấn đề</th><th>Nên làm</th></tr></thead><tbody>${R.tech.map(t => `<tr><td class="mut">${esc(t.problem)}</td><td>${esc(t.suggest)}</td></tr>`).join('')}</tbody></table>` : '', R.tech.length, '', 'flush')}
    ${sec('Chức năng', `<p>${esc(R.feature)}</p><ol class="q-mech">${R.mechanism.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`)}
    ${sec('Nên test thêm', R.next.length ? `<div class="q-next">${R.next.map(x => `<button type="button" class="q-nx" data-more="${esc(x)}" title="Nhờ agent test ngay">${ico('play', 14)}<span>${esc(x)}</span></button>`).join('')}</div>` : '', R.next.length)}
    ${sec('Chi phí AI', costHtml(s), null, '', 'flush')}
  </div>`;
}
function notesHtml(s) { const n = s.notes || []; return n.length ? sec('Phát hiện trong lúc test', issTable(n), n.length, '', 'flush') : ''; }

/* ---------- Nhật ký ---------- */
function logHtml() {
  const s = ST.data.state, L = (s.log || []).filter(x => x.kind !== 'info' || x.shot), M = s.metrics || {};
  const nBad = L.filter(x => !x.ok).length, nNote = L.filter(x => x.kind === 'note').length;
  const rows = L.filter(x => ST.lf === 'bad' ? !x.ok : ST.lf === 'note' ? x.kind === 'note' : true);
  const MINOR = new Set(['scroll', 'wait', 'hover', 'press', 'back', 'dialog']);
  const tidy = r => String(r || '').replace(/\s*Xong sau [\d.,]+ giây\.?/g, '').replace(/Không thấy thay đổi chữ trên trang\.\s*/g, '').replace(/^Hiện thêm: /, '').trim();
  const t0 = s.started || ST.data.run.created || 0, at = x => x.t != null ? x.t : x.at ? x.at - t0 : 0;
  let pc = null, gi = 0; const body = rows.map(x => {
    const c = x.case || 'Khác', head = c !== pc ? `<tr class="q-lg"><td colspan="5"><span>${String(++gi).padStart(2, '0')}</span>${esc(c)}</td></tr>` : ''; pc = c;
    const res = tidy(x.res), slow = x.ms > 2000, minor = MINOR.has(x.kind) && x.ok;
    const cls = [x.ok ? '' : 'bad', x.kind === 'note' ? 'nt' : '', minor ? 'minor' : ''].filter(Boolean).join(' ');
    return head + `<tr class="${cls}"><td class="q-lt0 num">${mmss(at(x))}</td><td class="q-la"><span>${ico(x.ok ? KIND[x.kind] || 'pointer' : 'alert', 13)}${esc(x.label)}</span></td><td class="q-lres" title="${esc(res)}">${esc(res)}</td><td class="r num${slow ? ' slow' : ''}">${x.ms >= 100 ? secs(x.ms) : ''}</td><td class="q-lsh">${x.shot ? `<button type="button" class="q-thumb" data-shot="${esc(x.shot)}" title="Xem màn hình"><img loading="lazy" decoding="async" src="${imgUrl(x.shot)}" alt=""></button>` : ''}</td></tr>`;
  }).join('');
  const tech = (t, a, f) => a?.length ? `<details class="q-det"><summary>${ico('next', 14, 'q-chev')}${t}<em>${a.length}</em></summary><ul>${a.slice(-30).map(f).join('')}</ul></details>` : '';
  const seg = [['all', 'Tất cả', L.length], ['bad', 'Lỗi', nBad], ['note', 'Phát hiện', nNote]].map(([k, l, n]) => `<button type="button" class="${ST.lf === k ? 'on' : ''}" data-lf="${k}">${l}<em>${n}</em></button>`).join('');
  const techs = tech('Lỗi JavaScript', M.pageerror, x => `<li>${esc(x.text)}</li>`) + tech('Lỗi console', M.console, x => `<li>${esc(x.text)}</li>`) + tech('HTTP lỗi', M.http, x => `<li><b>${x.status}</b> ${esc(x.method)} ${esc(x.url)}</li>`) + tech('Request hỏng', M.failed, x => `<li>${esc(x.err)} · ${esc(x.url)}</li>`) + tech('Request chậm (> 1,5 s)', M.slow, x => `<li><b>${secs(x.ms)}</b> ${esc(x.method)} ${esc(x.url)}</li>`) + tech('Tốc độ từng trang', M.navs, x => `<li>${esc(x.url)} · phản hồi ${x.ttfb} ms · DOM ${x.dcl} ms · tải ${x.load} ms · LCP ${x.lcp} ms · CLS ${x.cls} · ${x.size_kb ?? x.size ?? 0} KB</li>`);
  const tbl = body ? `<table class="q-tb q-ltb"><thead><tr><th>Lúc</th><th>Hành động</th><th>Kết quả</th><th class="r">Mất</th><th></th></tr></thead><tbody>${body}</tbody></table>` : `<div class="q-empty sm"><span>Không có bước nào</span></div>`;
  // cùng khung với tab Báo cáo: mỗi phần là 1 mục có đầu xám, bảng sát mép
  return `<div class="q-rep q-logw">${sec('Các bước đã chạy', tbl, rows.length, `<div class="q-seg sm">${seg}<span class="q-segcur"></span></div>`, 'flush')}${techs ? sec('Chi tiết kỹ thuật', `<div class="q-techs">${techs}</div>`) : ''}</div>`;
}
/* ---------- Xem ảnh từng bước: ←/→ chuyển bước, Esc đóng, ảnh kế bên tải sẵn ---------- */
const LB = { list: [], i: 0 };
function shots() { const L = ST.data?.state?.log || [], seen = new Set(), out = []; for (const x of L) if (x.shot && !seen.has(x.shot)) { seen.add(x.shot); out.push({ name: x.shot, label: x.label, n: x.n, ok: x.ok }); } return out; }
const imgUrl = n => `${API}?action=img&id=${ST.sel}&n=${encodeURIComponent(n)}`;
function lightbox(name) { LB.list = shots(); LB.i = Math.max(0, LB.list.findIndex(x => x.name === name)); if (!LB.list.length) LB.list = [{ name, label: '', n: '' }]; paintLb(); }
function paintLb() {
  const lb = $('#qLb'), x = LB.list[LB.i]; if (!lb || !x) return;
  lb.innerHTML = `<div class="q-lbw"><header><span class="num mut">${LB.i + 1} / ${LB.list.length}</span><b>${esc(x.label || '')}</b><span class="grow"></span><button type="button" class="btn ghost icon" data-a="lbp" title="Bước trước (←)"${LB.i ? '' : ' disabled'}>${ico('back', 16)}</button><button type="button" class="btn ghost icon" data-a="lbn" title="Bước sau (→)"${LB.i < LB.list.length - 1 ? '' : ' disabled'}>${ico('next', 16)}</button><button type="button" class="btn ghost icon" data-a="lbx" title="Đóng (Esc)">${ico('x', 16)}</button></header><div class="q-lbi">${ico('loader', 18, 'spin')}<img alt="" decoding="async"></div></div>`;
  lb.hidden = false;
  const img = lb.querySelector('img'); img.onload = () => img.classList.add('on'); img.src = imgUrl(x.name);
  for (const k of [LB.i - 1, LB.i + 1]) if (LB.list[k]) new Image().src = imgUrl(LB.list[k].name);
}
const lbClose = () => { const lb = $('#qLb'); if (lb) { lb.hidden = true; lb.innerHTML = ''; } };

/* ---------- Hộp xác nhận (không dùng confirm() của trình duyệt — bị chặn trong một số trình duyệt / khung nhúng) ---------- */
function confirmBox(title, msg, ok = 'Xoá') {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'q-ov';
    w.innerHTML = `<div class="q-modal" role="dialog" aria-modal="true"><b>${esc(title)}</b><p class="mut">${esc(msg)}</p><footer><button type="button" class="btn" data-c="0">Huỷ</button><button type="button" class="btn dg" data-c="1">${esc(ok)}</button></footer></div>`;
    const done = v => { w.remove(); document.removeEventListener('keydown', kd, true); res(v); };
    const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    w.onclick = e => { const c = e.target.closest('[data-c]'); if (c) done(c.dataset.c === '1'); else if (e.target === w) done(false); };
    document.addEventListener('keydown', kd, true); ROOT.append(w); w.querySelector('[data-c="1"]').focus();
  });
}
/** Đổi tên ngay trong danh sách: Enter / bấm ra ngoài để lưu, Esc để huỷ; để trống = về tên agent đặt. */
function renameRun(row) {
  if (!row || row.querySelector('.q-ren')) return;
  const id = row.dataset.id, r = ST.runs.find(x => x.id === id), b = row.querySelector('.q-hm b'); if (!b) return;
  const old = r?.title || hostOf(r?.url), inp = document.createElement('input');
  inp.className = 'in q-ren'; inp.value = old; inp.maxLength = 120; inp.setAttribute('aria-label', 'Tên lượt test'); b.replaceWith(inp); row.classList.add('editing');
  inp.focus(); inp.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true; const nm = inp.value.replace(/\s+/g, ' ').trim();
    if (!save || nm === old) { paintHist(); return; }
    if (r) r.title = nm || r.title; if (ST.data && ST.sel === id) ST.data.run.name = nm; paintHist(); if (ST.sel === id && ST.data) paintHead();
    try { await post('rename', { name: nm }, '&id=' + id); } catch (er) { toast(er.message); } loadList(); if (ST.sel === id) poll();
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  inp.onblur = () => finish(true); inp.onclick = e => e.stopPropagation(); inp.onpointerdown = e => e.stopPropagation();
}
async function delRun(id) {
  const r = ST.runs.find(x => x.id === id), name = r?.title || hostOf(r?.url) || 'lượt test';
  if (!(await confirmBox('Xoá lượt test?', `“${name}” — ảnh, nhật ký, trò chuyện và báo cáo sẽ bị xoá.`))) return;
  ST.runs = ST.runs.filter(x => x.id !== id); if (ST.sel === id) { stopStream(); clearTimeout(ST.poll); ST.sel = ''; ST.data = null; paintMain(); } paintHist();
  try { await post('delete', {}, '&id=' + id); } catch (er) { toast(er.message); } loadList();
}

/* ================= sự kiện ================= */
async function onClick(e) {
  const t = e.target;
  const rm = t.closest('[data-rm]'); if (rm) { ST.imgs.splice(+rm.dataset.rm, 1); paintForm(); return; }
  const dp = t.closest('[data-depth]'); if (dp) { ST.depth = dp.dataset.depth; paintForm(); return; }
  const ex = t.closest('[data-ex]'); if (ex) { const g = $('#qGoal'); if (g) { g.value = ex.dataset.ex; g.focus(); } return; }
  const rn = !t.closest('[data-a]') && t.closest('[data-run]'); if (rn) { ST.side = false; ROOT.querySelector('.q-app').classList.remove('side'); if (rn.dataset.run !== ST.sel) select(rn.dataset.run); return; }
  const tb = t.closest('[data-tab]'); if (tb) { ST.tab = tb.dataset.tab; paintMain(); return; }
  const lf = t.closest('[data-lf]'); if (lf) { ST.lf = lf.dataset.lf; paintMain(); return; }
  const qk = t.closest('[data-q]'); if (qk) { const k = qk.dataset.q; if (k === 'go') { await cmd({ type: 'continue' }); ST.ctrl = false; } else if (k === 'tab') { ST.tab = 'report'; paintMain(); } else sendSay(qk.dataset.t); clearTimeout(ST.poll); ST.poll = setTimeout(poll, 250); return; }
  if (t.id === 'qLb') { lbClose(); return; }
  const mo = t.closest('[data-more]'); if (mo) { ST.tab = 'live'; paintMain(); sendSay('Test thêm: ' + mo.dataset.more); return; }
  const a = t.closest('[data-a]')?.dataset.a;
  if (!a) return;
  const s = ST.data?.state;
  if (a === 'plan') { ST.planOpen = !$('#qPlan')?.classList.contains('open'); clearTimeout(ST.planTm); paintPlan(); return; }
  if (a === 'rerun') { const r = ST.data?.run; if (!r) return; const fd = new FormData(); fd.append('url', r.url); fd.append('goal', r.goal || ''); fd.append('max_steps', r.max_steps || 50); fd.append('minutes', r.minutes || 'auto'); try { const x = await post('start', fd); await loadList(); select(x.id); } catch (er) { toast(er.message); } return; }
  if (a === 'chat') { ST.nochat = !ST.nochat; lsSet('qa.nochat', ST.nochat ? '1' : ''); paintView(); if (!ST.nochat) { const f = $('#qFeed'); if (f) f.scrollTop = f.scrollHeight; } return; }
  if (a === 'zoom') { setZoom(!ST.zoom); return; }
  if (a === 'zm-' || a === 'zm+' || a === 'zm0') { zoomBy(a === 'zm-' ? -1 : a === 'zm+' ? 1 : 0); return; }
  if (a === 'side') { ST.side = !ST.side; ROOT.querySelector('.q-app').classList.toggle('side', ST.side); return; }
  if (a === 'new') { stopStream(); clearTimeout(ST.poll); ST.sel = ''; ST.data = null; paintHist(); paintMain(); }
  else if (a === 'pick') $('#qFile').click();
  else if (a === 'login') { ST.login = !ST.login; paintForm(); if (ST.login) $('#qUser').focus(); }
  else if (a === 'ctrl') {
    ST.ctrl = !ST.ctrl;
    if (ST.ctrl && s?.status === 'running') await cmd({ type: 'pause' });
    if (!ST.ctrl && s?.status === 'paused') await cmd({ type: 'continue' });
    paintMain(); if (ST.ctrl) { $('#qScreen')?.focus(); toast('Bấm, gõ, cuộn trên màn hình để tự thao tác', 1); }
    clearTimeout(ST.poll); ST.poll = setTimeout(poll, 300);
  }
  else if (a === 'go') { await cmd({ type: 'continue' }); ST.ctrl = false; clearTimeout(ST.poll); ST.poll = setTimeout(poll, 300); }
  else if (a === 'pause') { await cmd({ type: 'pause' }); clearTimeout(ST.poll); ST.poll = setTimeout(poll, 300); }
  else if (a === 'stop') { await cmd({ type: 'stop' }); toast(s?.status === 'idle' ? 'Đang đóng trình duyệt' : 'Đang dừng — agent viết báo cáo', 1); clearTimeout(ST.poll); ST.poll = setTimeout(poll, 300); }
  else if (a === 'del') delRun(ST.sel);
  else if (a === 'ren') { e.stopPropagation(); renameRun(t.closest('[data-id]')); }
  else if (a === 'delh') { e.stopPropagation(); delRun(t.closest('[data-id]').dataset.id); }
  else if (a === 'lbx') lbClose();
  else if (a === 'lbp' && LB.i > 0) { LB.i--; paintLb(); }
  else if (a === 'lbn' && LB.i < LB.list.length - 1) { LB.i++; paintLb(); }
}

/* ================= gắn vào HireX ================= */
export function mount(root) {
  ROOT = root; ON = new AbortController();
  document.addEventListener('keydown', e => { const lb = $('#qLb'); if (!lb || lb.hidden) return; if (e.key === 'Escape') lbClose(); else if (e.key === 'ArrowLeft' && LB.i > 0) { LB.i--; paintLb(); } else if (e.key === 'ArrowRight' && LB.i < LB.list.length - 1) { LB.i++; paintLb(); } }, { signal: ON.signal });
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; const t = e.target;
    const sh = t.closest('[data-shot]'); if (sh) { e.preventDefault(); lightbox(sh.dataset.shot); return; }
    const g = t.closest('[data-g]'); if (g) { e.preventDefault(); toggleFeed('g', g.dataset.g); return; }
    const tg = t.closest('[data-tg]'); if (tg) { e.preventDefault(); toggleFeed('x', tg.dataset.tg); }
  }, { signal: ON.signal });
  root.addEventListener('keydown', e => { const h = e.target.closest?.('.q-hi'); if (h && e.key === 'Enter') select(h.dataset.run); if (h && e.key === 'Delete') delRun(h.dataset.id); }, { signal: ON.signal });
  addEventListener('resize', () => segs(ROOT, true), { signal: ON.signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ST.zoom && $('#qLb')?.hidden !== false && !ROOT?.querySelector('.q-ov')) setZoom(false); }, { signal: ON.signal });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && ST.zoom) { ST.zoom = false; paintView(); } }, { signal: ON.signal });
  render(); loadList().then(() => { const r = ST.runs.find(x => WORKING.has(x.status) || x.status === 'waiting'); if (r) select(r.id); });
  const t = setInterval(() => { if (ST.runs.some(x => LIVE.has(x.status))) loadList(); }, 6000);
  ON.signal.addEventListener('abort', () => clearInterval(t));
  return () => { clearTimeout(ST.poll); stopStream(); ON?.abort(); ON = null; ROOT = null; };
}
