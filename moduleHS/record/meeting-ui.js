/* Cuộc họp (Meeting Hub trong HireX) — giao diện: ghi âm, dịch trực tiếp, đọc văn bản, lưu trữ, cài đặt, trang xem công khai.
   Giữ nguyên giao diện + hành vi của bản gốc (ui/index.html); khác bản gốc:
   - vẽ vào khung ROOT (.hs-rec) thay vì document.body; listener toàn cục gắn khi mount, gỡ khi rời trang (unmount);
   - gọi API /api/hs/record (đăng nhập HireX), link chia sẻ /m/<slug>, tải file /api/hs/record/d/<slug>/<loại>;
   - tải file ghi âm lên theo từng phần 16 MB; Zalo gửi bằng nick Zalo của HireX (Cài đặt › Zalo). */
const API = '/api/hs/record';
let ROOT = null;
const IC={
shrink:'<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
trash:'<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
x:'<path d="M18 6 6 18M6 6l12 12"/>',
check:'<path d="M20 6 9 17l-5-5"/>',
chevd:'<path d="m6 9 6 6 6-6"/>',
chevr:'<path d="m9 6 6 6-6 6"/>',
chevl:'<path d="m15 6-6 6 6 6"/>',
upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
external:'<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
more:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
note:'<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>',
music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
send:'<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
layers:'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
undo:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
eraser:'<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7M5 11l9 9"/>',
info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
alert:'<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/>',
inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
gear:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6"/>',
type:'<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
volume:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
archive:'<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
play:'<path d="M7 4.5v15l12-7.5z"/>',
sheet:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
fileup:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/>',
sparkle:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
book:'<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
star:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
loader:'<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
expand:'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
captions:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
clip:'<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'
};
/* ================= Lõi: tiện ích, API, lớp (popover / modal / toast) ================= */
const B = (typeof window !== 'undefined' && window.__HS_REC_BOOT) || {}, $ = s => ROOT?.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, sz = 16, cls = '') => `<svg class="i ${cls}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sz <= 14 ? 2 : 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.info}</svg>`;
const pad = n => String(n).padStart(2, '0');
const LS = { get(k, d = '') { try { return localStorage.getItem('mh.' + k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('mh.' + k, v); } catch { /* chế độ riêng tư */ } } };
const noMark = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => 'timeout')]);
const mb = b => (b / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: b >= 10485760 ? 0 : 1 }) + ' MB';
const hms = s => { s = Math.max(0, Math.floor(s)); return pad(s / 3600 | 0) + ':' + pad(s % 3600 / 60 | 0) + ':' + pad(s % 60); };
const dur = s => { s = Math.max(0, Math.round(s || 0)); const h = s / 3600 | 0; return h ? h + ':' + pad(s % 3600 / 60 | 0) + ':' + pad(s % 60) : (s / 60 | 0) + ':' + pad(s % 60); };
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dm = t => { const d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); };
const dmy = t => { const d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
const WD = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const dayLabel = t => { const d = new Date(t), n = new Date(), k = x => x.toDateString(); if (k(d) === k(n)) return 'Hôm nay'; n.setDate(n.getDate() - 1); if (k(d) === k(n)) return 'Hôm qua'; return WD[d.getDay()] + ', ' + dmy(d); };
const LANG = B.langs || { vi: 'Tiếng Việt', en: 'English', ja: '日本語' };
const LSHORT = { vi: 'VI', en: 'EN', ja: 'JA' };

const ERR = {
  busy: 'Bản ghi đang được xử lý', no_chunks: 'Không còn dữ liệu ghi trên máy chủ', missing_chunk: 'Thiếu đoạn ghi trên máy chủ', upload_file: 'Máy chủ không nhận được file',
  stale: 'Xử lý bị ngắt giữa chừng, hãy thử lại', timeout: 'Xử lý quá lâu, hãy thử lại', network: 'Mất kết nối máy chủ', no_ai_key: 'Chưa cấu hình OPENAI_API_KEY của HireX', openai: 'AI báo lỗi',
  ai_failed: 'AI chưa phản hồi', ai_empty: 'AI không trả kết quả', excel_json: 'AI trả bảng lỗi, hãy thử lại', word_json: 'AI trả kết quả lỗi, hãy thử lại', no_transcript: 'Không nhận ra lời nói',
  file_too_big: 'File quá lớn', unsupported: 'Định dạng chưa hỗ trợ', bad_template: 'Không đọc được file mẫu', bad_xlsx: 'Không đọc được file Excel', empty_text: 'Chưa có nội dung',
  admin_only: 'Chỉ Quản trị viên được đổi cài đặt này', text_too_long: 'Văn bản quá dài', bad_voice: 'Giọng đọc không hợp lệ', bad_style: 'Mẫu không còn tồn tại', bad_request: 'Thiếu thông tin', csrf: 'Phiên đã hết hạn, hãy tải lại trang',
  pdf_lib: 'Không tải được bộ đọc PDF', pdf_bad: 'Không đọc được PDF', pdf_empty: 'PDF không có chữ (bản scan)', tts_empty: 'Không tạo được giọng đọc', request_failed: 'Lỗi kết nối',
};
const errText = e => { const m = String(e?.message || e || ''); return ERR[m] || (m.startsWith('ffmpeg') ? 'Lỗi xử lý âm thanh (FFmpeg)' : m.startsWith('Lỗi') ? m : 'Lỗi kết nối, hãy thử lại'); };

/* ---------- API ---------- */
function form(fields) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields || {})) { if (v == null) continue; if (v && v.blob) f.append(k, v.blob, v.name); else if (v instanceof Blob) f.append(k, v, v.name || k); else f.append(k, String(v)); }
  return f;
}
async function req(action, body, ms = 60000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(API + '?action=' + action, { method: 'POST', body, signal: c.signal }), d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw Object.assign(new Error(d.stage || 'request_failed'), { detail: d.detail, status: r.status });
    return d;
  } catch (e) { if (e.name === 'AbortError' || e.name === 'TypeError') throw new Error('network'); throw e; } finally { clearTimeout(t); }
}
const post = (a, fields, ms) => req(a, form(fields), ms);
async function get(a, q = '') { const r = await fetch(API + '?action=' + a + q, { cache: 'no-store' }), d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.stage || 'request_failed'); return d; }
async function retry(fn, n = 6) { let last; for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { last = e; if (i < n - 1) await sleep(Math.min(12000, 700 * 1.7 ** i)); } } throw last; }

/* ---------- Ngăn xếp lớp: Esc đóng lớp trên cùng ---------- */
const LAY = [];
/** Listener toàn cục: gắn khi mount, gỡ khi rời trang. */
const ONS = [];
const on = (t, ev, fn, opt) => { ONS.push([t, ev, fn, opt]); };
const pushLay = o => { LAY.push(o); return o; };
const dropLay = o => { const i = LAY.indexOf(o); if (i >= 0) LAY.splice(i, 1); };
on(window, 'keydown', e => {
  if (e.key === 'Escape' && LAY.length) { e.preventDefault(); LAY.at(-1).close(); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && LAY.length && LAY.at(-1).submit) { e.preventDefault(); LAY.at(-1).submit(); }
});

/* ---------- Toast: lỗi + thông báo cần hành động ---------- */
function toast(msg, o = {}) {
  const box = $('#toast') || ROOT.appendChild(Object.assign(document.createElement('div'), { id: 'toast' }));
  const t = document.createElement('div'); t.className = 'toast' + (o.ok ? ' ok' : ''); t.setAttribute('role', o.ok ? 'status' : 'alert');
  t.innerHTML = `${ico(o.ok ? 'check' : 'alert', 16)}<span class="grow">${esc(msg)}</span>${o.action ? `<button class="btn sm">${esc(o.action.label)}</button>` : ''}<button class="btn x" title="Đóng">${ico('x', 14)}</button>`;
  const close = () => t.remove();
  t.querySelector('.x').onclick = close; if (o.action) t.querySelector('.btn.sm').onclick = () => { close(); o.action.fn(); };
  box.append(t); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(close, o.ms || (o.action ? 12000 : 6000)); return close;
}

/* tin gần nhất của nhóm: "5 phút", "3 giờ", "2 ngày", "12/10" */
function ago(iso) {
  const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return '';
  const m = Math.max(0, (Date.now() - t) / 60000);
  return m < 60 ? Math.round(m) + ' phút' : m < 1440 ? Math.round(m / 60) + ' giờ' : m < 10080 ? Math.round(m / 1440) + ' ngày' : new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
/* ---------- Popover menu (thay <select>) ---------- */
let MENU = null;
function menu(anchor, items, o = {}) {
  if (MENU) { const same = MENU.anchor === anchor; MENU.close(); if (same) return; }
  const p = document.createElement('div'); p.className = 'pop'; p.setAttribute('role', 'menu');
  p.innerHTML = (o.search ? `<div class="msrch">${ico('search', 14)}<input type="search" placeholder="${esc(o.search)}" aria-label="${esc(o.search)}"></div>` : '') + items.map((it, i) => it.sep ? '<div class="sep"></div>' : it.head ? `<div class="mh">${esc(it.head)}</div>`
    : `<button type="button" class="mi${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" data-i="${i}" role="menuitem"${it.disabled ? ' disabled' : ''}${it.title ? ` title="${esc(it.title)}"` : ''}>${it.icon ? ico(it.icon, 16) : ''}<span class="t">${esc(it.label)}</span>${it.em ? `<em>${esc(it.em)}</em>` : ''}${it.on ? `<span class="ck">${ico('check', 14)}</span>` : ''}</button>`).join('');
  ROOT.append(p);
  const r = anchor.getBoundingClientRect(), w = Math.max(o.w || 0, r.width, 200); p.style.minWidth = Math.min(w, innerWidth - 16) + 'px';
  const pw = p.offsetWidth, ph = p.offsetHeight; let x = o.right ? r.right - pw : r.left, y = r.bottom + 4;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4); x = Math.max(8, Math.min(x, innerWidth - pw - 8));
  p.style.left = x + 'px'; p.style.top = y + 'px';
  let btns = [...p.querySelectorAll('.mi:not(:disabled)')], hl = btns.findIndex(b => b.classList.contains('on'));
  const sIn = p.querySelector('.msrch input');
  if (sIn) sIn.oninput = () => {   // lọc theo tên, không phân biệt dấu
    const q = noMark(sIn.value.trim());
    p.querySelectorAll('.mi').forEach(b => { b.hidden = !!q && !noMark(b.textContent).includes(q); });
    btns = [...p.querySelectorAll('.mi:not(:disabled):not([hidden])')]; hl = -1; btns.forEach(b => b.classList.remove('hl'));
  };
  const L = pushLay({ anchor, close() { p.remove(); dropLay(L); removeEventListener('pointerdown', out, true); removeEventListener('keydown', key, true); if (MENU === L) MENU = null; anchor.setAttribute('aria-expanded', 'false'); } });
  const out = e => { if (!p.contains(e.target) && !anchor.contains(e.target)) L.close(); };
  const key = e => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && btns.length) { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle('hl', i === hl)); btns[hl]?.focus(); }
    else if (e.key === 'Enter' && sIn && document.activeElement === sIn && btns[0]) { e.preventDefault(); btns[0].click(); }
    else if (e.key === 'Tab') L.close();
  };
  p.onclick = e => { const b = e.target.closest('.mi'); if (!b) return; const it = items[+b.dataset.i]; L.close(); it.fn?.(); };
  addEventListener('pointerdown', out, true); addEventListener('keydown', key, true);
  anchor.setAttribute('aria-expanded', 'true'); MENU = L; (sIn || btns[hl] || btns[0])?.focus({ preventScroll: true });
  if (sIn && btns[hl]) btns[hl].scrollIntoView({ block: 'nearest' });
  return L;
}

/* ---------- Modal ---------- */
function modal(o) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}"><header>${o.icon ? `<span class="ti ${o.iconCls || ''}">${ico(o.icon, 16)}</span>` : ''}<h3>${esc(o.title)}</h3><span class="grow"></span><span class="hx" style="display:flex;align-items:center;gap:4px"></span>${o.max === false ? '' : `<button type="button" class="btn ghost icon sm" data-max title="Phóng to / thu nhỏ">${ico('expand', 15)}</button>`}<button type="button" class="btn ghost icon sm" data-x title="Đóng (Esc)">${ico('x', 16)}</button></header><div class="mbody"></div>${o.foot === false ? '' : '<footer></footer>'}</div>`;
  const m = ov.firstChild, M = { ov, m, body: m.querySelector('.mbody'), foot: m.querySelector('footer'), hx: m.querySelector('.hx'), h3: m.querySelector('h3'), submit: o.submit,
    close(force) { if (!force && o.beforeClose && o.beforeClose() === false) return; ov.remove(); dropLay(M); o.onClose?.(); } };
  m.querySelector('[data-x]').onclick = () => M.close();
  const mk = 'max.' + (o.cls || 'md').split(' ')[0], setMax = on => { m.classList.toggle('full', on); ov.classList.toggle('full', on); const b = m.querySelector('[data-max]'); if (b) b.innerHTML = ico(on ? 'shrink' : 'expand', 15); };
  m.querySelector('[data-max]')?.addEventListener('click', () => { const on = !m.classList.contains('full'); setMax(on); LS.set(mk, on ? '1' : ''); dispatchEvent(new Event('resize')); });
  m.querySelector('header').addEventListener('dblclick', e => { if (!e.target.closest('button,input')) m.querySelector('[data-max]')?.click(); });
  if (LS.get(mk) === '1') setMax(true);
  if (o.dismiss !== false) { let down = false; ov.addEventListener('pointerdown', e => { down = e.target === ov; }); ov.addEventListener('click', e => { if (down && e.target === ov) M.close(); }); }
  if (typeof o.body === 'string') M.body.innerHTML = o.body; else if (o.body) M.body.append(o.body);
  ROOT.append(ov); pushLay(M);
  const touch = matchMedia('(pointer:coarse)').matches;
  setTimeout(() => (m.querySelector('[autofocus]') || (touch ? null : m.querySelector('.mbody input,.mbody textarea')) || m.querySelector('footer .pri'))?.focus({ preventScroll: true }), 30);
  return M;
}
function confirmBox(title, msg, okLabel = 'Xóa', danger = true) {
  return new Promise(res => {
    let done = false; const M = modal({ cls: 'sm', max: false, icon: danger ? 'trash' : 'info', iconCls: danger ? 'rd' : '', title, body: `<p class="cmsg">${esc(msg)}</p>`, onClose: () => { if (!done) res(false); } });
    M.foot.innerHTML = `<span class="grow"></span><button class="btn" data-c="0">Hủy</button><button class="btn pri" data-c="1">${esc(okLabel)}</button>`;
    M.foot.onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; done = true; res(b.dataset.c === '1'); M.close(true); };
    M.submit = () => { done = true; res(true); M.close(true); };
    setTimeout(() => M.foot.querySelector('.pri').focus(), 40);
  });
}
/** Nút chọn giá trị kiểu combobox: hiển thị nhãn + chevron, mở menu khi bấm. */
const pickBtn = (cls, inner) => `<button type="button" class="in cb ${cls}" aria-haspopup="menu">${inner}<span class="grow"></span>${ico('chevd', 14)}</button>`;
/* ================= Lựa chọn: tên cuộc họp (AI đặt / tự đặt) · bản dịch =================
   Không còn Chủ đề / Mẫu / Từ vựng: máy chủ tự lấy ngữ cảnh (thành viên, màn hình, thuật ngữ) từ dữ liệu HireX như Soda. */
