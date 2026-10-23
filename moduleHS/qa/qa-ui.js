/* Kiểm thử phần mềm (Tiện ích › Kiểm thử) — giao diện: nhập link + yêu cầu (kèm ảnh) → agent tự thao tác trên trình duyệt máy chủ,
   xem trực tiếp (có thể tự điều khiển khi cần đăng nhập), nhật ký từng bước, báo cáo (tải Word). Vẽ vào khung .hs-rec.hs-qa,
   dùng chung token / nút / ô nhập của Cuộc họp (meeting.css), bố cục riêng ở qa.css. */
const API = '/api/hs/qa';
let ROOT = null, ON = null;
const IC = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>', pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>', send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  minus: '<path d="M5 12h14"/>', loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>', flask: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-9M6 13H2M22 13h-4M3 7l3 2M21 7l-3 2M3 19l3-2M21 19l-3-2M9 6l-1-3M15 6l1-3"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>', layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>', back: '<path d="m15 6-6 6 6 6"/>', scroll: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', kbd: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', note: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
};
const ico = (n, sz = 16, cls = '') => `<svg class="i ${cls}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sz <= 14 ? 2 : 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.help}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = s => ROOT?.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dm = t => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const secs = ms => ms >= 60000 ? `${Math.floor(ms / 60000)}p ${Math.round(ms % 60000 / 1000)}s` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const hostOf = u => { try { return new URL(u).host; } catch { return u || ''; } };
async function get(a, q = '') { const r = await fetch(`${API}?action=${a}${q}`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.stage || 'Lỗi máy chủ'); return j; }
async function post(a, body, q = '') { const r = await fetch(`${API}?action=${a}${q}`, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.stage || 'Lỗi máy chủ'); return j; }
function toast(msg, ok) { let t = $('#qToast'); if (!t) return; const el = document.createElement('div'); el.className = 'toast' + (ok ? ' ok' : ''); el.innerHTML = ico(ok ? 'check' : 'alert', 16) + `<span>${esc(msg)}</span>`; t.append(el); setTimeout(() => el.remove(), 3500); }

/* ================= trạng thái ================= */
const ST = { runs: [], sel: '', tab: 'live', data: null, imgs: [], login: false, depth: 40, poll: 0, fpoll: 0, frame: -1, ctrl: false, busy: false };
const LIVE = new Set(['starting', 'running', 'waiting', 'reporting']);
const STL = { starting: ['warn pulse', 'Đang mở'], running: ['rec pulse', 'Đang test'], waiting: ['warn', 'Chờ bạn'], reporting: ['warn pulse', 'Viết báo cáo'], done: ['ok', 'Xong'], error: ['err', 'Lỗi'] };
const KIND = { goto: 'globe', click: 'pointer', fill: 'edit', select: 'list', press: 'kbd', hover: 'eye', scroll: 'scroll', back: 'back', wait: 'clock', note: 'note', ask: 'help', finish: 'flask', dialog: 'alert', info: 'image' };
const NOTE = { bug: ['bug', 'Lỗi'], ux: ['layout', 'UX'], perf: ['gauge', 'Tốc độ'], content: ['text', 'Nội dung'], a11y: ['eye', 'Truy cập'], security: ['shield', 'Bảo mật'], ok: ['check', 'Tốt'] };
const SEV = { cao: 'err', 'trung bình': 'warn', 'thấp': '' };
const RES = { pass: ['check', 'ok', 'Đạt'], fail: ['x', 'err', 'Lỗi'], warn: ['alert', 'warn', 'Cần xem'], skip: ['minus', '', 'Bỏ qua'] };

/* ================= khung ================= */
function render() {
  ROOT.innerHTML = `<div class="q-app"><aside class="q-side">
    <form class="q-new" id="qNew" autocomplete="off">
      <label class="q-url">${ico('globe', 16)}<input class="in" id="qUrl" placeholder="Link cần test" inputmode="url" spellcheck="false"></label>
      <div class="q-goal" id="qGoalBox"><textarea class="in" id="qGoal" rows="4" placeholder="Muốn test gì? Ví dụ: Test form đăng ký — bỏ trống, email sai, mật khẩu yếu, bấm gửi nhiều lần"></textarea><div class="q-thumbs" id="qThumbs"></div></div>
      <div class="q-login" id="qLogin" hidden><input class="in sm" id="qUser" placeholder="Tài khoản" autocomplete="off"><input class="in sm" id="qPass" type="password" placeholder="Mật khẩu" autocomplete="new-password"></div>
      <div class="q-bar"><button type="button" class="btn ghost icon" data-a="pick" title="Đính kèm ảnh (hoặc dán / kéo thả)">${ico('clip', 16)}</button><button type="button" class="btn ghost icon" data-a="login" title="Tài khoản đăng nhập (AI chỉ thấy {{user}} / {{pass}})">${ico('key', 16)}</button>
        <div class="seg q-depth" title="Số bước tối đa">${[[20, 'Nhanh'], [40, 'Chuẩn'], [70, 'Kỹ']].map(([v, l]) => `<button type="button" data-depth="${v}">${l}</button>`).join('')}</div>
        <span class="grow"></span><button type="submit" class="btn pri" id="qRun" title="Chạy (Ctrl + Enter)">${ico('play', 15)}Chạy</button></div>
      <input type="file" id="qFile" accept="image/png,image/jpeg,image/webp" multiple hidden>
    </form>
    <div class="q-hh"><b>Lịch sử</b><span class="grow"></span><button type="button" class="btn ghost icon sm" data-a="reload" title="Tải lại">${ico('loader', 14)}</button></div>
    <div class="q-hist" id="qHist"></div>
  </aside><main class="q-main" id="qMain"></main></div><div id="qToast" class="q-toast"></div><div id="qLb" class="q-lb" hidden></div>`;
  const f = $('#qNew');
  f.onsubmit = e => { e.preventDefault(); run(); };
  $('#qGoal').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } };
  $('#qGoal').onpaste = e => { const fs = [...(e.clipboardData?.files || [])].filter(x => /^image\//.test(x.type)); if (fs.length) { e.preventDefault(); addImgs(fs); } };
  const box = $('#qGoalBox'); box.ondragover = e => { e.preventDefault(); box.classList.add('drag'); }; box.ondragleave = () => box.classList.remove('drag');
  box.ondrop = e => { e.preventDefault(); box.classList.remove('drag'); addImgs([...(e.dataTransfer?.files || [])].filter(x => /^image\//.test(x.type))); };
  $('#qFile').onchange = e => { addImgs([...e.target.files]); e.target.value = ''; };
  ROOT.onclick = onClick;
  paintForm(); paintHist(); paintMain();
}
function paintForm() {
  ROOT.querySelectorAll('[data-depth]').forEach(b => b.classList.toggle('on', +b.dataset.depth === ST.depth));
  $('#qLogin').hidden = !ST.login; ROOT.querySelector('[data-a=login]').classList.toggle('on', ST.login);
  $('#qThumbs').innerHTML = ST.imgs.map((x, i) => `<span class="q-th"><img src="${x.url}" alt=""><button type="button" data-rm="${i}" title="Bỏ ảnh">${ico('x', 12)}</button></span>`).join('');
  $('#qRun').disabled = ST.busy;
}
function addImgs(fs) {
  for (const f of fs) { if (ST.imgs.length >= 6) { toast('Tối đa 6 ảnh'); break; } if (f.size > 8 * 1048576) { toast('Ảnh tối đa 8 MB'); continue; } ST.imgs.push({ f, url: URL.createObjectURL(f) }); }
  paintForm();
}
async function run() {
  const url = $('#qUrl').value.trim(), goal = $('#qGoal').value.trim();
  if (!url) { $('#qUrl').focus(); toast('Nhập link cần test'); return; }
  const fd = new FormData(); fd.append('url', url); fd.append('goal', goal); fd.append('max_steps', ST.depth);
  if (ST.login) { fd.append('user', $('#qUser').value); fd.append('pass', $('#qPass').value); }
  for (const x of ST.imgs) fd.append('img', x.f, x.f.name || 'anh.png');
  ST.busy = true; paintForm();
  try { const d = await post('start', fd); ST.imgs = []; $('#qGoal').value = ''; $('#qPass').value = ''; ST.sel = d.id; ST.tab = 'live'; ST.data = null; ST.frame = -1; await loadList(); select(d.id); }
  catch (e) { toast(e.message); }
  finally { ST.busy = false; paintForm(); }
}

/* ================= lịch sử ================= */
async function loadList() { try { ST.runs = (await get('list')).runs || []; } catch (e) { toast(e.message); } paintHist(); }
function paintHist() {
  const el = $('#qHist'); if (!el) return;
  if (!ST.runs.length) { el.innerHTML = `<div class="q-empty sm">${ico('flask', 22)}<span>Chưa có lượt test</span></div>`; return; }
  el.innerHTML = ST.runs.map(r => { const [dot, lb] = STL[r.status] || ['', r.status]; return `<button type="button" class="q-hi${r.id === ST.sel ? ' on' : ''}" data-run="${r.id}">
    <span class="dot ${dot}" title="${lb}"></span><span class="q-hm"><b>${esc(r.title || hostOf(r.url))}</b><span>${esc(hostOf(r.url))} · ${dm(r.created)} ${hm(r.created)}${r.by_name ? ' · ' + esc(r.by_name) : ''}</span></span>
    ${r.score != null ? `<span class="q-sc ${r.score >= 80 ? 'ok' : r.score >= 55 ? 'warn' : 'err'}">${r.score}</span>` : LIVE.has(r.status) ? `<span class="q-st">${r.step || 0}</span>` : ''}</button>`; }).join('');
}

/* ================= một lượt test ================= */
function select(id) { ST.sel = id; ST.data = null; ST.frame = -1; ST.ctrl = false; paintHist(); paintMain(); poll(); }
async function poll() {
  clearTimeout(ST.poll); if (!ST.sel || !ROOT) return;
  const id = ST.sel;
  try { const d = await get('state', '&id=' + id); if (id !== ST.sel) return; const was = ST.data?.state?.status; ST.data = d; paintMain(); if (was && was !== d.state.status) loadList(); }
  catch (e) { if (id === ST.sel) { ST.data = { error: e.message }; paintMain(); } return; }
  if (LIVE.has(ST.data?.state?.status)) ST.poll = setTimeout(poll, 1200);
}
function frameLoop() {
  clearTimeout(ST.fpoll); const img = $('#qFrame'), s = ST.data?.state; if (!img || !s) return;
  if (s.frame !== ST.frame) { ST.frame = s.frame; const n = new Image(); n.onload = () => { if ($('#qFrame') === img) img.src = n.src; }; n.src = `${API}?action=frame&id=${ST.sel}&f=${s.frame}`; }
  if (LIVE.has(s.status)) ST.fpoll = setTimeout(frameLoop, 450);
}
function paintMain() {
  const m = $('#qMain'); if (!m) return;
  if (!ST.sel) { m.innerHTML = `<div class="q-empty">${ico('flask', 34)}<div class="q-how">${[['globe', 'Dán link'], ['edit', 'Gõ yêu cầu · kèm ảnh'], ['play', 'Chạy'], ['file', 'Xem báo cáo']].map(([i, t], k) => `<span>${ico(i, 16)}${t}</span>${k < 3 ? ico('arrow', 14, 'mut') : ''}`).join('')}</div></div>`; return; }
  const d = ST.data;
  if (!d) { m.innerHTML = `<div class="q-empty">${ico('loader', 22, 'spin')}</div>`; return; }
  if (d.error) { m.innerHTML = `<div class="q-empty">${ico('alert', 22)}<span>${esc(d.error)}</span></div>`; return; }
  const s = d.state, R = d.report, [dot, lb] = STL[s.status] || ['', s.status], live = LIVE.has(s.status);
  const head = `<header class="q-rh"><span class="dot ${dot}"></span><div class="q-rt"><b>${esc(R?.title || s.title || hostOf(d.run.url))}</b><span>${esc(lb)} · ${s.step || 0}/${s.max || '–'} bước · ${esc(hostOf(d.run.url))}${s.ended ? ' · ' + secs(s.ended - (s.started || d.run.created)) : ''}</span></div><span class="grow"></span>
    ${R ? `<span class="q-sc lg ${R.verdict.score >= 80 ? 'ok' : R.verdict.score >= 55 ? 'warn' : 'err'}" title="${esc(R.verdict.status)}">${R.verdict.score}</span>` : ''}
    ${live && s.status !== 'reporting' ? `<button type="button" class="btn ghost icon${ST.ctrl ? ' on' : ''}" data-a="ctrl" title="Tự điều khiển màn hình">${ico('pointer', 16)}</button>${s.status === 'waiting' ? `<button type="button" class="btn pri sm" data-a="go">${ico('play', 14)}Tiếp tục</button>` : `<button type="button" class="btn ghost icon" data-a="pause" title="Tạm dừng">${ico('pause', 16)}</button>`}<button type="button" class="btn ghost icon" data-a="stop" title="Dừng và viết báo cáo">${ico('stop', 16)}</button>` : ''}
    ${R ? `<a class="btn ghost icon" href="${API}?action=docx&id=${ST.sel}" title="Tải báo cáo Word">${ico('download', 16)}</a>` : ''}<a class="btn ghost icon" href="${esc(d.run.url)}" target="_blank" rel="noopener" title="Mở trang">${ico('ext', 16)}</a><button type="button" class="btn ghost icon" data-a="del" title="Xoá lượt test">${ico('trash', 16)}</button></header>`;
  const tabs = `<div class="q-tabs">${[['live', 'monitor', 'Trực tiếp'], ['report', 'file', 'Báo cáo'], ['log', 'list', 'Nhật ký']].map(([k, i, l]) => `<button type="button" class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${ico(i, 15)}${l}${k === 'log' ? `<em>${(s.log || []).length}</em>` : k === 'report' && !R && live ? ico('loader', 12, 'spin') : ''}</button>`).join('')}</div>`;
  const keep = m.querySelector('.q-body')?.scrollTop || 0, sameTab = m.dataset.tab === ST.tab && m.dataset.id === ST.sel;
  if (ST.tab === 'live' && sameTab && $('#qFrame')) { m.querySelector('.q-rh').outerHTML = head; m.querySelector('.q-tabs').outerHTML = tabs; paintLiveSide(); frameLoop(); return; }
  m.innerHTML = head + tabs + `<div class="q-body">${ST.tab === 'live' ? liveHtml() : ST.tab === 'report' ? reportHtml() : logHtml()}</div>`;
  m.dataset.tab = ST.tab; m.dataset.id = ST.sel;
  if (sameTab) m.querySelector('.q-body').scrollTop = keep;
  if (ST.tab === 'live') { bindFrame(); paintLiveSide(); frameLoop(); }
}

/* ---------- Trực tiếp ---------- */
function liveHtml() {
  const d = ST.data;
  return `<div class="q-live"><div class="q-browser"><div class="q-chrome"><span class="q-lights"><i></i><i></i><i></i></span><span class="q-addr" id="qAddr">${esc(d.state.url || d.run.url)}</span></div>
    <div class="q-screen" id="qScreen" tabindex="0"><img id="qFrame" alt="Màn hình trình duyệt kiểm thử" draggable="false"><div class="q-ask" id="qAsk" hidden></div></div></div>
    <div class="q-side2"><div class="q-now" id="qNow"></div><div class="q-say"><input class="in" id="qSay" placeholder="Nhắn thêm cho agent…"><button type="button" class="btn icon" data-a="say" title="Gửi">${ico('send', 15)}</button></div><div class="q-mini" id="qMini"></div></div></div>`;
}
function paintLiveSide() {
  const d = ST.data, s = d.state, live = LIVE.has(s.status);
  const a = $('#qAddr'); if (a) a.textContent = s.url || d.run.url;
  const sc = $('#qScreen'); if (sc) sc.classList.toggle('ctl', ST.ctrl || s.status === 'waiting');
  const ask = $('#qAsk');
  if (ask) { ask.hidden = s.status !== 'waiting'; if (s.ask) ask.innerHTML = `${ico(s.ask.kind === 'login' ? 'key' : s.ask.kind === 'pause' ? 'pause' : 'help', 16)}<span>${esc(s.ask.message)}</span><button type="button" class="btn pri sm" data-a="go">${ico('play', 13)}Tiếp tục</button>`; }
  const now = $('#qNow');
  if (now) now.innerHTML = live ? `<div class="q-th2">${ico(s.status === 'waiting' ? 'help' : 'loader', 15, s.status === 'waiting' ? '' : 'spin')}<span>${esc(s.status === 'waiting' ? 'Chờ bạn thao tác' : s.thought || STL[s.status]?.[1] || '')}</span></div>${s.case ? `<span class="tag">${esc(s.case)}</span>` : ''}<div class="q-prog"><i style="width:${Math.min(100, Math.round((s.step || 0) / (s.max || 40) * 100))}%"></i></div>`
    : s.status === 'error' ? `<div class="q-th2 err">${ico('alert', 15)}<span>${esc(s.error || 'Lỗi')}</span></div>` : `<div class="q-th2 ok">${ico('check', 15)}<span>Đã xong — xem Báo cáo</span></div>${s.error ? `<span class="mut">${esc(s.error)}</span>` : ''}`;
  const mini = $('#qMini'); if (mini) mini.innerHTML = (s.log || []).slice(-8).reverse().map(x => `<div class="q-ml${x.ok ? '' : ' bad'}">${ico(KIND[x.kind] || 'pointer', 14)}<span>${esc(x.label)}</span>${x.ms ? `<em>${secs(x.ms)}</em>` : ''}</div>`).join('') || '<span class="mut">Chưa có bước nào</span>';
  const say = $('#qSay'); if (say) { say.disabled = !live; say.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendSay(); } }; }
}
/** Điều khiển tay: bấm / gõ / cuộn trên hình trực tiếp → gửi lệnh cho trình duyệt máy chủ (khi đăng nhập, OTP, hoặc bật Điều khiển). */
function bindFrame() {
  const sc = $('#qScreen'), img = $('#qFrame'); if (!sc) return;
  const can = () => ST.ctrl || ST.data?.state?.status === 'waiting';
  img.onclick = e => { if (!can()) return; const r = img.getBoundingClientRect(); cmd({ type: 'click', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); sc.focus(); };
  let buf = '', tm = 0; const flush = () => { if (buf) { cmd({ type: 'type', text: buf }); buf = ''; } };
  sc.onkeydown = e => {
    if (!can() || e.target !== sc) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { buf += e.key; clearTimeout(tm); tm = setTimeout(flush, 250); e.preventDefault(); return; }
    const k = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Delete: 'Delete' }[e.key];
    if (k) { e.preventDefault(); flush(); cmd({ type: 'key', key: k }); }
  };
  sc.onpaste = e => { if (!can()) return; const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); flush(); cmd({ type: 'type', text: t }); } };
  let wl = 0; sc.onwheel = e => { if (!can()) return; e.preventDefault(); const t = Date.now(); if (t - wl < 160) return; wl = t; cmd({ type: 'scroll', dy: Math.sign(e.deltaY) * 500 }); };
}
const cmd = c => post('cmd', c, '&id=' + ST.sel).catch(e => toast(e.message));
function sendSay() { const i = $('#qSay'), t = i?.value.trim(); if (!t) return; cmd({ type: ST.data?.state?.status === 'waiting' ? 'answer' : 'say', text: t }); i.value = ''; toast('Đã gửi cho agent', 1); }

/* ---------- Báo cáo ---------- */
function ring(v) { const c = 2 * Math.PI * 26, k = v >= 80 ? 'ok' : v >= 55 ? 'warn' : 'err'; return `<svg class="q-ring ${k}" width="68" height="68" viewBox="0 0 64 64" aria-label="${v}/100"><circle cx="32" cy="32" r="26" class="bg"/><circle cx="32" cy="32" r="26" class="fg" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 32 32)"/><text x="32" y="37" text-anchor="middle">${v}</text></svg>`; }
function metrics(s) {
  const M = s.metrics || {}, navs = M.navs || [], avg = k => navs.length ? Math.round(navs.reduce((a, x) => a + (x[k] || 0), 0) / navs.length) : 0, mx = k => Math.max(0, ...navs.map(x => x[k] || 0));
  const c = (i, l, v, bad) => `<div class="q-mt${bad ? ' bad' : ''}">${ico(i, 14)}<span>${l}</span><b>${v}</b></div>`;
  return `<div class="q-mts">${c('clock', 'Phản hồi đầu', avg('ttfb') ? avg('ttfb') + ' ms' : '–', avg('ttfb') > 800)}${c('gauge', 'Hiển thị chính (LCP)', mx('lcp') ? (mx('lcp') / 1000).toFixed(1) + ' s' : '–', mx('lcp') > 2500)}${c('layout', 'Xô lệch (CLS)', navs.length ? Math.max(...navs.map(x => x.cls || 0)).toFixed(2) : '–', Math.max(0, ...navs.map(x => x.cls || 0)) > 0.1)}${c('monitor', 'Tải xong', mx('load') ? (mx('load') / 1000).toFixed(1) + ' s' : '–', mx('load') > 4000)}${c('list', 'Request', M.requests || 0)}${c('clock', 'Request chậm', (M.slow || []).length, (M.slow || []).length > 3)}${c('bug', 'Lỗi JS / console', (M.console || []).length + (M.pageerror || []).length, (M.pageerror || []).length > 0)}${c('alert', 'HTTP lỗi', (M.http || []).length + (M.failed || []).length, (M.http || []).some(x => x.status >= 500))}</div>`;
}
function reportHtml() {
  const d = ST.data, R = d.report, s = d.state;
  if (!R) return LIVE.has(s.status) ? `<div class="q-empty">${ico('loader', 22, 'spin')}<span>Báo cáo có khi test xong</span></div>${notesHtml(s)}` : `<div class="q-empty">${ico('alert', 22)}<span>${esc(s.error || 'Chưa có báo cáo')}</span></div>${notesHtml(s)}`;
  const sec = (i, t, body, n) => body ? `<section class="q-sec"><h3>${ico(i, 16)}${t}${n != null ? `<em>${n}</em>` : ''}</h3>${body}</section>` : '';
  const pass = R.cases.filter(c => c.result === 'pass').length;
  return `<div class="q-rep">
    <div class="q-verdict">${ring(R.verdict.score)}<div><b class="q-vs ${R.verdict.score >= 80 ? 'ok' : R.verdict.score >= 55 ? 'warn' : 'err'}">${esc(R.verdict.status)}</b><p>${esc(R.verdict.summary)}</p><div class="q-chips"><span class="tag">${ico('check', 12)}${pass}/${R.cases.length} trường hợp đạt</span><span class="tag">${ico('bug', 12)}${R.issues.length} vấn đề</span><span class="tag">${ico('pointer', 12)}${s.step} bước</span></div></div></div>
    ${sec('flask', 'Chức năng', `<p class="q-feat">${esc(R.feature)}</p><ol class="q-mech">${R.mechanism.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`)}
    ${sec('list', 'Trường hợp kiểm thử', R.cases.length ? `<table class="q-tb"><thead><tr><th></th><th>Trường hợp</th><th>Các bước</th><th>Mong đợi</th><th>Thực tế</th></tr></thead><tbody>${R.cases.map(c => { const [i, k, l] = RES[c.result] || RES.skip; return `<tr><td><span class="q-res ${k}" title="${l}">${ico(i, 13)}</span></td><td><b>${esc(c.name)}</b></td><td class="mut">${esc(c.steps)}</td><td>${esc(c.expected)}</td><td>${esc(c.actual)}</td></tr>`; }).join('')}</tbody></table>` : '', R.cases.length)}
    ${sec('bug', 'Lỗi & điểm cần cải thiện', R.issues.length ? `<div class="q-iss">${R.issues.map(x => { const [i, l] = NOTE[x.type] || NOTE.bug; return `<div class="q-is"><span class="dot ${SEV[x.severity] ?? ''}" title="Mức ${esc(x.severity)}"></span><div><div class="q-it"><span class="tag">${ico(i, 12)}${l}</span><b>${esc(x.title)}</b></div><p class="mut">${esc(x.evidence)}</p><p class="q-fix">${ico('arrow', 13)}${esc(x.fix)}</p></div></div>`; }).join('')}</div>` : '', R.issues.length)}
    ${sec('gauge', 'Tốc độ & kỹ thuật', `${metrics(s)}<p>${esc(R.perf.summary)}</p>${R.perf.items.length ? `<ul class="q-ul">${R.perf.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${R.tech.length ? `<div class="q-tech">${R.tech.map(t => `<div><span>${esc(t.problem)}</span>${ico('arrow', 13)}<b>${esc(t.suggest)}</b></div>`).join('')}</div>` : ''}`)}
    ${sec('star', 'Nên test thêm', R.next.length ? `<ul class="q-ul">${R.next.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '')}
    <div class="q-foot"><a class="btn pri" href="${API}?action=docx&id=${ST.sel}">${ico('download', 15)}Tải báo cáo Word</a></div></div>`;
}
function notesHtml(s) { const n = s.notes || []; return n.length ? `<div class="q-rep"><section class="q-sec"><h3>${ico('note', 16)}Phát hiện trong lúc test<em>${n.length}</em></h3><div class="q-iss">${n.map(x => `<div class="q-is"><span class="dot ${SEV[x.severity] ?? ''}"></span><div><div class="q-it"><span class="tag">${ico((NOTE[x.type] || NOTE.bug)[0], 12)}${(NOTE[x.type] || NOTE.bug)[1]}</span><b>${esc(x.title)}</b></div><p class="mut">${esc(x.detail)}</p></div></div>`).join('')}</div></section></div>` : ''; }

/* ---------- Nhật ký ---------- */
function logHtml() {
  const s = ST.data.state, L = s.log || [], M = s.metrics || {};
  const rows = L.map(x => `<tr class="${x.ok ? '' : 'bad'}${x.kind === 'note' ? ' nt' : ''}" ${x.shot ? `data-shot="${esc(x.shot)}"` : ''}><td class="num mut">${x.n}</td><td class="num mut">${secs(x.t)}</td><td><span class="q-k">${ico(KIND[x.kind] || 'pointer', 14)}</span></td><td><b>${esc(x.label)}</b>${x.res ? `<div class="mut">${esc(x.res)}</div>` : ''}</td><td>${x.case ? `<span class="tag">${esc(x.case)}</span>` : ''}</td><td class="num">${x.ms ? secs(x.ms) : ''}</td><td>${x.shot ? ico('image', 14, 'mut') : ''}</td></tr>`).join('');
  const tech = (t, a, f) => a?.length ? `<details class="q-det"><summary>${t}<em>${a.length}</em></summary><ul>${a.slice(-30).map(f).join('')}</ul></details>` : '';
  return `<table class="q-tb q-log"><thead><tr><th>#</th><th>Lúc</th><th></th><th>Thao tác · kết quả</th><th>Trường hợp</th><th>Mất</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="mut">Chưa có bước nào</td></tr>'}</tbody></table>
    <div class="q-techs">${tech('Lỗi JavaScript', M.pageerror, x => `<li>${esc(x.text)}</li>`)}${tech('Lỗi console', M.console, x => `<li>${esc(x.text)}</li>`)}${tech('HTTP lỗi', M.http, x => `<li><b>${x.status}</b> ${esc(x.method)} ${esc(x.url)}</li>`)}${tech('Request hỏng', M.failed, x => `<li>${esc(x.err)} · ${esc(x.url)}</li>`)}${tech('Request chậm (> 1,5 s)', M.slow, x => `<li><b>${secs(x.ms)}</b> ${esc(x.method)} ${esc(x.url)}</li>`)}${tech('Tốc độ từng trang', M.navs, x => `<li>${esc(x.url)} · phản hồi ${x.ttfb} ms · DOM ${x.dcl} ms · tải ${x.load} ms · LCP ${x.lcp} ms · CLS ${x.cls} · ${x.size} KB</li>`)}</div>`;
}
function lightbox(name) { const lb = $('#qLb'); lb.innerHTML = `<img src="${API}?action=img&id=${ST.sel}&n=${encodeURIComponent(name)}" alt=""><button type="button" class="btn icon" data-a="lbx" title="Đóng">${ico('x', 16)}</button>`; lb.hidden = false; }

/* ================= sự kiện ================= */
async function onClick(e) {
  const t = e.target;
  const rm = t.closest('[data-rm]'); if (rm) { ST.imgs.splice(+rm.dataset.rm, 1); paintForm(); return; }
  const dp = t.closest('[data-depth]'); if (dp) { ST.depth = +dp.dataset.depth; paintForm(); return; }
  const rn = t.closest('[data-run]'); if (rn) { select(rn.dataset.run); return; }
  const tb = t.closest('[data-tab]'); if (tb) { ST.tab = tb.dataset.tab; paintMain(); return; }
  const sh = t.closest('[data-shot]'); if (sh) { lightbox(sh.dataset.shot); return; }
  if (t.closest('#qLb') && (t.closest('[data-a=lbx]') || t.id === 'qLb')) { $('#qLb').hidden = true; return; }
  const a = t.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'pick') $('#qFile').click();
  else if (a === 'login') { ST.login = !ST.login; paintForm(); if (ST.login) $('#qUser').focus(); }
  else if (a === 'reload') loadList();
  else if (a === 'ctrl') { ST.ctrl = !ST.ctrl; paintMain(); if (ST.ctrl) { $('#qScreen')?.focus(); toast('Bấm, gõ, cuộn trên màn hình để tự thao tác', 1); } }
  else if (a === 'go') { await cmd({ type: 'continue' }); ST.ctrl = false; setTimeout(poll, 300); }
  else if (a === 'pause') { await cmd({ type: 'pause' }); setTimeout(poll, 300); }
  else if (a === 'stop') { await cmd({ type: 'stop' }); toast('Đang dừng — agent viết báo cáo', 1); setTimeout(poll, 300); }
  else if (a === 'say') sendSay();
  else if (a === 'del') { if (!confirm('Xoá lượt test này (ảnh, nhật ký, báo cáo)?')) return; try { await post('delete', {}, '&id=' + ST.sel); ST.sel = ''; ST.data = null; await loadList(); paintMain(); } catch (er) { toast(er.message); } }
}

/* ================= gắn vào HireX ================= */
export function mount(root) {
  ROOT = root; ON = new AbortController();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#qLb')?.hidden) $('#qLb').hidden = true; }, { signal: ON.signal });
  render(); loadList().then(() => { const r = ST.runs.find(x => LIVE.has(x.status)) || (ST.sel && ST.runs.find(x => x.id === ST.sel)); if (r) select(r.id); });
  const t = setInterval(() => { if (ST.runs.some(x => LIVE.has(x.status))) loadList(); }, 8000);
  ON.signal.addEventListener('abort', () => clearInterval(t));
  return () => { clearTimeout(ST.poll); clearTimeout(ST.fpoll); ON?.abort(); ON = null; ROOT = null; };
}