const S = { tab: LS.get('tab', 'rec') === 'tts' ? 'tts' : 'rec', st: 'idle', title: '', named: false, live: ['src', 'en', 'ja'].includes(LS.get('live', 'src')) ? LS.get('live', 'src') : 'src', nameMode: LS.get('nm', 'ai') === 'manual' ? 'manual' : 'ai', attn: 0, up: null };
/* Phụ đề trực tiếp: luôn bật mặc định (nghe tiếng Việt, tự sửa tên / thuật ngữ HireX); chỉ có 1 lựa chọn "Phụ đề: Hiện / Tắt" ở màn chính — tắt thì ẩn hẳn khung phụ đề. */
S.cap = LS.get('cap', '1') !== '0'; S.src = 'vi';

/* ================= Khung chính ================= */
function renderApp() {
  ROOT.innerHTML = `<div class="stage" id="stage"><main class="rc" id="rc">
  <header class="rc-h"><div class="seg" role="tablist" aria-label="Chế độ"><button type="button" data-a="tab" data-v="rec" role="tab">${ico('mic', 14)}Ghi âm</button><button type="button" data-a="tab" data-v="tts" role="tab">${ico('volume', 14)}Đọc văn bản</button></div>
   <span class="grow"></span><button type="button" class="btn ghost icon hb" data-a="arch" title="Lưu trữ">${ico('archive', 18)}<span class="bdg" id="bdg" hidden></span></button><button type="button" class="btn ghost icon hb" data-a="cfg" title="Cài đặt">${ico('gear', 18)}</button></header>
  <section class="rc-b" id="pRec">
   <input class="ttl" id="ttl" placeholder="Cuộc họp mới" maxlength="120" aria-label="Tên cuộc họp" autocomplete="off" title="Đặt tên (không bắt buộc, để trống AI tự đặt)">
   <div class="tm idle" id="tm" aria-label="Thời gian ghi">00:00:00</div>
   <div class="st" id="st" aria-live="polite"></div>
   <div class="wv"><canvas id="wv" aria-hidden="true"></canvas></div>
   <div class="ctl"><span class="slot"><button type="button" class="r2" id="bUp" data-a="upload" title="Tải file ghi âm (hoặc kéo thả vào đây)" aria-label="Tải file ghi âm">${ico('upload', 20)}</button><button type="button" class="r2" id="bDel" data-a="recDiscard" title="Hủy bản ghi" hidden>${ico('trash', 20)}</button></span><button type="button" class="recb" id="bRec" data-a="rec" title="Ghi âm (Space)" aria-label="Ghi âm"><i></i></button><button type="button" class="r2" id="bPause" data-a="pause" title="Tạm dừng" style="visibility:hidden">${ico('pause', 20)}</button></div>
   <div class="hint" id="hint"></div>
   <div class="opts" id="opts"></div>
  </section>
  <section class="rc-b" id="pTts" hidden></section>
 </main>
 <aside class="lp" id="live" aria-label="Phụ đề trực tiếp"><header class="lp-h"><span class="dot" id="liveDot"></span><b class="lpt">Phụ đề</b><span class="grow"></span><button type="button" class="btn ghost icon sm" data-a="liveClear" title="Xóa phụ đề">${ico('eraser', 15)}</button><button type="button" class="btn ghost icon sm" data-a="liveCopy" title="Sao chép">${ico('copy', 15)}</button><button type="button" class="btn ghost icon sm" data-a="liveBig" title="Phóng to / thu nhỏ">${ico('expand', 15)}</button></header><div class="lp-b" id="liveB"></div></aside>
 </div><div id="toast"></div><input type="file" id="fAudio" hidden accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac,.amr,.wma,.mp4,.webm,.mkv,.mov">`;
  $('#ttl').oninput = e => { S.title = e.target.value; S.named = !!e.target.value.trim(); };
  $('#ttl').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#fAudio').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pickAudio(f); };
  renderTab(); renderFoot(); renderOpts(); renderLive(); wvResize(); ttsInit();
}
function renderTab() {
  ROOT.querySelectorAll('[data-a=tab]').forEach(b => { const on = b.dataset.v === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#pRec').hidden = S.tab !== 'rec'; $('#pTts').hidden = S.tab !== 'tts'; ROOT.classList.toggle('tts', S.tab === 'tts'); if (S.tab === 'rec') wvResize();
}
/** Chỉ hiện tiến độ tải file lên; không có chữ hướng dẫn. */
function renderFoot() {
  const h = $('#hint'); if (!h) return;
  h.innerHTML = S.up ? `<div class="prog">${ico('upload', 14)}<span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.up.name)}</span><div class="bar" style="max-width:160px"><i style="width:${Math.round(S.up.p * 100)}%"></i></div><span class="num">${Math.round(S.up.p * 100)}%</span></div>` : '';
}
/** Tên đề xuất khi tự đặt: "dd-mm-yyyy Cuộc họp" (sửa được ngay trên ô tên). */
const suggestName = (t = Date.now()) => { const d = new Date(t); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} Cuộc họp`; };
/** Khối lựa chọn: Tên (AI đặt / tự đặt) + Bản dịch. Dùng chung cho màn chính và "Tạo lại". */
function optsHtml(F, live = true, name = false) {
  const row = (ic, l, inner) => `<div class="orow"><span class="oi" title="${l}">${ico(ic, 16)}</span><span class="ol">${l}</span>${inner}</div>`;
  return (name ? row('type', 'Tên', pickBtn('oName', `<span>${F.nameMode === 'manual' ? 'Tự đặt' : 'Theo nội dung cuộc họp'}</span>`)) : '')
   + (name ? row('captions', 'Phụ đề', pickBtn('oCap', `<span>${!S.cap ? 'Tắt' : CAPL[S.live]}</span>`)) : '')
   + (live ? row('globe', 'Dịch', `<div class="seg full oLive" role="radiogroup" aria-label="Bản dịch">${['', 'en', 'vi', 'ja'].map(k => `<button type="button" data-live="${k}" class="${F.live === k ? 'on' : ''}" role="radio" aria-checked="${F.live === k}">${k ? { en: 'EN', vi: 'VI', ja: 'JA' }[k] : 'Tắt'}</button>`).join('')}</div>`) : '');
}
/** Gắn sự kiện cho khối lựa chọn; F được sửa tại chỗ rồi gọi done(). */
function optsBind(box, F, done) {
  box.onclick = e => {
    const lb = e.target.closest('[data-live]'); if (lb) { F.live = lb.dataset.live; done(); return; }
    const b = e.target.closest('.cb'); if (!b) return;
    if (b.classList.contains('oCap')) { menu(b, [['src', 'captions'], ['en', 'globe'], ['ja', 'globe']].map(([k, ic]) => ({ label: CAPL[k], icon: ic, on: S.cap && S.live === k, fn: () => setCap(true, k) })).concat([{ label: 'Tắt', icon: 'x', on: !S.cap, fn: () => setCap(false) }])); return; }
    if (b.classList.contains('oName')) menu(b, [{ label: 'Theo nội dung cuộc họp', icon: 'sparkle', em: 'AI', on: F.nameMode !== 'manual', fn: () => { F.nameMode = 'ai'; done(); } }, { label: 'Tự đặt', icon: 'edit', on: F.nameMode === 'manual', fn: () => { F.nameMode = 'manual'; done(); setTimeout(() => $('#ttl')?.focus(), 50); } }]);
  };
}
function renderOpts() {
  const el = $('#opts'); if (!el) return;
  const F = { nameMode: S.nameMode };
  el.innerHTML = optsHtml(F, false, true);
  optsBind(el, F, () => { if (F.nameMode !== S.nameMode) S.named = false; S.nameMode = F.nameMode; LS.set('nm', S.nameMode); renderOpts(); });
  const ti = $('#ttl'); if (ti) { const ai = S.nameMode !== 'manual'; ti.hidden = ai; ti.placeholder = 'Đặt tên cuộc họp'; if (ai) { S.title = ''; ti.value = ''; } else if (!S.named && S.st === 'idle') { S.title = suggestName(); ti.value = S.title; } }
}
const ACT = {};
on(document, 'click', e => { if (!ROOT?.contains(e.target)) return; const b = e.target.closest('[data-a]'); if (b && ACT[b.dataset.a] && !b.disabled) ACT[b.dataset.a](b, e); });
ACT.tab = b => { S.tab = b.dataset.v; LS.set('tab', S.tab); renderTab(); };
ACT.arch = () => openArchive();
ACT.cfg = () => openCfg();
ACT.upload = () => $('#fAudio').click();
const meetOpts = () => { const t = S.title.trim(); return { set: 1, title: t, auto: !t, live: '' }; };

/* ================= Bản sao từng đoạn trên máy (IndexedDB) ================= */
const DB = {
  _p: null,
  open() {
    if (this._p) return this._p;
    const p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('noidb'));
      const r = indexedDB.open('meeting-rec', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('chunks', { keyPath: ['sid', 'i'] }); r.result.createObjectStore('sessions', { keyPath: 'sid' }); };
      r.onsuccess = () => { const d = r.result; d.onclose = () => { this._p = null; }; d.onversionchange = () => { d.close(); this._p = null; }; res(d); };
      r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('idb_blocked'));
    });
    this._p = p; p.catch(() => { if (this._p === p) this._p = null; }); return p;
  },
  async tx(store, mode, fn) {
    const run = (async () => { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); let rq; try { rq = fn(t.objectStore(store)); } catch (e) { return rej(e); } t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); })();
    let to; const lim = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('idb_timeout')), 10000); });
    try { return await Promise.race([run, lim]); } finally { clearTimeout(to); }
  },
  putChunk(sid, i, blob) { return this.tx('chunks', 'readwrite', s => s.put({ sid, i, blob, t: Date.now() })); },
  getSession(sid) { return this.tx('sessions', 'readonly', s => s.get(sid)); },
  putSession(o) { return this.tx('sessions', 'readwrite', s => s.put(o)); },
  async patchSession(sid, p) { const o = (await this.getSession(sid)) || { sid }; return this.putSession({ ...o, ...p }); },
  sessions() { return this.tx('sessions', 'readonly', s => s.getAll()); },
  async chunks(sid) { const a = await this.tx('chunks', 'readonly', s => s.getAll(IDBKeyRange.bound([sid, 0], [sid, Infinity]))); return a.sort((x, y) => x.i - y.i); },
  async drop(sid) { await this.tx('chunks', 'readwrite', s => s.delete(IDBKeyRange.bound([sid, 0], [sid, Infinity]))); await this.tx('sessions', 'readwrite', s => s.delete(sid)); },
};
try { navigator.storage?.persist?.(); } catch { /* không hỗ trợ */ }

/* ---------- Hàng đợi tải lên: 2 luồng, timeout, tự thử lại ---------- */
const ups = new Map();
const upOf = sid => { let u = ups.get(sid); if (!u) { u = { todo: new Map(), failed: new Map(), run: 0, warned: false, sent: 0 }; ups.set(sid, u); } return u; };
const upBusy = sid => { const u = ups.get(sid); return !!u && (u.run > 0 || u.todo.size > 0); };
const uploadChunk = (sid, blob, i) => post('chunk', { session_id: sid, index: i, chunk: { blob, name: `chunk-${i}.part` } }, 45000);
function upEnqueue(sid, i, blob) { upOf(sid).todo.set(i, blob); upPump(sid); }
function upPump(sid) {
  const u = upOf(sid);
  while (u.run < 2 && u.todo.size) {
    const [i, blob] = u.todo.entries().next().value; u.todo.delete(i); u.run++;
    (async () => {
      let ok = false;
      for (let a = 0; a < 4 && !ok; a++) { try { await uploadChunk(sid, blob, i); ok = true; } catch { await sleep(Math.min(8000, 600 * 2 ** a)); } }
      if (ok) { u.sent++; if (sid === R.sid) renderStatus(); }
      else { u.failed.set(i, blob); if (!u.warned) { u.warned = true; toast('Mất kết nối máy chủ. Bản ghi vẫn lưu trên máy và sẽ tự gửi lại.'); } }
      u.run--; upPump(sid);
    })();
  }
}
function upRetryFailed() { for (const [sid, u] of ups) if (u.failed.size) { for (const [i, b] of u.failed) u.todo.set(i, b); u.failed.clear(); upPump(sid); } }
on(window, 'online', upRetryFailed);
async function upDrain(sid, ms) { const t = Date.now(); while (upBusy(sid) && Date.now() - t < ms) await sleep(200); return !upBusy(sid); }

/* ================= Ghi âm ================= */
const R = { sid: null, stream: null, rec: null, ctx: null, an: null, buf: null, i: 0, acc: 0, seg: 0, t0: 0, timer: 0, wd: 0, last: 0, wl: null, mime: '' };
const elapsed = () => (R.acc + (S.st === 'rec' ? performance.now() - R.seg : 0)) / 1000;
function setSt(st) {
  S.st = st; const rec = st === 'rec' || st === 'paused', b = $('#bRec');
  b.classList.toggle('on', rec); b.disabled = st === 'starting' || st === 'stopping'; b.title = rec ? 'Dừng và tạo biên bản (Space)' : 'Ghi âm (Space)'; b.setAttribute('aria-label', rec ? 'Dừng' : 'Ghi âm');
  $('#bDel').hidden = !rec; $('#bUp').hidden = rec; $('#bUp').disabled = !!S.up || st !== 'idle'; $('#bPause').style.visibility = rec ? 'visible' : 'hidden';
  $('#bPause').innerHTML = ico(st === 'paused' ? 'play' : 'pause', 20); $('#bPause').title = st === 'paused' ? 'Tiếp tục' : 'Tạm dừng'; $('#bPause').classList.toggle('on', st === 'paused');
  $('#tm').classList.toggle('idle', !rec); $('#pRec').classList.toggle('on', rec); wvResize(); renderStatus(); renderFoot(); renderLive(); wvDraw();
}
function renderStatus(msg) {
  const el = $('#st'); if (!el) return; el.classList.toggle('err', !!msg);
  if (msg) { el.innerHTML = ico('alert', 14) + esc(msg); return; }
  if (S.st === 'rec' || S.st === 'paused') { const u = ups.get(R.sid), pend = u ? u.todo.size + u.run + u.failed.size : 0; el.innerHTML = `<span class="dot ${S.st === 'rec' ? 'rec pulse' : ''}"></span>${S.st === 'paused' ? 'Tạm dừng' : 'Đang ghi'}${pend > 2 ? ' · chờ gửi ' + pend : ''}`; }
  else el.innerHTML = S.st === 'starting' || S.st === 'stopping' ? ico('loader', 14, 'spin') : '';
}
function tick() { $('#tm').textContent = hms(elapsed()); }
async function wake() { try { if (!('wakeLock' in navigator) || R.wl || S.st !== 'rec') return; R.wl = await navigator.wakeLock.request('screen'); R.wl.addEventListener('release', () => { R.wl = null; }); } catch { R.wl = null; } }
function unwake() { try { R.wl?.release(); } catch { /* đã nhả */ } R.wl = null; }
function flushNow() { try { if (R.rec && R.rec.state !== 'inactive') R.rec.requestData(); } catch { /* bỏ qua */ } }
on(window, 'pagehide', flushNow); on(window, 'beforeunload', e => { flushNow(); if (S.st === 'rec' || S.st === 'paused') { e.preventDefault(); e.returnValue = ''; } });
on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); else wake(); });
function teardown() {
  clearInterval(R.timer); clearInterval(R.wd); unwake(); liveStop();
  R.stream?.getTracks().forEach(t => t.stop()); R.stream = null; R.ctx?.close().catch(() => {}); R.ctx = null; R.an = null;
}
const createSession = (o) => post('create', { title: o.title || 'Cuộc họp', auto_title: o.auto ? '1' : '0', live_lang: ['vi', 'en', 'ja'].includes(o.live) ? o.live : '' });
async function startRecording() {
  if (S.st !== 'idle') return;
  setSt('starting'); renderStatus();
  try {
    R.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const title = S.title.trim(), o = { title, auto: !title, live: '' };
    const sid = (await createSession(o)).session_id; R.sid = sid; R.i = 0;
    DB.putSession({ sid, title: title || 'Cuộc họp', auto: o.auto, live: o.live, at: Date.now(), status: 'recording', count: 0 }).catch(er => console.error('idb', er));
    R.mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    R.rec = new MediaRecorder(R.stream, R.mime ? { mimeType: R.mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    let idbWarn = false;
    R.rec.ondataavailable = e => {
      if (!e.data?.size) return; R.last = Date.now(); const i = R.i++, blob = e.data;
      DB.putChunk(sid, i, blob).catch(er => { console.error('idb', er); if (!idbWarn) { idbWarn = true; toast('Không lưu được bản sao trên máy. Dữ liệu vẫn đang gửi lên máy chủ.'); } });
      upEnqueue(sid, i, blob); renderStatus();
    };
    R.rec.onerror = () => toast('Lỗi ghi âm. Phần đã ghi vẫn được giữ.');
    R.stream.getAudioTracks().forEach(t => { t.onended = () => { if (S.st === 'rec' || S.st === 'paused') { toast('Micro bị ngắt. Đã lưu phần đã ghi.'); stopRecording(); } }; });
    R.rec.start(B.slice || 5000);
    try { R.ctx = new AudioContext({ sampleRate: 24000 }); } catch { R.ctx = new (window.AudioContext || window.webkitAudioContext)(); } R.an = R.ctx.createAnalyser(); R.an.fftSize = 1024; R.an.smoothingTimeConstant = .5;
    R.ctx.createMediaStreamSource(R.stream).connect(R.an); R.buf = new Uint8Array(R.an.fftSize);
    R.acc = 0; R.seg = performance.now(); R.t0 = Date.now(); WV.lv = []; LV.lines.clear(); LV.dom.clear(); LV.seq = 0; RT.ids.clear(); RT.q = []; RT.open = null;
    R.timer = setInterval(tick, 250); tick();
    clearInterval(R.wd); R.last = Date.now(); let stallWarn = false;
    R.wd = setInterval(() => { if (R.rec?.state !== 'recording') return; if (Date.now() - R.last > (B.slice || 5000) * 3 + 5000) { flushNow(); if (!stallWarn) { stallWarn = true; renderStatus('Ghi âm có dấu hiệu bị đứng'); } } }, 5000);
    setSt('rec'); wvLoop(); wake(); liveToggle();
  } catch (e) {
    console.error(e); teardown(); R.rec = null; R.sid = null; setSt('idle');
    const n = e?.name;
    toast(n === 'NotAllowedError' || n === 'SecurityError' ? 'Chưa cấp quyền micro cho trang này' : n === 'NotFoundError' ? 'Không tìm thấy micro' : !navigator.mediaDevices ? 'Micro chỉ chạy trên HTTPS hoặc localhost' : 'Không thể ghi âm: ' + errText(e));
  }
}
function togglePause() {
  if (!R.rec) return;
  if (R.rec.state === 'recording') { R.rec.pause(); R.acc += performance.now() - R.seg; setSt('paused'); liveStop(); tick(); }
  else if (R.rec.state === 'paused') { R.rec.resume(); R.seg = performance.now(); setSt('rec'); wvLoop(); wake(); liveToggle(); }
}
/** Dừng ghi: chờ MediaRecorder nhả đoạn cuối, lưu số đoạn, rồi mở hộp thoại tạo biên bản. */
async function stopRecording(discard) {
  if (!R.rec || S.st === 'stopping') return;
  const rc = R.rec, sid = R.sid, secs = elapsed(), t1 = Date.now(), opts = meetOpts(), title = opts.title;
  setSt('stopping'); let count = 0;
  try {
    const stopped = new Promise(r => rc.addEventListener('stop', r, { once: true }));
    try { if (rc.state !== 'inactive') rc.stop(); } catch (e) { console.error(e); }
    await withTimeout(stopped, 4000); teardown(); await sleep(250); count = R.i;
    if (count > 0) await withTimeout(DB.patchSession(sid, { status: 'stopped', count, dur: secs, title: title || 'Cuộc họp', end: t1 }).catch(() => {}), 3000);
  } catch (e) { console.error(e); teardown(); count = Math.max(count, R.i); }
  R.rec = null; R.sid = null; R.t0 = 0; $('#tm').textContent = '00:00:00'; WV.lv = []; S.named = false; setSt('idle'); renderOpts();
  if (discard) { await dropRecording(sid); return; }
  if (count < 1) { toast('Chưa có dữ liệu ghi âm'); return; }
  syncSession(sid, opts); setTimeout(() => loadArch(true), 800);
}
async function dropRecording(sid) { try { await upDrain(sid, 4000); await post('delete', { session_id: sid }).catch(() => {}); await DB.drop(sid).catch(() => {}); ups.delete(sid); } catch (e) { console.error(e); } loadArch(true); }
ACT.rec = () => (S.st === 'rec' || S.st === 'paused') ? stopRecording() : startRecording();
ACT.pause = () => togglePause();
ACT.recDiscard = async () => { if (!(S.st === 'rec' || S.st === 'paused')) return; if (await confirmBox('Hủy bản ghi?', `Bản ghi ${hms(elapsed())} sẽ bị xóa, không thể khôi phục.`, 'Hủy bản ghi')) stopRecording(true); };
on(window, 'keydown', e => {
  if (e.code !== 'Space' || LAY.length || S.tab !== 'rec' || e.repeat || !ROOT?.offsetParent) return;
  const t = e.target; if (t.closest('input,textarea,button,[contenteditable],a')) return;
  e.preventDefault(); ACT.rec();
});

/* ---------- Sóng âm kiểu Voice Memos: cột tròn đầu cuộn trái, đầu ghi đỏ ---------- */
const WV = { lv: [], raf: 0, t: 0, peak: 0, colors: null };
function wvResize() { const c = $('#wv'); if (!c) return; const r = c.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return; c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); WV.colors = null; wvDraw(); }
on(window, 'resize', () => wvResize());
function wvDraw() {
  const c = $('#wv'); if (!c || !c.width) return; const g = c.getContext('2d'), d = devicePixelRatio || 1, W = c.width, H = c.height, mid = H / 2;
  if (!WV.colors) { const cs = getComputedStyle(ROOT); WV.colors = { rec: cs.getPropertyValue('--ui-rec').trim(), dim: cs.getPropertyValue('--ui-edge').trim(), none: cs.getPropertyValue('--ui-none').trim() }; }
  const C = WV.colors, step = 5 * d, bw = 2.5 * d, live = S.st === 'rec' || S.st === 'paused';
  g.clearRect(0, 0, W, H);
  const px = live ? Math.min(W * .62, Math.max(step, WV.lv.length * step)) : 0;
  g.fillStyle = C.none; for (let x = px + step; x < W; x += step) { g.beginPath(); g.arc(x, mid, 1.1 * d, 0, 7); g.fill(); }
  if (!live) return;
  g.fillStyle = S.st === 'paused' ? C.dim : C.rec; g.lineCap = 'round';
  for (let i = 0, x = px - step; x > -step && i < WV.lv.length; i++, x -= step) {
    const h = Math.max(3 * d, Math.min(H - 8 * d, WV.lv[WV.lv.length - 1 - i] * H * .92)), r = bw / 2;
    g.beginPath(); g.roundRect ? g.roundRect(x - r, mid - h / 2, bw, h, r) : g.rect(x - r, mid - h / 2, bw, h); g.fill();
  }
  g.fillStyle = C.rec; g.fillRect(px - d, 4 * d, 2 * d, H - 8 * d); g.beginPath(); g.arc(px, 5 * d, 3.5 * d, 0, 7); g.fill();
}
function wvLoop() {
  cancelAnimationFrame(WV.raf);
  const f = t => {
    if (S.st !== 'rec' || !R.an) { wvDraw(); return; }
    R.an.getByteTimeDomainData(R.buf); let sum = 0; for (const v of R.buf) { const x = (v - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / R.buf.length); WV.peak = Math.max(WV.peak, rms); LV.peak = Math.max(LV.peak, rms);
    if (t - WV.t > 90) { WV.t = t; WV.lv.push(Math.min(1, Math.pow(WV.peak * 3.2, .8))); WV.peak = 0; if (WV.lv.length > 600) WV.lv.splice(0, 200); wvDraw(); }
    WV.raf = requestAnimationFrame(f);
  };
  WV.raf = requestAnimationFrame(f);
}

/* ================= Phụ đề trực tiếp (miễn phí, một chế độ duy nhất) =================
   Trình duyệt nghe (Chrome / Edge — Web Speech API, kèm danh sách cụm từ HireX để nghe đúng hơn nếu trình duyệt hỗ trợ) → chữ hiện ngay khi nói.
   Câu chốt → máy chủ sửa tên / thuật ngữ theo từ điển học từ toàn bộ dữ liệu HireX (live_tr) → dịch bằng Google (miễn phí) nếu chọn VI / EN / JA.
   Không gọi OpenAI khi đang họp. Bản ghi âm đầy đủ vẫn phiên âm lại bằng OpenAI sau cuộc họp, có ưu tiên các thuật ngữ phụ đề đã nghe thấy. */
const LV = { lines: new Map(), seq: 0, dom: new Map(), big: false };
const RT = { sid: '', ids: new Map(), q: [], open: null };
/** Ngôn ngữ cần dịch sang ('' = chỉ hiện lời gốc). */
const target = () => S.live === 'src' ? '' : S.live;
const normLn = s => noMark(s).replace(/[^\p{L}\p{N}]+/gu, '');
const newLine = () => { const k = LV.seq++, l = { k, text: '', tr: {}, part: 1, t: elapsed(), wtr: 0 }; LV.lines.set(k, l); return l; };
const dropLine = l => { if (!l) return; LV.lines.delete(l.k); if (l.req) l.req.abort(); renderLive(); };
function liveToggle() {
  const want = S.cap && S.live && S.st === 'rec' && R.stream;
  if (want) wsStart(); else wsStop();
  renderLive();
}
/* ---------- Miễn phí: nhận giọng của trình duyệt (Chrome / Edge, Web Speech API) → chữ ngay khi nói; câu chốt → Google Dịch ----------
   Chỉ nghe 1 ngôn ngữ một lúc (chọn ở nút "VI / EN / JA" trên đầu khung). Bản ghi âm đầy đủ vẫn phiên âm lại bằng OpenAI sau cuộc họp. */
const SRC_LANG = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' };
const WSR = { rec: null, tm: 0, map: new Map(), warned: false, deny: false, noBias: false, net: 0, ph: null, phSid: '' };
/** Cụm từ HireX (tên người, khách hàng, thuật ngữ…) cho bộ nghe của trình duyệt — chỉ khi trình duyệt có SpeechRecognitionPhrase. */
async function loadPhrases() {
  if (typeof window.SpeechRecognitionPhrase !== 'function' || WSR.noBias) return;
  if (WSR.ph && WSR.phSid === R.sid) return; WSR.phSid = R.sid;
  try { const d = await get('lex_phrases', '&session_id=' + encodeURIComponent(R.sid || '')); WSR.ph = (d.phrases || []).map(x => { try { return new window.SpeechRecognitionPhrase(x.p, Math.min(10, Math.max(0.1, +x.b || 1))); } catch { return null; } }).filter(Boolean); } catch { WSR.ph = []; }
}
function bias(r) { if (WSR.noBias || !WSR.ph?.length) return; try { r.phrases = WSR.ph; } catch { WSR.noBias = true; } }
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
function wsStart() {
  if (WSR.rec || WSR.deny) return;
  if (!WSR.ph && typeof window.SpeechRecognitionPhrase === 'function' && !WSR.noBias) { WSR.ph = []; loadPhrases().finally(() => { if (WSR.rec && WSR.ph?.length) { wsStop(); liveToggle(); } }); }
  if (!SpeechRec) { if (!WSR.warned) { WSR.warned = true; toast('Trình duyệt này chưa có nhận giọng nói miễn phí — dùng Chrome hoặc Edge để xem phụ đề'); } return; }
  const r = new SpeechRec(); r.lang = SRC_LANG[S.src] || 'vi-VN'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  bias(r);
  WSR.map = new Map();
  const fin = l => { l.part = 0; l.done = 1; l.text = l.text.trim(); if (!l.text) { dropLine(l); return; } rtTranslate(l); };
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], txt = String(res[0]?.transcript || '');
      let l = WSR.map.get(i); if (!l) { if (!txt.trim()) continue; l = newLine(); WSR.map.set(i, l); }
      if (l.done) continue;
      l.text = txt; l.part = res.isFinal ? 0 : 1;
      if (res.isFinal) fin(l);
    }
    renderLive();
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { WSR.deny = true; toast('Trình duyệt chặn nhận giọng nói — kiểm tra quyền micro'); }
    else if (e.error === 'phrases-not-supported') WSR.noBias = true;                       // trình duyệt chưa nhận danh sách cụm từ: nghe lại không kèm
    else if (e.error === 'network') WSR.net = (WSR.net || 0) + 1;
  };
  r.onend = () => {
    if (WSR.rec !== r) return; WSR.rec = null;
    for (const l of WSR.map.values()) if (!l.done && l.text) fin(l);
    if (S.cap && S.live && S.st === 'rec' && R.stream && !WSR.deny) WSR.tm = setTimeout(wsStart, WSR.net > 3 ? 2000 : 200);   // trình duyệt tự ngắt sau một lúc im lặng → nghe tiếp
    renderLive();
  };
  WSR.rec = r; try { r.start(); } catch { WSR.rec = null; }
}
function wsStop() {
  if (R.sid) RT.sid = R.sid; clearTimeout(WSR.tm); const r = WSR.rec; WSR.rec = null;
  if (r) { r.onend = null; r.onresult = null; try { r.stop(); } catch { /* đã dừng */ } }
  for (const l of WSR.map.values()) if (!l.done && l.text) { l.part = 0; l.done = 1; rtTranslate(l); } else if (!l.done) dropLine(l);
  WSR.map = new Map();
}
/** Phụ đề: Hiện / Tắt (combobox ở màn chính). Tắt = dừng nghe + ẩn hẳn khung phụ đề. */
/** Phụ đề: Lời gốc / Dịch sang English / Dịch sang 日本語 (Google Dịch, miễn phí) / Tắt. Đổi ngôn ngữ giữa chừng thì dịch bù các câu đã có. */
const CAPL = { src: 'Lời gốc (tiếng Việt)', en: 'Lời gốc + dịch English', ja: 'Lời gốc + dịch 日本語' };
function setCap(on, lang = S.live) { S.cap = on; S.live = lang; LS.set('cap', on ? '1' : '0'); LS.set('live', lang); ROOT.classList.toggle('nocap', !on); renderOpts(); liveToggle(); if (on) liveFill(); }
async function liveFill() {
  const to = target(); if (!to) { renderLive(); return; }
  const todo = [...LV.lines.values()].filter(l => l.text && !l.part && !l.req && !l.tr[to]).sort((a, b) => b.k - a.k).slice(0, 40);
  const run = async () => { let l; while ((l = todo.shift())) { if (target() !== to) return; if (!l.tr[to] && !l.req) await rtTranslate(l, to); } };
  await Promise.all([run(), run()]);
}
/** Dịch một dòng (stream từng chữ). Gọi lại khi câu chốt khác bản tạm, hoặc khi đổi tab ngôn ngữ. */
async function rtTranslate(l, to = target()) {
  const text = l.text.trim(); if (!text) return;
  if (l.req) l.req.abort(); const c = new AbortController(); l.req = c; l.sent = text; l.wtr = to ? 1 : 0; if (to) l.tr[to] = '';
  const ctx = to ? [...LV.lines.values()].filter(x => x.k < l.k && x.tr[to]).slice(-2).map(x => x.tr[to]).join('\n') : '';
  renderLive();
  try {
    const r = await fetch(API + '?action=live_tr', { method: 'POST', body: form({ session_id: R.sid || RT.sid, k: l.k, text, lang: to, ctx, fin: l.done ? '1' : '0' }), signal: c.signal });
    if (!r.ok) throw new Error('live_tr'); const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', head = null, out = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      if (!head) { const i = buf.indexOf('\n'); if (i < 0) continue; try { head = JSON.parse(buf.slice(0, i)); } catch { head = {}; } buf = buf.slice(i + 1); if (!head.text) { dropLine(l); return; } l.text = head.text; }
      if (buf) { out += buf; buf = ''; if (to) l.tr[to] = out.trimStart(); }
      renderLive();
    }
    if (to) l.tr[to] = out.trim();
  } catch (e) { if (e.name !== 'AbortError') console.warn('Dịch trực tiếp:', e.message); }
  finally { if (l.req === c) { l.req = null; l.wtr = 0; } renderLive(); }
}
function liveStop() { wsStop(); }
/* ---------- Hiển thị: mới nhất ở trên; chỉ cập nhật dòng thay đổi (stream từng chữ không vẽ lại cả khung) ---------- */
function lineHtml(l) {
  const to = target(), tr = to ? (l.tr[to] || '') : '', t = `<span class="lt num">${hms(l.t || 0).slice(3)}</span>`;
  if (l.wait || (!l.text && l.part)) return `${t}<div><div class="tr">${ico('loader', 14, 'spin')}</div></div>`;
  // lời gốc ở trên (chữ chính), bản dịch thêm ở dưới (khi chọn dịch EN / JA)
  const same = tr && normLn(tr) === normLn(l.text), sub = tr && !same ? esc(tr) : (l.wtr && to ? ico('loader', 12, 'spin') : '');
  return `${t}<div><div class="tr">${esc(l.text)}${l.part ? '<i class="caret"></i>' : ''}</div>${sub ? `<div class="or tl">${sub}</div>` : ''}</div>`;
}
function renderLive() {
  const box = $('#live'); if (!box) return; box.classList.toggle('big', LV.big);
  $('#liveDot').className = 'dot ' + (!S.cap ? '' : S.st === 'rec' ? (WSR.rec ? 'rec' : 'rec pulse') : S.st === 'paused' ? 'warn' : '');
  ROOT.classList.toggle('nocap', !S.cap);
  if (!S.cap) { const bb = $('#liveB'); if (bb.dataset.e !== 'off') { bb.innerHTML = `<div class="live-e">${ico('captions', 30)}<span>Phụ đề đang tắt</span></div>`; bb.dataset.e = 'off'; LV.dom.clear(); } return; }
  if ($('#liveB').dataset.e === 'off') { $('#liveB').innerHTML = ''; $('#liveB').dataset.e = ''; }
  const b = $('#liveB'), ks = [...LV.lines.keys()].sort((a, c) => c - a).slice(0, 200), keep = new Set(ks);
  if (!ks.length) { if (b.dataset.e !== '1') { b.innerHTML = `<div class="live-e">${ico('captions', 30)}</div>`; b.dataset.e = '1'; LV.dom.clear(); } return; }
  if (b.dataset.e === '1') { b.innerHTML = ''; b.dataset.e = ''; }
  for (const [k, el] of LV.dom) if (!keep.has(k)) { el.remove(); LV.dom.delete(k); }
  ks.forEach((k, i) => {
    const l = LV.lines.get(k); let el = LV.dom.get(k);
    if (!el) { el = document.createElement('div'); el.className = 'ln ln-in'; el._sig = ''; el.addEventListener('animationend', () => el.classList.remove('ln-in'), { once: true }); LV.dom.set(k, el); }
    const sig = lineHtml(l); if (el._sig !== sig) { el.innerHTML = sig; el._sig = sig; }
    el.classList.toggle('part', !!l.part); el.classList.toggle('fixing', !!l.fixing); el.classList.toggle('wait', !!(l.wait || (!l.text && l.part)));
    if (b.children[i] !== el) b.insertBefore(el, b.children[i] || null);
  });
}
ACT.liveClear = () => { for (const l of LV.lines.values()) l.req?.abort(); LV.lines.clear(); LV.dom.clear(); WSR.map = new Map(); renderLive(); };
ACT.liveBig = async () => {
  const el = $('#live');
  if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
  try { await el.requestFullscreen({ navigationUI: 'hide' }); } catch { LV.big = !LV.big; renderLive(); }
};
on(document, 'fullscreenchange', () => { LV.big = document.fullscreenElement === $('#live'); renderLive(); const b = $('[data-a=liveBig]'); if (b) b.innerHTML = ico(LV.big ? 'shrink' : 'expand', 15); });
ACT.liveCopy = async () => { const to = target(), t = [...LV.lines.keys()].sort((a, b) => a - b).map(k => LV.lines.get(k)).filter(l => !l.wait && l.text).map(l => { const tr = to && l.tr[to]; return tr ? tr + '\n' + l.text : l.text; }).join('\n\n'); try { await navigator.clipboard.writeText(t); toast('Đã sao chép', { ok: 1, ms: 2000 }); } catch { toast('Không sao chép được'); } };

/* ================= "Tạo lại" từ Lưu trữ: cùng 3 lựa chọn như màn chính ================= */
function redoDialog(x) {
  const F = { live: ['vi', 'en', 'ja'].includes(x.live_lang) ? x.live_lang : '', title: x.title };
  const M = modal({ icon: 'refresh', title: x.status === 'done' ? 'Tạo lại biên bản' : 'Tạo biên bản', submit: () => go() });
  const paint = () => { M.body.innerHTML = `<div class="fld"><label for="rT">Tên</label><input class="in" id="rT" maxlength="120" placeholder="Để trống, AI tự đặt" value="${esc(F.title)}" autocomplete="off"></div><div class="opts" style="margin-top:16px">${optsHtml(F).replace('<span class="ol">Dịch</span>', '<span class="ol">Bản dịch</span>')}</div><p class="mut" style="margin:12px 0 0;font-size:12px">Biên bản viết lại theo dữ liệu HireX mới nhất (thành viên, màn hình, thuật ngữ); dùng lại bản phiên âm đã có.</p>`; M.body.querySelector('#rT').oninput = e => { F.title = e.target.value; }; optsBind(M.body.querySelector('.opts'), F, paint); };
  M.foot.innerHTML = `<span class="grow"></span><button type="button" class="btn" data-c="0">Hủy</button><button type="button" class="btn pri" data-c="1">${ico('sparkle', 16)}Tạo</button>`;
  const go = () => { M.close(true); syncSession(x.session_id, { set: 1, title: F.title.trim(), auto: !F.title.trim(), live: F.live }); };
  M.foot.onclick = e => { const b = e.target.closest('[data-c]'); if (b) b.dataset.c === '1' ? go() : M.close(true); };
  paint();
}

/* ---------- Hỏi tiến độ job nền + đồng bộ một bản ghi (gửi bù đoạn thiếu rồi finalize) ---------- */
const jobStage = new Map(), syncing = new Set();
async function pollJob(sid) {
  const t0 = Date.now(); let fails = 0;
  while (Date.now() - t0 < 4 * 3600e3) {
    await sleep(2500);
    let d; try { d = await post('job', { session_id: sid }, 15000); fails = 0; } catch { if (++fails >= 60) throw new Error('network'); continue; }
    if (!d.exists) throw new Error('no_chunks');
    jobStage.set(sid, d.stage);
    if (d.busy && (d.stage === 'error' || d.stage === 'done' || d.stage === '')) continue;
    if (d.stage === 'done') { jobStage.delete(sid); return d; }
    if (d.stage === 'error') { jobStage.delete(sid); throw new Error(d.error || 'request_failed'); }
    if (d.stage === 'stale') { jobStage.delete(sid); throw new Error('stale'); }
    if (A.m) loadArch(true);
  }
  throw new Error('timeout');
}
async function syncSession(sid, opt = {}) {
  if (syncing.has(sid) || sid === R.sid) return;
  syncing.add(sid); if (A.m) renderArch();
  try {
    let s = null, local = [];
    try { s = await DB.getSession(sid); local = s ? await DB.chunks(sid) : []; } catch { /* không có IDB */ }
    let target = sid, count = 0;
    if (local.length) {
      await upDrain(sid, 60000);
      const st = await post('status', { session_id: sid });
      if (!st.exists) target = (await createSession({ title: opt.title || s.title || 'Cuộc họp', auto: opt.auto ?? s.auto, live: opt.live ?? s.live })).session_id;
      const have = new Set(st.exists ? st.chunks : []);
      count = s && s.status === 'stopped' && s.count ? s.count : 0;
      const want = count ? local.filter(c => c.i < count) : local; if (count && want.length < count) count = 0;
      for (const c of want) if (!have.has(c.i)) await retry(() => uploadChunk(target, c.blob, c.i), 6);
    }
    const f = { session_id: target, chunk_count: count };
    if (opt.set) Object.assign(f, { title: opt.title || '', auto_title: opt.auto ? '1' : '0', live_lang: ['vi', 'en', 'ja'].includes(opt.live) ? opt.live : '' });
    await DB.patchSession(sid, { fin: true }).catch(() => {});
    let ok = false;
    for (let a = 0; a < 6 && !ok; a++) {
      let r; try { r = await fetch(API + '?action=finalize', { method: 'POST', body: form(f), keepalive: true }); } catch { await sleep(1500 * (a + 1)); continue; }
      const j = await r.json().catch(() => ({})); if ((r.ok && j.ok) || r.status === 409) { ok = true; break; } throw new Error(j.stage || 'request_failed');
    }
    if (!ok) throw new Error('network');
    loadArch(true);
    await pollJob(target); await DB.drop(sid).catch(() => {}); ups.delete(sid);
  } catch (e) {
    console.error(e); toast('Chưa gửi được bản ghi (vẫn được giữ): ' + errText(e), { action: { label: 'Thử lại', fn: () => syncSession(sid, opt) } });
  } finally { syncing.delete(sid); loadArch(true); }
}

/* ---------- Tải file ghi âm lên ---------- */
const isAudio = f => /^(audio|video)\//.test(f.type) || /\.(m4a|mp3|wav|ogg|opus|aac|flac|amr|wma|mp4|webm|mkv|mov)$/i.test(f.name);
async function pickAudio(f) {
  if (!isAudio(f)) { toast('File này không phải âm thanh'); return; }
  if (B.uploadMax && f.size > B.uploadMax) { toast('File quá lớn (tối đa ' + mb(B.uploadMax) + ')'); return; }
  if (S.st !== 'idle' || S.up) { toast('Đang ghi hoặc đang tải lên, hãy đợi xong'); return; }
  const o = meetOpts(); if (!o.title) { o.title = f.name.replace(/\.[^.]+$/, ''); o.auto = true; } S.named = false; renderOpts();
  uploadAudio(f, o);
}
/** Gửi từng phần 16 MB (HireX giới hạn mỗi request ~26 MB); phần cuối máy chủ ghép, nén rồi tạo biên bản. */
const UP_PART = 16 * 1048576;
const upPart = (f, onp) => new Promise((ok, no) => {
  const x = new XMLHttpRequest(); x.open('POST', API + '?action=upload');
  x.upload.onprogress = e => { if (e.lengthComputable) onp(e.loaded); };
  x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* lỗi máy chủ */ } x.status >= 200 && x.status < 300 && d.ok ? ok(d) : no(new Error(d.stage || 'request_failed')); };
  x.onerror = () => no(new Error('network')); x.send(f);
});
function uploadAudio(file, o) {
  S.up = { name: file.name, p: 0 }; renderFoot();
  const parts = Math.max(1, Math.ceil(file.size / UP_PART)), id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
  const fields = { title: o.title || file.name.replace(/\.[^.]+$/, ''), auto_title: o.auto ? '1' : '0', live_lang: ['vi', 'en', 'ja'].includes(o.live) ? o.live : '', file_mtime: Math.floor((file.lastModified || 0) / 1000), up_id: id, parts, size: file.size, name: file.name };
  const end = err => { S.up = null; renderFoot(); loadArch(true); if (err) toast('Chưa tải lên được: ' + errText(err), { action: { label: 'Gửi lại', fn: () => uploadAudio(file, o) } }); };
  (async () => {
    for (let i = 0; i < parts; i++) {
      const blob = file.slice(i * UP_PART, Math.min(file.size, (i + 1) * UP_PART)), last = i === parts - 1;
      const send = () => upPart(form({ ...fields, part: i, audio: { blob, name: file.name } }), n => { if (S.up) { S.up.p = (i * UP_PART + n) / file.size; renderFoot(); } });
      if (last) await send(); else await retry(send, 4);
    }
  })().then(() => end(null), end);
}
/* Kéo thả file âm thanh vào trang (tab Ghi âm) */
let dragN = 0;
on(window, 'dragenter', e => { if (S.tab === 'rec' && e.dataTransfer?.types?.includes('Files') && !LAY.length && ROOT?.offsetParent) { dragN++; ROOT.classList.add('drop-on'); } });
on(window, 'dragleave', () => { if (--dragN <= 0) { dragN = 0; ROOT?.classList.remove('drop-on'); } });
on(window, 'dragover', e => { if (!ROOT?.offsetParent) return; if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
on(window, 'drop', e => { if (!ROOT?.offsetParent) return; dragN = 0; ROOT.classList.remove('drop-on'); $('#tz')?.classList.remove('drag'); if (!e.dataTransfer?.files?.length || e.target.closest?.('.modal')) return; e.preventDefault(); if (LAY.length) return; if (S.tab === 'rec') pickAudio(e.dataTransfer.files[0]); else loadTextFiles([...e.dataTransfer.files]); });
/* ================= Đọc văn bản (Text → Audio) ================= */
const T = { ai: ['', 'rewrite', 'summary'].includes(LS.get('tai', 'summary')) ? LS.get('tai', 'summary') : 'summary', done: false, g: LS.get('g', 'female') === 'male' ? 'male' : 'female', voice: LS.get('voice', ''), vs: LS.get('vstyle', ''), speed: LS.get('speed', '1'), busy: false, deep: false, prev: null, vcfg: null };
const SPEEDS = ['0.75', '0.9', '1', '1.1', '1.25', '1.5', '1.75', '2'];
const VOICES = B.voices || { male: [], female: [] };
const voiceBy = id => [...VOICES.male, ...VOICES.female].find(v => v.id === id);
async function loadVoice() { T.vcfg = (await get('styles', '&kind=voice')).config; if (!T.vcfg.styles.some(s => s.id === T.vs)) T.vs = T.vcfg.default_style_id || T.vcfg.styles[0]?.id || ''; renderTts(); }
function ttsInit() {
  $('#pTts').innerHTML = `<div class="tts">
   <div class="zone" id="tz"><textarea id="tTxt" spellcheck="false" aria-label="Văn bản cần đọc" placeholder="Dán văn bản hoặc kéo thả file"></textarea>
    <div class="zb"><span class="mut num" id="tCnt" style="font-size:12px"></span><span class="grow"></span>
     <button type="button" class="btn ghost icon sm" data-a="tUndo" id="tUndo" title="Hoàn tác" hidden>${ico('undo', 16)}</button>
     <button type="button" class="btn ghost icon sm" data-a="tPick" title="Thêm từ file: Word, Excel, PDF, TXT">${ico('clip', 16)}</button>
     <button type="button" class="btn ghost icon sm" data-a="tClear" title="Xóa nội dung">${ico('eraser', 16)}</button></div></div>
   <div class="frow"><label>AI</label><div class="two"><div class="seg full grow" id="tAi">${[['', 'Tắt'], ['summary', 'Tóm tắt'], ['rewrite', 'Viết lại']].map(([k, l]) => `<button type="button" data-a="tAi" data-v="${k}">${l}</button>`).join('')}</div><button type="button" class="btn" data-a="tDeep" id="tDeep" title="AI xử lý văn bản trước khi đọc">${ico('sparkle', 15)}Xử lý</button></div></div>
   <div class="frow"><label>Giọng</label><div class="two"><div class="seg" role="group" aria-label="Giọng nam nữ"><button type="button" data-a="tG" data-v="female">Nữ</button><button type="button" data-a="tG" data-v="male">Nam</button></div><div class="grow" id="tVoice"></div></div></div>
   <div class="frow"><label>Phong cách</label><div class="two"><div class="grow" id="tStyle"></div><div id="tSpeed" style="width:96px;flex:none"></div></div></div>
   <div class="tnote" id="tNote"></div>
   <button type="button" class="btn pri big" data-a="tGo" id="tGo"></button>
   <div class="trec" id="tRec"></div>
  </div><input type="file" id="tFile" multiple hidden accept=".txt,.md,.csv,.srt,.vtt,.log,.docx,.xlsx,.pdf,text/plain,application/pdf">`;
  const ta = $('#tTxt'); ta.oninput = () => { if (!ta.value.trim()) T.done = false; renderTts(); }; ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ACT.tGo(); } };
  $('#tFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) loadTextFiles(f); };
  const z = $('#tz'); z.ondragover = e => { e.preventDefault(); z.classList.add('drag'); }; z.ondragleave = () => z.classList.remove('drag');
  renderTts();
}
function renderTts() {
  if (!$('#tTxt')) return;
  const n = [...$('#tTxt').value.trim()].length, max = B.ttsMax || 60000, over = n > max;
  $('#tCnt').textContent = n ? `${n.toLocaleString('vi-VN')} / ${max.toLocaleString('vi-VN')}` : ''; $('#tCnt').style.color = over ? 'var(--ui-danger)' : '';
  ROOT.querySelectorAll('[data-a=tG]').forEach(b => b.classList.toggle('on', b.dataset.v === T.g));
  const list = VOICES[T.g] || []; if (!list.some(v => v.id === T.voice)) T.voice = list[0]?.id || '';
  const v = voiceBy(T.voice), vs = T.vcfg?.styles.find(s => s.id === T.vs);
  $('#tVoice').innerHTML = pickBtn('tVoiceB', `${ico('user', 14)}<span>${esc(v?.label || '…')}</span>`);
  $('#tStyle').innerHTML = pickBtn('tStyleB', `<span>${esc(vs?.name || '…')}</span>`);
  $('#tSpeed').innerHTML = pickBtn('tSpeedB', `<span class="num">${(+T.speed).toFixed(T.speed.length > 3 ? 2 : 1)}×</span>`);
  $('#tVoice .cb').onclick = e => menu(e.currentTarget, list.map(x => ({ label: x.label, on: x.id === T.voice, fn: () => { T.voice = x.id; LS.set('voice', x.id); renderTts(); } })));
  $('#tStyle .cb').onclick = e => menu(e.currentTarget, [...(T.vcfg?.styles || []).map(s => ({ label: s.name, on: s.id === T.vs, fn: () => { T.vs = s.id; LS.set('vstyle', s.id); renderTts(); } })), { sep: 1 }, { label: 'Quản lý giọng đọc', icon: 'gear', fn: () => openCfg('voice') }]);
  $('#tSpeed .cb').onclick = e => menu(e.currentTarget, SPEEDS.map(s => ({ label: (+s).toFixed(s.length > 3 ? 2 : 1) + '×', em: s === '1' ? 'Chuẩn' : '', on: s === T.speed, fn: () => { T.speed = s; LS.set('speed', s); renderTts(); } })), { w: 140, right: 1 });
  $('#tUndo').hidden = T.prev === null;
  ROOT.querySelectorAll('#tAi [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === T.ai));
  const g = $('#tGo'), d = $('#tDeep'); g.disabled = !n || over || T.busy || T.deep || !T.voice; d.disabled = !T.ai || !n || T.deep || T.busy;
  d.innerHTML = T.deep ? `${ico('loader', 15, 'spin')}Đang xử lý` : `${ico('sparkle', 15)}Xử lý`;
  g.innerHTML = T.busy ? `${ico('loader', 18, 'spin')}Đang gửi…` : `${ico('volume', 18)}Tạo audio`;
  $('#tNote').innerHTML = '';
}
ACT.tG = b => { T.g = b.dataset.v; LS.set('g', T.g); renderTts(); };
ACT.tPick = () => $('#tFile').click();
ACT.tClear = () => { $('#tTxt').value = ''; T.prev = null; T.done = false; renderTts(); $('#tTxt').focus(); };
ACT.tAi = b => { T.ai = b.dataset.v; LS.set('tai', T.ai); T.done = false; renderTts(); };
ACT.tUndo = () => { if (T.prev === null) return; $('#tTxt').value = T.prev; T.prev = null; T.done = false; renderTts(); };
ACT.tDeep = async () => {
  const ta = $('#tTxt'), t = ta.value.trim(); if (!t || T.deep) return; T.deep = true; renderTts();
  try { const d = await post('deep_text', { text: t, mode: T.ai || 'rewrite' }, 900000); T.prev = ta.value; ta.value = d.text; ta.scrollTop = 0; T.done = true; } catch (e) { toast('Chưa diễn đạt lại được: ' + errText(e)); } finally { T.deep = false; renderTts(); }
};
ACT.tGo = () => {
  const t = $('#tTxt').value.trim(); if (!t || T.busy || [...t].length > (B.ttsMax || 60000)) return;
  const M = modal({ cls: 'sm', icon: 'volume', title: 'Tạo audio', body: `<div class="fld"><label for="tName">Tên file</label><input class="in" id="tName" maxlength="120" placeholder="Để trống, AI tự đặt" autocomplete="off"></div>`, submit: () => go() });
  M.foot.innerHTML = `<span class="grow"></span><button type="button" class="btn" data-c="0">Hủy</button><button type="button" class="btn pri" data-c="1">${ico('volume', 16)}Tạo</button>`;
  const go = () => { const n = M.body.querySelector('#tName').value.trim(); M.close(true); sendTts(n); };
  M.body.querySelector('#tName').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  M.foot.onclick = e => { const b = e.target.closest('[data-c]'); if (b) b.dataset.c === '1' ? go() : M.close(true); };
};
async function sendTts(title) {
  T.busy = true; renderTts();
  try {
    await post('tts_send', { text: $('#tTxt').value.trim(), voice: T.voice, style_id: T.vs, speed: T.speed, title, title_mode: title ? '' : 'ai' });
    loadArch(true); setTimeout(() => loadArch(true), 1500);
  } catch (e) { toast('Chưa gửi được: ' + errText(e), { action: { label: 'Gửi lại', fn: () => sendTts(title) } }); }
  finally { T.busy = false; renderTts(); }
}
/* Đọc file văn bản: PDF trên trình duyệt (pdf.js), Word/Excel/TXT qua máy chủ */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/'; let pdfLib = null;
async function readPdf(f) {
  if (f.size > 25 * 1048576) throw new Error('file_too_big');
  try { if (!pdfLib) { pdfLib = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PDFJS + 'pdf.min.mjs'); pdfLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; } } catch { throw new Error('pdf_lib'); }
  let doc; try { doc = await pdfLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; } catch { throw new Error('pdf_bad'); }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent(); let out = '', lastY = null, lastH = 0;
    for (const it of tc.items) { if (typeof it.str !== 'string') continue; const y = it.transform[5], h = Math.abs(it.height || it.transform[3]) || 10; if (lastY !== null && Math.abs(y - lastY) > h * .5) out += Math.abs(y - lastY) > Math.max(h, lastH) * 1.8 ? '\n\n' : '\n'; out += it.str; if (it.str.trim()) { lastY = y; lastH = h; } }
    pages.push(out);
  }
  doc.destroy?.();
  const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/([^\n.!?…:;"”’)\]])\n(?!\n)/g, '$1 ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('pdf_empty'); return text;
}
async function readDoc(f) { if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return readPdf(f); if (f.size > 8 * 1048576) throw new Error('file_too_big'); return (await post('extract_text', { doc: f })).text; }
async function loadTextFiles(files) {
  let err = null; const ta = $('#tTxt');
  for (const f of files) { try { const t = await readDoc(f), cur = ta.value.replace(/\s+$/, ''); ta.value = cur ? cur + '\n\n' + t : t; T.done = false; } catch (e) { console.error(e); err = e; } }
  renderTts(); if (err) toast('Có file không đọc được: ' + errText(err));
}

/* ---------- Audio vừa tạo: nghe kiểm tra ngay trong tab ---------- */
let TA = null;
function renderTtsRecent() {
  const el = $('#tRec'); if (!el) return;
  const L = A.items.filter(x => x.kind === 'tts').sort((a, b) => itemTime(b) - itemTime(a)).slice(0, 4);
  if (!L.length) { el.innerHTML = ''; return; }
  el.innerHTML = L.map(x => { const s = stOf(x), si = stInfo(x), src = x.audio ? `${API}/d/${encodeURIComponent(x.slug)}/audio` : '', on = TA && !TA.paused && TA.dataset.src === src;
    return `<div class="tri">${s === 'done' ? `<button type="button" class="pb sm" data-play="${esc(src)}" title="${on ? 'Dừng' : 'Nghe'}">${ico(on ? 'pause' : 'play', 14)}</button>` : `<span class="pb sm off"><span class="dot ${si.dot}"></span></span>`}<div class="grow"><b>${esc(x.title)}</b><span class="mut">${hm(itemTime(x))} · ${s === 'done' ? dur(x.dur) : esc(si.label)}</span></div>${s === 'done' ? `<a class="btn ghost icon sm" href="${esc(src)}?dl=1" title="Tải audio">${ico('download', 14)}</a>` : ''}</div>`; }).join('');
  el.onclick = e => { const b = e.target.closest('[data-play]'); if (!b) return; const src = b.dataset.play; if (TA && TA.dataset.src === src && !TA.paused) { TA.pause(); } else { TA?.pause(); TA = new Audio(src); TA.dataset.src = src; TA.onended = TA.onpause = TA.onplay = renderTtsRecent; TA.play().catch(() => toast('Không phát được audio')); } renderTtsRecent(); };
}
/* ================= Trình xem: Word → trang giấy, Excel → bảng tính, văn bản → trang ================= */
const vwCol = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const vwIx = s => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
/* công thức cơ bản để xem trước: SUM AVERAGE COUNT COUNTA MIN MAX + - * / */
function vwCalc(rows) {
  const memo = new Map(), busy = new Set(), ref = s => { const m = /^([A-Z]+)(\d+)$/.exec(s); return [vwIx(m[1]), +m[2] - 1]; };
  const get = (r, c) => {
    const k = r + ',' + c; if (memo.has(k)) return memo.get(k); const v = rows[r]?.[c]; let out = v;
    if (typeof v === 'string' && v[0] === '=' && v.length > 1) { if (busy.has(k)) out = '#REF!'; else { busy.add(k); try { out = ev(v.slice(1)); } catch { out = v; } busy.delete(k); } }
    memo.set(k, out); return out;
  };
  const nums = a => a.filter(x => x !== '' && x != null && !isNaN(x)).map(Number);
  const F = { SUM: a => nums(a).reduce((x, y) => x + y, 0), AVERAGE: a => { const n = nums(a); return n.length ? F.SUM(a) / n.length : '#DIV/0!'; }, COUNT: a => nums(a).length, COUNTA: a => a.filter(x => x !== '' && x != null).length, MIN: a => Math.min(...nums(a)), MAX: a => Math.max(...nums(a)) };
  const Rg = (a, b) => { const [c1, r1] = ref(a), [c2, r2] = ref(b), o = []; for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) o.push(get(r, c)); return o; };
  const Cl = a => { const [c, r] = ref(a), v = get(r, c); return v == null || v === '' ? 0 : isNaN(v) ? v : Number(v); };
  const ev = f => {
    if (!/^[A-Z0-9+\-*/().:,\s$%]*$/.test(f)) throw 0;
    const js = f.replace(/\$/g, '').replace(/([A-Z]+\d+):([A-Z]+\d+)|\b([A-Z]+\d+)\b|\b(SUM|AVERAGE|COUNT|COUNTA|MIN|MAX)\b/g, (_, a, b, c, fn) => a ? `R("${a}","${b}")` : c ? `C("${c}")` : 'F.' + fn);
    const v = new Function('F', 'R', 'C', `"use strict";return(${js.replace(/(\d)%/g, '$1/100')})`)(F, Rg, Cl);
    return typeof v === 'number' && !isFinite(v) ? '#DIV/0!' : v;
  };
  return rows.map((r, ri) => (r || []).map((_, ci) => get(ri, ci)));
}
const vwNum = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })) : esc(v ?? '');
const VK = { summary: 'Biên bản', transcript: 'Bản gốc', translation: 'Bản dịch', audio: 'Audio' };
function vwHtml(d, k, si = 0) {
  if (!d) return `<div class="vw-msg">${ico('loader', 18, 'spin')}</div>`;
  if (d.error) return `<div class="vw-msg">${esc(d.error)}</div>`;
  const t0 = d.started || d.created * 1000, meta = `<p class="sub">${dayLabel(t0)} · ${hm(t0)}${d.ended ? '–' + hm(d.ended) : ''} · ${dur(d.dur)}</p>`, title = esc(d.title);
  if (k === 'audio') return `<div class="aud">${ico('music', 30)}<b>${title}</b><span class="mut">${dur(d.dur)}</span></div>`;
  if (k === 'transcript' || k === 'translation') return `<div class="vw-doc"><article class="vw-page txt"><p class="kick">${k === 'translation' ? 'BẢN DỊCH · ' + esc(LANG[d.live_lang] || '') : 'BẢN GỐC GHI ÂM'}</p><h1>${title}</h1>${meta}${String(d.text || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('') || '<p class="mut">Trống</p>'}</article></div>`;
  if (d.sheets) {
    const sh = d.sheets[si] || d.sheets[0] || { rows: [] }, rows = sh.rows || [], vals = vwCalc(rows), n = Math.max(1, ...rows.map(r => (r || []).length));
    return `<div class="vw-sheet"><table><thead><tr><th class="rn"></th>${Array.from({ length: n }, (_, c) => `<th>${vwCol(c)}</th>`).join('')}</tr></thead><tbody>${vals.map((r, ri) => `<tr><th class="rn">${ri + 1}</th>${Array.from({ length: n }, (_, c) => `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${vwNum(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      + (d.sheets.length > 1 ? `<div class="vw-tabs">${d.sheets.map((s, i) => `<button type="button" class="chip${i === si ? ' on' : ''}" data-sheet="${i}">${esc(s.name || 'Sheet ' + (i + 1))}</button>`).join('')}</div>` : '');
  }
  if (d.mm) return `<div class="vw-doc"><article class="vw-page mm">${d.html || ''}</article></div>`;
  return d.tpl ? `<div class="vw-doc"><article class="vw-page tpl">${d.html || ''}</article></div>` : `<div class="vw-doc"><article class="vw-page"><p class="kick">BIÊN BẢN CUỘC HỌP</p><h1>${title}</h1>${meta}${d.html || ''}</article></div>`;
}
const VWC = new Map();
async function vwShow(el, slug, k) {
  const key = slug + ':' + k; let si = 0; el.innerHTML = vwHtml(VWC.get(key), k);
  if (!VWC.has(key)) { let d; try { const r = await fetch(`${API}/f/${encodeURIComponent(slug)}/data?k=${k}`); d = r.ok ? await r.json() : { error: 'Không tìm thấy tài liệu' }; } catch { d = { error: 'Không tải được tài liệu' }; } if (!d.error) VWC.set(key, d); if (el.dataset.key !== key) return; el.innerHTML = vwHtml(d, k); }
  el.onclick = e => { const b = e.target.closest('[data-sheet]'); if (b) { si = +b.dataset.sheet; el.innerHTML = vwHtml(VWC.get(key), k, si); } };
}

/* ================= Lưu trữ ================= */
const A = { items: [], q: '', f: 'all', kind: 'all', sel: null, loaded: false, busy: false, tm: 0, k: 'summary', m: null };
const STAGE = { queued: 'Đang xếp hàng', merging: 'Ghép bản ghi', encoding: 'Nén âm thanh', sending: 'Chuyển xử lý' };
const stOf = x => x.status === 'done' ? 'done' : x.localOnly ? 'attn' : (x.busy || x.status === 'processing' || syncing.has(x.session_id)) ? 'busy' : x.active ? 'rec' : 'attn';
function stInfo(x) {
  const s = stOf(x);
  if (s === 'done') return { dot: 'ok', label: 'Xong' };
  if (s === 'busy') return { dot: 'warn pulse', label: STAGE[jobStage.get(x.session_id)] || x.stage || 'Đang xử lý' };
  if (s === 'rec') return { dot: 'rec pulse', label: 'Đang ghi' };
  if (x.localOnly) return { dot: 'warn', label: x.fin ? 'Chưa xác nhận' : 'Chưa gửi lên', tip: x.fin ? 'Có thể đã gửi, chưa nhận được phản hồi' : 'Còn lưu trên máy này, chưa lên máy chủ', act: 'Gửi lại' };
  if (x.status === 'error') return { dot: 'err', label: 'Lỗi', tip: errText({ message: x.error }), act: 'Thử lại' };
  return { dot: '', label: 'Chờ tạo', tip: x.local > x.chunks && x.chunks ? `Máy chủ có ${x.chunks}/${x.local} đoạn, phần còn lại ở máy này` : 'Chưa tạo biên bản', act: 'Tạo' };
}
const outTag = x => x.kind === 'tts' ? 'Audio' : x.fmt === 'excel' && !x.v2 ? 'Excel' : 'Biên bản';
const itemTime = x => x.started_ts ? x.started_ts * 1000 : new Date(x.created).getTime();
async function loadArch(silent) {
  if (A.busy) return; A.busy = true;
  try {
    const d = await get('archive');
    const items = (d.items || []).filter(x => !(x.kind === 'meeting' && x.sid === R.sid)).map(x => ({ ...x, session_id: x.sid, started_ts: Math.floor(new Date(x.created) / 1000), est: x.est_seconds })), by = new Map(items.map(x => [x.session_id, x]));
    let loc = []; try { loc = await DB.sessions(); } catch { /* không có IDB */ }
    for (const s of loc) {
      if (s.sid === R.sid) continue; let cs = []; try { cs = await DB.chunks(s.sid); } catch { /* bỏ qua */ }
      if (!cs.length) continue; const it = by.get(s.sid); if (it) { it.local = cs.length; continue; }
      items.push({ session_id: s.sid, kind: 'meeting', title: s.title || 'Cuộc họp', created: new Date(s.at || Date.now()).toISOString(), started_ts: Math.floor((s.at || Date.now()) / 1000), started_at: s.at ? hm(s.at) + ' ' + dmy(s.at) : '', live_lang: s.live || '', auto: !!s.auto, status: 'local', chunks: 0, local: cs.length, est: s.dur || cs.length * (B.slice || 5000) / 1000, localOnly: true, fin: !!s.fin });
    }
    A.items = items; A.loaded = true;
  } catch (e) { console.error(e); if (!silent) toast('Không tải được lưu trữ'); }
  finally { A.busy = false; S.attn = A.items.filter(x => stOf(x) === 'attn').length; const busy = A.items.some(x => stOf(x) === 'busy'), b = $('#bdg'); if (b) { b.hidden = !S.attn && !busy; b.textContent = S.attn || ''; b.classList.toggle('busy', !S.attn && busy); b.title = S.attn ? S.attn + ' cần xử lý' : busy ? 'Đang tạo biên bản' : ''; } if (A.m) renderArch(); renderTtsRecent(); }
}
function archTick() { clearTimeout(A.tm); const busy = A.items.some(x => stOf(x) === 'busy'); A.tm = setTimeout(async () => { await loadArch(true); archTick(); }, A.m ? (busy ? 3000 : 12000) : (busy ? 6000 : 30000)); }
function openArchive() {
  if (A.m) return;
  const M = A.m = modal({ cls: 'arc', icon: 'archive', title: 'Lưu trữ', foot: false, onClose: () => { A.m = null; A.audio?.pause(); if (A.rs) removeEventListener('resize', A.rs); A.rs = null; archTick(); } });
  M.hx.innerHTML = `<button type="button" class="chip" id="aZalo" title="Thông báo Zalo"><span class="dot" id="aZdot"></span>Zalo</button><button type="button" class="btn ghost icon sm" id="aRe" title="Tải lại">${ico('refresh', 16)}</button>`;
  M.hx.querySelector('#aZalo').onclick = () => openCfg('zalo'); M.hx.querySelector('#aRe').onclick = () => { VWC.clear(); loadArch(); };
  M.body.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden';
  M.body.innerHTML = `<div class="abar"><div class="search">${ico('search', 16)}<input class="in" id="aQ" placeholder="Tìm…" aria-label="Tìm bản ghi" autocomplete="off"></div><div id="aChips" style="display:flex;gap:6px;flex-wrap:wrap"></div><span class="grow"></span><div class="seg" id="aKind"><button type="button" data-k="all">Tất cả</button><button type="button" data-k="meeting" title="Ghi âm">${ico('mic', 14)}</button><button type="button" data-k="tts" title="Đọc văn bản">${ico('volume', 14)}</button></div></div>
  <div class="asplit" id="aSplit"><div class="tw" id="aList"></div><div class="gut" id="aGut" title="Kéo để đổi độ rộng · nhấp đúp để đặt lại"></div><aside class="det" id="aDet"></aside></div>`;
  splitInit(M);
  const q = M.body.querySelector('#aQ'); q.value = A.q; q.oninput = () => { A.q = q.value; renderList(); };
  M.body.querySelector('#aKind').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { A.kind = b.dataset.k; renderArch(); } };
  M.body.querySelector('#aChips').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { A.f = b.dataset.f; renderArch(); } };
  M.m.addEventListener('keydown', e => { if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); q.focus(); } });
  renderArch(); loadArch(); archTick(); zaloState().then(paintZchip);
}
/** Thanh kéo giữa danh sách và khung chi tiết: kéo để đổi độ rộng (nhớ lại lần sau), nhấp đúp để đặt lại. */
function splitInit(M) {
  const sp = M.body.querySelector('#aSplit'), det = sp.querySelector('#aDet'), g = sp.querySelector('#aGut');
  const setW = w => { const max = Math.max(320, sp.clientWidth - 349); w = Math.round(Math.max(320, Math.min(max, w))); det.style.width = w + 'px'; return w; };
  const saved = +LS.get('arc.det', 0); if (saved) setW(saved);
  g.onpointerdown = e => {
    if (innerWidth <= 760) return; e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on'); sp.classList.add('drag'); const r = sp.getBoundingClientRect();
    g.onpointermove = ev => setW(r.right - ev.clientX);
    g.onpointerup = g.onpointercancel = () => { g.onpointermove = null; g.classList.remove('on'); sp.classList.remove('drag'); LS.set('arc.det', det.offsetWidth); };
  };
  g.ondblclick = () => { det.style.width = ''; LS.set('arc.det', ''); };
  const rs = () => { if (det.style.width && innerWidth > 760) setW(parseInt(det.style.width)); }; addEventListener('resize', rs);
  A.rs = rs;
}
function paintZchip() { const d = $('#aZdot'); if (!d) return; const s = Z.s; d.className = 'dot ' + (!s.notify ? '' : s.logged ? 'ok' : 'warn'); $('#aZalo').title = !s.notify ? 'Thông báo Zalo đang tắt' : s.logged ? 'Đang gửi thông báo Zalo' + (s.group_name ? ' · ' + s.group_name : '') : 'Chưa chọn nhóm Zalo nhận thông báo'; }
const visible = () => { const q = noMark(A.q.trim()); return A.items.filter(x => (A.kind === 'all' || x.kind === A.kind) && (!q || noMark(x.title).includes(q)) && (A.f === 'all' || stOf(x) === A.f || (A.f === 'busy' && stOf(x) === 'rec'))).sort((a, b) => itemTime(b) - itemTime(a)); };
function renderArch() {
  if (!A.m) return;
  const n = s => A.items.filter(x => stOf(x) === s).length, nb = n('busy') + n('rec'), na = n('attn');
  $('#aChips').innerHTML = `<button type="button" class="chip${A.f === 'all' ? ' on' : ''}" data-f="all">Tất cả</button>${nb ? `<button type="button" class="chip${A.f === 'busy' ? ' on' : ''}" data-f="busy"><span class="dot warn"></span>Đang xử lý <em>${nb}</em></button>` : ''}${na ? `<button type="button" class="chip${A.f === 'attn' ? ' on' : ''}" data-f="attn"><span class="dot err"></span>Cần xử lý <em>${na}</em></button>` : ''}`;
  if (A.f !== 'all' && !(A.f === 'busy' ? nb : na)) A.f = 'all';
  ROOT.querySelectorAll('#aKind [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === A.kind));
  renderList(); renderDet();
}
function rowHtml(x) {
  const si = stInfo(x), s = stOf(x), tr = !!x.translation;
  const acts = s === 'done' ? (x.audio ? `<button type="button" class="btn ghost icon sm" data-r="play" title="Nghe">${ico('play', 14)}</button>` : '') + (x.summary || x.audio ? `<a class="btn ghost icon sm" href="${API}/d/${encodeURIComponent(x.slug)}/${x.summary ? 'summary' : 'audio'}?dl=1" data-r="dl" title="Tải ${x.summary ? 'biên bản' : 'audio'}">${ico('download', 14)}</a>` : '') + `<button type="button" class="btn ghost icon sm" data-r="more" title="Thêm">${ico('more', 14)}</button>`
    : s === 'attn' ? `<button type="button" class="btn sm" data-r="redo" title="${esc(si.tip || '')}">${ico('refresh', 14)}${si.act}</button><button type="button" class="btn ghost icon sm" data-r="more" title="Thêm">${ico('more', 14)}</button>` : '';
  return `<tr class="${A.sel === x.session_id ? 'sel' : ''}" data-id="${esc(x.session_id)}" tabindex="0"><td class="c-nm"><div class="nm">${ico(x.kind === 'tts' ? 'volume' : 'mic', 15)}<span title="${esc(x.title)}">${esc(x.title)}</span></div></td>
   <td class="mut c-time">${dm(itemTime(x))} ${hm(itemTime(x))}</td><td class="num c-dur">${x.dur ? dur(x.dur) : x.est ? '~' + dur(x.est) : '—'}</td>
   <td class="c-out"><span class="tag">${outTag(x)}${tr ? ' ' + ico('globe', 12) : ''}</span></td><td class="c-st"><span class="stc" title="${esc(si.tip || '')}"><span class="dot ${si.dot}"></span>${esc(si.label)}</span></td><td class="fa c-fa">${acts}</td></tr>`;
}
function renderList() {
  const box = $('#aList'); if (!box) return; const list = visible();
  if (!list.length) { box.innerHTML = `<div class="empty">${ico(A.loaded ? 'inbox' : 'loader', 30, A.loaded ? '' : 'spin')}<span>${!A.loaded ? '' : A.items.length ? 'Không có bản ghi khớp' : 'Chưa có bản ghi'}</span></div>`; return; }
  const att = list.filter(x => stOf(x) === 'attn'), rest = list.filter(x => stOf(x) !== 'attn'); let h = '', last = '';
  if (att.length && A.f === 'all') h += `<tr class="gh"><td colspan="6">Cần xử lý</td></tr>` + att.map(rowHtml).join('');
  for (const x of A.f === 'all' ? rest : list) { const d = dayLabel(itemTime(x)); if (d !== last && A.f === 'all') { last = d; h += `<tr class="gh"><td colspan="6">${esc(d)}</td></tr>`; } h += rowHtml(x); }
  box.innerHTML = `<table class="grid"><thead><tr><th class="c-nm">Tên</th><th class="c-time">Ngày</th><th class="num c-dur">Dài</th><th class="c-out">Đầu ra</th><th class="c-st">Trạng thái</th><th class="c-fa"></th></tr></thead><tbody>${h}</tbody></table>`;
  box.onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const x = A.items.find(i => i.session_id === tr.dataset.id); if (!x) return;
    const r = e.target.closest('[data-r]');
    if (r?.dataset.r === 'dl') return;
    if (r?.dataset.r === 'more') { e.stopPropagation(); menu(r, moreItems(x), { right: 1 }); return; }
    if (r?.dataset.r === 'redo') { redo(x); return; }
    select(x.session_id, r?.dataset.r === 'play');
  };
  box.onkeydown = e => { if (e.key === 'Enter') e.target.closest('tr[data-id]')?.click(); };
}
function select(id, play) { A.sel = id; A.k = ''; renderList(); renderDet(play); $('#aSplit')?.classList.add('dopen'); }
const shareUrl = (x, k) => location.origin + '/m/' + encodeURIComponent(x.slug) + (k ? '/' + k : '');
async function copyLink(x, k) { try { await navigator.clipboard.writeText(shareUrl(x, k)); toast('Đã sao chép link', { ok: 1, ms: 2000 }); } catch { toast('Không sao chép được'); } }
function moreItems(x) {
  const s = stOf(x), dl = k => ({ label: 'Tải ' + (k === 'summary' ? (x.fmt === 'excel' ? 'báo cáo' : 'biên bản') : k === 'transcript' ? 'bản gốc' : k === 'translation' ? 'bản dịch' : 'audio'), icon: k === 'audio' ? 'music' : k === 'summary' && x.fmt === 'excel' ? 'sheet' : 'file', fn: () => { location.href = `${API}/d/${encodeURIComponent(x.slug)}/${k}?dl=1`; } });
  const out = [];
  if (s === 'done') { for (const k of ['summary', 'transcript', 'translation', 'audio']) if (x[k]) out.push(dl(k)); out.push({ sep: 1 }, { label: 'Sao chép link', icon: 'link', fn: () => copyLink(x) }, { label: 'Mở trang chia sẻ', icon: 'external', fn: () => open(shareUrl(x), '_blank', 'noopener') }); if (x.kind === 'meeting') out.push({ label: 'Tạo lại biên bản', icon: 'refresh', fn: () => redo(x) }); }
  out.push({ sep: 1 }, { label: 'Xóa', icon: 'trash', danger: 1, fn: () => delItem(x) });
  return out[0]?.sep ? out.slice(1) : out;
}
async function delItem(x) {
  if (!await confirmBox('Xóa bản ghi?', `"${x.title}" sẽ bị xóa khỏi máy chủ, gồm audio và tài liệu.`)) return;
  try { if (x.localOnly || x.local) await DB.drop(x.session_id).catch(() => {}); if (!x.localOnly) await post('delete', { session_id: x.session_id }); if (A.sel === x.session_id) A.sel = null; await loadArch(true); }
  catch (e) { toast('Không xóa được: ' + errText(e)); }
}
function redo(x) { redoDialog(x); }
function renderDet(play) {
  const el = $('#aDet'); if (!el) return; const x = A.items.find(i => i.session_id === A.sel);
  if (!x) { el.innerHTML = `<div class="empty">${ico('archive', 30)}<span>Chọn một bản ghi</span></div>`; return; }
  const s = stOf(x), si = stInfo(x), t0 = itemTime(x), t1 = x.ended || 0;
  const ks = ['summary', 'transcript', 'translation'].filter(k => x[k]); if (!ks.includes(A.k)) A.k = ks[0] || (x.audio ? 'audio' : '');
  const head = `<div class="dh"><button type="button" class="btn ghost icon sm dback" data-d="back" title="Quay lại">${ico('chevl', 16)}</button><div><b title="${esc(x.title)}">${esc(x.title)}</b><span>${dayLabel(t0)} · ${hm(t0)}${t1 ? '–' + hm(t1) : ''}</span></div></div>`;
  if (s !== 'done') {
    el.innerHTML = head + `<div class="empty"><span class="stc" style="font-size:14px"><span class="dot ${si.dot}"></span>${esc(si.label)}</span>${si.tip ? `<span>${esc(si.tip)}</span>` : ''}${s === 'attn' ? `<div style="display:flex;gap:8px"><button type="button" class="btn pri" data-d="redo">${ico('refresh', 16)}${si.act}</button><button type="button" class="btn icon" data-d="del" title="Xóa">${ico('trash', 16)}</button></div>` : ''}</div>`;
  } else {
    const lbl = k => k === 'summary' && x.fmt === 'excel' ? 'Báo cáo' : k === 'translation' ? 'Bản dịch' + (x.live_lang ? ' ' + (LSHORT[x.live_lang] || '') : '') : VK[k];
    el.innerHTML = head + (x.audio ? `<div class="pl"><button type="button" class="pb" data-d="play" title="Phát / dừng">${ico('play', 16)}</button><input type="range" min="0" max="1000" value="0" aria-label="Vị trí phát" id="aSeek"><span class="t" id="aT">0:00 / ${dur(x.dur)}</span><button type="button" class="btn ghost sm" data-d="rate" title="Tốc độ phát">1×</button></div>` : '')
      + (ks.length ? `<div class="dt">${ks.map(k => `<button type="button" class="tab${A.k === k ? ' on' : ''}" data-tab="${k}">${lbl(k)}</button>`).join('')}<span class="grow"></span><button type="button" class="btn ghost icon sm" data-d="open" title="Mở toàn trang">${ico('external', 14)}</button></div>` : '')
      + `<div class="dv" id="aView"></div>`
      + `<div class="da">${A.k && A.k !== 'audio' ? `<a class="btn pri" href="${API}/d/${encodeURIComponent(x.slug)}/${A.k}?dl=1">${ico('download', 16)}Tải</a>` : ''}${x.audio ? `<a class="btn icon" href="${API}/d/${encodeURIComponent(x.slug)}/audio?dl=1" title="Tải audio">${ico('music', 16)}</a>` : ''}<button type="button" class="btn icon" data-d="link" title="Sao chép link">${ico('link', 16)}</button><span class="grow"></span>${x.kind === 'meeting' ? `<button type="button" class="btn ghost icon" data-d="redo" title="Tạo lại biên bản">${ico('refresh', 16)}</button>` : ''}<button type="button" class="btn ghost icon" data-d="del" title="Xóa">${ico('trash', 16)}</button></div>`;
    const v = el.querySelector('#aView'); v.dataset.key = x.slug + ':' + A.k; vwShow(v, x.slug, A.k || 'audio');
    if (x.audio) player(el, x, play);
  }
  el.onclick = e => {
    const t = e.target.closest('[data-tab]'); if (t) { A.k = t.dataset.tab; const keep = A.audio && !A.audio.paused; renderDet(); if (keep) A.audio.play(); return; }
    const b = e.target.closest('[data-d]'); if (!b) return; const a = b.dataset.d;
    if (a === 'back') { $('#aSplit').classList.remove('dopen'); A.audio?.pause(); }
    else if (a === 'redo') redo(x); else if (a === 'del') delItem(x); else if (a === 'link') copyLink(x); else if (a === 'open') open(shareUrl(x, A.k), '_blank', 'noopener');
  };
}
function player(el, x, autoplay) {
  const src = `${API}/d/${encodeURIComponent(x.slug)}/audio`;
  if (!A.audio || A.audio.dataset.src !== src) { A.audio?.pause(); A.audio = new Audio(src); A.audio.preload = 'metadata'; A.audio.dataset.src = src; }
  const au = A.audio, pb = el.querySelector('[data-d=play]'), seek = el.querySelector('#aSeek'), tt = el.querySelector('#aT'), rate = el.querySelector('[data-d=rate]');
  const paint = () => { const d = au.duration || x.dur || 0; pb.innerHTML = ico(au.paused ? 'play' : 'pause', 16); if (!seek.matches(':active')) seek.value = d ? Math.round(au.currentTime / d * 1000) : 0; tt.textContent = `${dur(au.currentTime)} / ${dur(d)}`; rate.textContent = au.playbackRate + '×'; };
  au.ontimeupdate = au.onplay = au.onpause = au.onloadedmetadata = au.onended = paint; paint();
  pb.onclick = e => { e.stopPropagation(); au.paused ? au.play().catch(() => toast('Không phát được audio')) : au.pause(); };
  seek.oninput = () => { const d = au.duration || x.dur; if (d) au.currentTime = seek.value / 1000 * d; };
  rate.onclick = e => { e.stopPropagation(); const R2 = [1, 1.25, 1.5, 2, .75]; au.playbackRate = R2[(R2.indexOf(au.playbackRate) + 1) % R2.length]; paint(); };
  if (autoplay) au.play().catch(() => {});
}

/* ================= Trang xem công khai /m/<slug> ================= */
async function renderPub() {
  const { slug, kind } = B.pub; let base;
  try { base = await fetch(`${API}/f/${encodeURIComponent(slug)}/data`).then(r => r.json()); } catch { ROOT.innerHTML = '<div class="vw-msg" style="height:100%">Không tải được</div>'; return; }
  const ks = ['summary', 'transcript', 'translation', 'audio'].filter(k => base.files?.[k]); let k = ks.includes(kind) ? kind : base.kind === 'tts' ? 'audio' : ks[0];
  document.title = base.title;
  const paint = () => {
    ROOT.innerHTML = `<div class="pub"><header class="pbar"><h1>${esc(base.title)}</h1>${ks.length > 1 ? `<div class="seg">${ks.map(x => `<button type="button" class="${x === k ? 'on' : ''}" data-k="${x}">${x === 'summary' && base.fmt === 'excel' ? 'Báo cáo' : x === 'translation' ? 'Bản dịch' : VK[x]}</button>`).join('')}</div>` : ''}<a class="btn pri" href="${API}/d/${encodeURIComponent(slug)}/${k}?dl=1">${ico('download', 16)}Tải</a></header><div class="dv" id="pv"></div></div>`;
    const v = $('#pv'); v.dataset.key = slug + ':' + k;
    if (k === 'audio') v.innerHTML = `<div class="aud">${ico('music', 30)}<b>${esc(base.title)}</b><audio controls preload="metadata" src="${API}/d/${encodeURIComponent(slug)}/audio"></audio></div>`; else vwShow(v, slug, k);
    $('.pbar .seg')?.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { k = b.dataset.k; paint(); } });
  };
  paint();
}
/* ================= Cài đặt: Zalo · Giọng đọc =================
   (Chủ đề / Mẫu báo cáo / Từ vựng / Công ty đã bỏ: ngữ cảnh cuộc họp lấy tự động từ dữ liệu HireX) */
const CF = { m: null, p: 'zalo', dirty: false, opts: {}, ed: null, sel: {} };
const PANES = [['zalo', 'chat', 'Zalo'], ['voice', 'volume', 'Giọng đọc']];
const Z = { s: {}, tm: 0, t: null };
async function zaloState() { try { const d = await get('zalo_state'); Z.s = d; } catch { /* bỏ qua */ } return Z.s; }
async function guard() { if (!CF.dirty) return true; if (!await confirmBox('Bỏ thay đổi?', 'Thay đổi chưa lưu sẽ mất.', 'Bỏ thay đổi')) return false; CF.dirty = false; return true; }
async function openCfg(p, opts = {}) {
  if (CF.m) { if (p && p !== CF.p && await guard()) { CF.opts = opts; showPane(p); } return; }
  CF.opts = opts; CF.dirty = false;
  const M = CF.m = modal({ cls: 'cfg', icon: 'gear', title: 'Cài đặt', foot: false, dismiss: false, beforeClose: () => { if (CF.dirty) { guard().then(ok => ok && M.close(true)); return false; } }, onClose: () => { CF.m = null; clearInterval(Z.tm); renderOpts(); renderTts(); } });
  M.body.style.cssText = 'padding:0;display:flex;overflow:hidden';
  M.body.innerHTML = `<div class="cb2"><nav class="cnav" id="cNav"></nav><div class="cmain" id="cMain"></div></div>`;
  M.body.querySelector('#cNav').onclick = async e => { const b = e.target.closest('[data-p]'); if (b && b.dataset.p !== CF.p && await guard()) { CF.opts = {}; showPane(b.dataset.p); } };
  try { if (!T.vcfg) await loadVoice(); } catch { toast('Không tải được cài đặt'); }
  showPane(p || CF.p);
}
function showPane(p) {
  CF.p = p; CF.dirty = false; CF.ed = null; clearInterval(Z.tm);
  if (!PANES.some(([k]) => k === p)) p = CF.p = 'zalo';
  $('#cNav').innerHTML = PANES.map(([k, ic, l]) => `<button type="button" class="mi${k === p ? ' on' : ''}" data-p="${k}">${ico(ic, 16)}<span class="t">${l}</span></button>`).join('');
  (p === 'voice' ? paneVoice : paneZalo)();
}
const markDirty = () => { CF.dirty = true; const b = $('#cSave'); if (b) b.disabled = false; };

/* ---------- Danh sách đơn giản: mỗi dòng = tên + nút sửa/xóa ---------- */
const rowBtns = (id, o = {}) => `<td class="fa">${o.star ? `<button type="button" class="btn ghost icon sm${o.on ? ' on' : ''}" data-r="def" data-id="${esc(id)}" title="${o.on ? 'Đang là mặc định' : 'Đặt làm mặc định'}">${ico('star', 14)}</button>` : ''}<button type="button" class="btn ghost icon sm" data-r="edit" data-id="${esc(id)}" title="Sửa">${ico('edit', 14)}</button>${o.del === false ? '' : `<button type="button" class="btn ghost icon sm" data-r="del" data-id="${esc(id)}" title="Xóa">${ico('trash', 14)}</button>`}</td>`;
const pane = (title, btns, body) => { $('#cMain').innerHTML = `<div class="ph2"><b>${title}</b><span class="grow"></span>${btns}</div>${body}`; return $('#cMain'); };

/* ---------- Giọng đọc (tab Đọc văn bản) ---------- */
function paneVoice() {
  const L = T.vcfg?.styles || [];
  const m = pane('Giọng đọc', `<button type="button" class="btn pri" data-c="add">${ico('plus', 16)}Thêm phong cách</button>`,
    `<div class="box"><table class="grid"><colgroup><col><col style="width:84px"></colgroup><tbody>${L.map(v => `<tr data-id="${esc(v.id)}"><td><div class="nm">${ico('volume', 15)}<span><b style="font-weight:500">${esc(v.name)}</b> <span class="mut">· ${esc((v.prompt || '').slice(0, 80))}</span></span></div></td>${rowBtns(v.id, { del: !v.builtin })}</tr>`).join('')}</tbody></table></div>`);
  m.onclick = async e => {
    if (e.target.closest('[data-c=add]')) return voiceDialog(null);
    const r = e.target.closest('[data-r]'), tr = e.target.closest('tr[data-id]'), v = L.find(x => x.id === (r?.dataset.id || tr?.dataset.id)); if (!v || !r) return;
    if (r?.dataset.r === 'del') { if (await confirmBox('Xóa phong cách?', `"${v.name}" sẽ bị xóa.`)) { try { T.vcfg = (await post('style_delete', { kind: 'voice', id: v.id })).config; showPane('voice'); } catch (er) { toast(errText(er)); } } return; }
    voiceDialog(v);
  };
}
function voiceDialog(v) {
  const E = v ? { ...v } : { id: '', name: '', prompt: '', prefix: '', suffix: '' };
  const M = modal({ cls: 'sm', icon: 'volume', title: v ? 'Sửa phong cách' : 'Thêm phong cách', submit: () => go(),
    body: `<div class="fld"><label>Tên</label><input class="in" data-f="name" maxlength="80" value="${esc(E.name)}" placeholder="Ví dụ: Bản tin sáng" autocomplete="off"></div><div class="fld"><label>Cách đọc</label><textarea class="in" data-f="prompt" rows="3" maxlength="16000" placeholder="Giọng ấm, tốc độ vừa, ngắt nghỉ rõ">${esc(E.prompt)}</textarea></div><div class="fld"><label>Câu mở đầu <span class="mut" style="font-weight:400">· tuỳ chọn</span></label><input class="in" data-f="prefix" maxlength="300" value="${esc(E.prefix)}" autocomplete="off"></div><div class="fld"><label>Câu kết <span class="mut" style="font-weight:400">· tuỳ chọn</span></label><input class="in" data-f="suffix" maxlength="300" value="${esc(E.suffix)}" autocomplete="off"></div><span class="msg" id="vM"></span>` });
  M.body.oninput = e => { const f = e.target.dataset.f; if (f) E[f] = e.target.value; };
  M.foot.innerHTML = `<span class="grow"></span><button type="button" class="btn" data-c="0">Hủy</button><button type="button" class="btn pri" data-c="1">Lưu</button>`;
  const go = async () => { if (!E.name.trim() || !E.prompt.trim()) { M.body.querySelector('#vM').textContent = 'Nhập tên và cách đọc'; return; } try { T.vcfg = (await post('style_save', { kind: 'voice', id: E.id, name: E.name, prompt: E.prompt, prefix: E.prefix, suffix: E.suffix })).config; M.close(true); if (CF.m) showPane('voice'); renderTts(); } catch (er) { M.body.querySelector('#vM').textContent = errText(er); } };
  M.foot.onclick = e => { const b = e.target.closest('[data-c]'); if (b) b.dataset.c === '1' ? go() : M.close(true); };
}

/* ---------- Zalo: gửi bằng nick Zalo của HireX vào một nhóm Zalo ---------- */
async function paneZalo() {
  $('#cMain').innerHTML = `<div class="vw-msg">${ico('loader', 18, 'spin')}</div>`;
  await zaloState(); if (CF.p !== 'zalo') return;
  const s = Z.s; CF.ed = { notify: !!s.notify, meeting: s.meeting !== false, tts: s.tts !== false, acc: s.account_id || '', accName: s.account_name || '', conv: s.conversation_id || '', group: s.group_name || '' }; Z.t = null; zaloPaint(); zaloLoad();
}
async function zaloLoad() { try { Z.t = await get('zalo_targets', '&account_id=' + encodeURIComponent(CF.ed?.acc || '')); } catch { Z.t = { nicks: [], groups: [] }; } zaloPaint(); }
function zaloPaint() {
  const s = Z.s, E = CF.ed, m = $('#cMain'); if (!m || CF.p !== 'zalo' || !E) return;
  const ro = !s.admin, t = Z.t, nick = t?.nicks.find(n => n.id === E.acc), off = nick && !nick.connected;
  m.innerHTML = `<div class="ph2"><b>Zalo</b><span class="grow"></span><button type="button" class="btn" data-c="test"${E.acc && E.conv ? '' : ' disabled'}>${ico('send', 16)}Gửi thử</button>${ro ? '' : `<button type="button" class="btn pri" id="cSave" data-c="save"${CF.dirty ? '' : ' disabled'}>Lưu</button>`}</div>
  <div class="zcard"><div class="zrow"><span class="zav${E.acc && !off ? ' on' : ''}">${ico('chat', 18)}</span><div class="grow"><b>${esc(E.accName || 'Chưa chọn nick Zalo')}</b><div class="mut" style="font-size:12px">${!E.acc ? 'Gửi thông báo bằng một nick Zalo đã kết nối trong HireX' : off ? 'Nick đang mất kết nối' : 'Nick Zalo của HireX'}</div></div>
   <button type="button" class="btn" data-c="nick"${ro ? ' disabled' : ''}>${ico('user', 14)}Chọn nick</button></div></div>
  <div class="zcard"><div class="zrow"><div class="grow"><b>Gửi thông báo</b></div><button type="button" class="sw${E.notify ? ' on' : ''}" data-t="notify" role="switch" aria-checked="${E.notify}" aria-label="Gửi thông báo Zalo"${ro ? ' disabled' : ''}></button></div>
   <div class="zsub"${E.notify ? '' : ' style="opacity:.5;pointer-events:none"'}><label class="ck2"><button type="button" class="sw${E.meeting ? ' on' : ''}" data-t="meeting" role="switch" aria-checked="${E.meeting}"${ro ? ' disabled' : ''}></button>Cuộc họp xong</label><label class="ck2"><button type="button" class="sw${E.tts ? ' on' : ''}" data-t="tts" role="switch" aria-checked="${E.tts}"${ro ? ' disabled' : ''}></button>Audio xong</label></div></div>
  <div class="zcard"><div class="zrow"><div class="grow"><b>Nhóm nhận</b><div class="mut" style="font-size:12px">${esc(E.group || 'Chưa chọn nhóm')}</div></div><button type="button" class="btn sm" data-c="pick"${ro || !E.acc ? ' disabled' : ''}>${ico('users', 14)}Chọn nhóm</button></div>
   ${ro ? '<span class="mut" style="font-size:12px">Chỉ Quản trị viên được đổi cài đặt Zalo</span>' : ''}<span class="msg" id="eMsg"></span></div>`;
  m.onclick = async e => {
    const msg = x => { const el = $('#eMsg'); if (el) el.textContent = x; };
    const tg = e.target.closest('[data-t]'); if (tg) { if (ro) return; E[tg.dataset.t] = !E[tg.dataset.t]; markDirty(); zaloPaint(); return; }
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
    try {
      if (c === 'save') await zaloSave();
      else if (c === 'test') { if (CF.dirty) await zaloSave(); b.disabled = true; msg('Đang gửi…'); const r = await post('zalo_test', {}, 90000); msg(''); toast(r.result === 'SENT' ? 'Đã gửi tin thử' : 'Đã xếp hàng — tin sẽ tới nhóm trong ít phút', { ok: 1, ms: 3000 }); b.disabled = false; }
      else if (c === 'nick') { if (!t) return msg('Đang tải danh sách nick…'); if (!t.nicks.length) return msg('Chưa có nick Zalo nào bạn được dùng trong HireX'); menu(b, t.nicks.map(n => ({ label: n.name, icon: 'user', em: n.connected ? '' : 'Mất kết nối', on: n.id === E.acc, fn: () => { if (n.id === E.acc) return; Object.assign(E, { acc: n.id, accName: n.name, conv: '', group: '' }); markDirty(); Z.t = null; zaloPaint(); zaloLoad(); } })), { w: 280, right: 1 }); }
      else if (c === 'pick') { if (!t) return msg('Đang tải danh sách nhóm…'); if (!t.groups.length) return msg('Nick này chưa có nhóm Zalo nào trong HireX'); menu(b, t.groups.map(g => ({ label: g.name, icon: 'users', em: ago(g.at), on: g.id === E.conv, fn: () => { E.conv = g.id; E.group = g.name; markDirty(); zaloPaint(); } })), { w: 340, right: 1, search: 'Tìm nhóm…' }); }
    } catch (er) { b.disabled = false; msg(er.detail || errText(er)); }
  };
}
async function zaloSave() {
  const E = CF.ed; if (E.notify && !E.conv) throw Object.assign(new Error('x'), { detail: 'Chọn nhóm nhận trước khi bật thông báo' });
  await post('zalo_config', { notify: E.notify ? '1' : '0', meeting: E.meeting ? '1' : '0', tts: E.tts ? '1' : '0', account_id: E.acc, account_name: E.accName, conversation_id: E.conv, group_name: E.group });
  CF.dirty = false; await zaloState(); zaloPaint(); paintZchip();
}

/* ================= Khởi động: mount vào khung của HireX, unmount khi rời trang ================= */
let LIVE_ON = null, RETRY_TM = 0;
/** Gắn ứng dụng vào root (.hs-rec). Trả về hàm gỡ. Trạng thái (đang tải lên, lưu trữ…) giữ trong module giữa các lần vào trang. */
export function mount(root, boot) {
  if (boot && boot !== B) { for (const k of Object.keys(B)) delete B[k]; Object.assign(B, boot); }
  ROOT = root; LIVE_ON = new AbortController();
  for (const [t, ev, fn, opt] of ONS) t.addEventListener(ev, fn, { ...(opt === true ? { capture: true } : opt || {}), signal: LIVE_ON.signal });
  // Đang ghi mà bấm sang mục khác của HireX: hỏi trước (rời trang thì dừng ghi; phần đã ghi vẫn ở Lưu trữ để tạo biên bản sau).
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]'); if (!a || ROOT?.contains(a) || !(S.st === 'rec' || S.st === 'paused')) return;
    if (!confirm('Đang ghi âm. Rời trang sẽ dừng ghi (phần đã ghi vẫn nằm trong Lưu trữ để tạo biên bản sau). Rời trang?')) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, signal: LIVE_ON.signal });
  RETRY_TM = setInterval(upRetryFailed, 20000);
  if (B.pub) { renderPub(); return unmount; }
  renderApp();
  loadVoice().catch(() => {});
  loadArch(true).then(archTick);
  zaloState();
  if (!B.ai) setTimeout(() => toast(ERR.no_ai_key), 600);
  return unmount;
}
function unmount() {
  if (S.st === 'rec' || S.st === 'paused') { flushNow(); try { R.rec?.stop(); } catch { /* đã dừng */ } teardown(); R.rec = null; R.sid = null; S.st = 'idle'; }
  cancelAnimationFrame(WV.raf); clearTimeout(A.tm); clearInterval(Z.tm); clearInterval(RETRY_TM); A.audio?.pause(); TA?.pause();
  MENU = null; LAY.length = 0; A.m = null; CF.m = null; LIVE_ON?.abort(); LIVE_ON = null; ROOT = null;
}
