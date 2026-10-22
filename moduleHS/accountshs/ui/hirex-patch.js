/* HireX · vá thêm cho trang gốc v7 — nạp SAU toàn bộ JS gốc (build_ui.py chèn vào cuối trang).
   Chỉ bọc hàm/ACT của bản gốc (như các khối vá rNN), không sửa mã Python gốc.
   1. Tổng quan: bấm bộ phận / owner trong cây → combobox Phạm vi trên cùng nhảy theo.
   2. Tab Tất cả: mặc định mở Tổng quan; bỏ thanh công cụ riêng — nút Tổng quan/Chi tiết + Xuất Excel nằm ở đầu khung chi tiết.
   3. Tổng quan: tab "Tải riêng" chưa nạp vẫn có số đếm (server gom, không tải dòng về).
   4. Tổng quan: tiêu đề cột đầu của cây = bộ chọn nhóm nền tảng (Tất cả nền tảng / Tài khoản / Dữ liệu Marketing…);
      các dòng bên dưới là phạm vi (Toàn hệ thống › bộ phận › owner) — khớp đúng tên trong combobox Phạm vi.
   5. Tổng quan: ô chọn trong cây trượt mượt sang dòng mới (không còn nền hover).
   6. Thanh tab: tab "Tải riêng" chưa nạp vẫn có số (máy chủ đếm), cộng vào nhóm và Tất cả.
   7. Nạp ngầm tab "Tải riêng" lúc rảnh (đi cùng iframe nền host.tsx của HireX).
   8. Luôn mới — thời gian thực: máy chủ đẩy thay đổi qua Server-Sent Events (server/feed.ts) ngay khi có ghi;
      trình duyệt áp thẳng delta được đẩy (không hỏi lại máy chủ), lỡ đoạn nào thì tự tải bù. Rớt kết nối: EventSource tự nối lại,
      trong lúc đó hỏi ahs_ver như cũ (4 giây khi xem, 20 giây khi chạy nền); đang nối tốt thì chỉ hỏi kiểm tra 60 giây/lần.
      Đang thao tác (popup, form, chọn dòng, đang gõ) thì để dành, xong mới vẽ. Dựng sẵn bảng mọi tab cả khi đang ở Tổng quan. */
(() => {
  const LS = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch (e) { return null } };

  /* ── 4. nhóm tab ── */
  let OVG = LS('hx.ovg') || '';
  const ALLG = 'Tất cả nền tảng';
  const ovGroups = () => tabGroups().map(x => x.g ? { k: 'g:' + x.g, name: x.g, ids: x.ts.map(t => t.id) } : { k: 't:' + x.t.id, name: x.t.name, ids: [x.t.id] });
  const ovAllow = () => { const g = OVG && ovGroups().find(x => x.k === OVG); return g ? new Set(g.ids) : null };
  const setG = k => { OVG = k; LS('hx.ovg', k); renderBody() };
  ACT.hxovg = el => {
    const r = el.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [{ label: ALLG, check: !OVG, fn: () => setG('') }, ...ovGroups().map(g => ({ label: g.name, check: OVG === g.k, fn: () => setG(g.k) }))]);
  };

  /* ── 3. tab tải riêng chưa nạp: số đếm gom ở server (ov_lazy) ── */
  let OVL = { k: '', ts: 0, rows: [], busy: 0 };
  const lzTabs = () => (S.meta && S.meta.tabs || []).filter(t => +t.lazy && !(S.lz && S.lz.has(t.id))).map(t => t.id);
  function ovLazyLoad() {
    const tabs = lzTabs(); if (!tabs.length) return;
    const [a, b] = ovRange(), k = tabs.join(',') + '|' + a + '|' + b;
    if (OVL.busy || (OVL.k === k && Date.now() - OVL.ts < 60000)) return;
    OVL.busy = 1;
    api('ov_lazy', { tabs, since: a, until: b })
      .then(r => { OVL = { k, ts: Date.now(), rows: r.rows || [], busy: 0 }; renderFoot(); if (ovOn()) renderBody() })
      .catch(() => { OVL.busy = 0; OVL.ts = Date.now(); OVL.k = k });
  }

  let LASTD = null;
  const _ovData = ovData;
  ovData = function () {
    const D = _ovData(), C = D.C, al = ovAllow();
    const [pa, pb] = ovRange(), lz = new Set(lzTabs()), rk = OVL.k.endsWith('|' + pa + '|' + pb);
    /* tab đang nạp dở: số lấy từ máy chủ (đủ) → bỏ phần dòng đã về để không đếm 2 lần */
    const part = OVL.rows.length ? new Set([...LZQ.keys()].filter(t => lz.has(t))) : new Set();
    if (part.size) (typeof ordAll === 'function' ? ordAll() : S.accs).forEach(a => {
      if (!part.has(a.tab_id)) return;
      const h = rpH(a), ow = a.owner_id && I.own[a.owner_id], nw = a.created >= pa && a.created < pb;
      ['all', 'd' + a.dept_id, ...(ow ? ow.path.map(i => 'o' + i) : ['u' + a.dept_id])].forEach(k => {
        const c = C[k]; if (!c) return;
        if (c[a.tab_id]) c[a.tab_id][h]--; if (c.T) c.T[h]--;
        if (nw && c.dt) { c.dt[a.tab_id] = (c.dt[a.tab_id] || 0) - 1; c.dt.T = (c.dt.T || 0) - 1 }
      });
    });
    OVL.rows.forEach(([t, d, o, s, n, nn]) => {
      if (!lz.has(t) || !I.tab[t]) return;
      const h = (I.status[s] && I.status[s].h) || 'n', ow = o && I.own[o];
      ['all', 'd' + d, ...(ow ? ow.path.map(i => 'o' + i) : ['u' + d])].forEach(k => {
        const c = C[k] ??= {}; (c[t] ??= rpE())[h] += n; (c.T ??= rpE())[h] += n;
        if (rk && nn) { const z = c.dt ??= {}; z[t] = (z[t] || 0) + nn; z.T = (z.T || 0) + nn }
      });
    });
    if (al) Object.values(C).forEach(c => {
      const T = rpE();
      Object.keys(c).forEach(k => { if (k === 'T' || k === 'dt') return; if (!al.has(+k)) { delete c[k]; return } ['g', 'w', 'b', 'n'].forEach(h => T[h] += c[k][h] || 0) });
      c.T = T;
      if (c.dt) { let s = 0; Object.keys(c.dt).forEach(k => { if (k === 'T') return; if (!al.has(+k)) delete c.dt[k]; else s += c.dt[k] }); c.dt.T = s }
    });
    /* dựng lại danh sách nền tảng + cây (giống ovData gốc) sau khi gộp / lọc */
    D.tabs = S.meta.tabs.filter(t => C.all && C.all[t.id]);
    const has = k => al ? !!C[k] && ovN(C[k].T) > 0 : !!C[k], rows = [D.rows[0]];
    S.meta.depts.forEach(d => {
      const kd = 'd' + d.id, x = OVX.has(kd);
      rows.push({ k: kd, lv: 0, cls: 'r1', d: d.id, name: d.name, tg: kd, x, lead: `<i class="dot" style="background:${d.color}"></i>` });
      if (x) return;
      treeOrder(d.id).forEach(({ o, d: lv }) => { if (has('o' + o.id)) rows.push({ k: 'o' + o.id, lv: lv + 1, d: d.id, o: o.id, name: o.name, lead: avatar(o) }) });
      if (has('u' + d.id)) rows.push({ k: 'u' + d.id, lv: 1, cls: 'ru', d: d.id, name: 'Dùng chung', lead: ico('users', 15) });
    });
    D.rows = rows; LASTD = D;
    return D;
  };

  /* ── 5. ô chọn trong cây trượt mượt sang dòng mới (đúng vị trí/kích thước/màu nền ::before của .ovi.on → theme nào cũng khớp) ── */
  const geo = el => {
    const b = getComputedStyle(el, '::before'), t = parseFloat(b.top) || 0, l = parseFloat(b.left) || 0;
    return { y: el.offsetTop + t, x: el.offsetLeft + l, w: el.offsetWidth - l - (parseFloat(b.right) || 0), h: el.offsetHeight - t - (parseFloat(b.bottom) || 0), bg: b.backgroundColor, rd: b.borderRadius, r0: el.classList.contains('r0') };
  };
  function slide(m, g0) {
    if (!g0 || g0.r0 || document.documentElement.classList.contains('ca-off')) return;
    const tb = m.querySelector('.ovtb'), el = tb && tb.querySelector('.ovi.on');
    if (!el || el.classList.contains('r0')) return;
    const g1 = geo(el);
    if (Math.abs(g1.y - g0.y) < 1 && Math.abs(g1.x - g0.x) < 1) return;
    const i = document.createElement('i');
    i.className = 'hx-ovind';
    i.style.cssText = `top:${g0.y}px;left:${g0.x}px;width:${g0.w}px;height:${g0.h}px;background:${g1.bg};border-radius:${g1.rd}`;
    tb.prepend(i); tb.classList.add('hx-sl');
    i.getBoundingClientRect();
    i.style.transform = `translateY(${g1.y - g0.y}px)`; i.style.left = g1.x + 'px'; i.style.width = g1.w + 'px'; i.style.height = g1.h + 'px';
    let done = false;
    const end = () => { if (done) return; done = true; i.remove(); tb.classList.remove('hx-sl') };
    i.addEventListener('transitionend', e => { if (e.propertyName === 'transform') end() });
    setTimeout(end, 420);
  }
  function header(m) {
    const th = m.querySelector('.ovw:not(.ovsk) .ovth>span:first-child'), gs = ovGroups();
    if (!th || gs.length < 2) return;
    const g = gs.find(x => x.k === OVG);
    th.classList.add('hx-ovgh');
    th.innerHTML = `<button class="ovpb hx-ovg" data-a="hxovg" aria-haspopup="true" title="Đếm theo nhóm nền tảng">${esc(g ? g.name : ALLG)}${ico('chevd', 13)}</button>`;
  }
  /* nút Tổng quan/Chi tiết + Xuất Excel: chuyển từ thanh công cụ (đã bỏ) lên đầu khung chi tiết */
  function tools(m) {
    const ph = m.querySelector('.ovw:not(.ovsk) .ovph'); if (!ph) return;
    const g = OVG && ovGroups().find(x => x.k === OVG);
    if (g && !ph.querySelector('small')) ph.lastElementChild.insertAdjacentHTML('beforeend', `<small>${esc(g.name)}</small>`);
    ph.insertAdjacentHTML('beforeend', `<div class="hx-ovtools">${ovSw()}<button class="btn icon ghost" data-a="ovxls" title="Xuất Excel" aria-label="Xuất Excel">${ico('download', 16)}</button></div>`);
  }
  /* ô "Dùng chung" của Toàn hệ thống: bản gốc đếm trên dòng đã nạp → tính lại từ cây (gồm tab tải riêng, theo nhóm tab) */
  function kpiShared(m) {
    if (OVS !== 'all' || !LASTD) return;
    const c = [...m.querySelectorAll('.ovks .ovkc')].find(x => x.firstElementChild && x.firstElementChild.textContent === 'Dùng chung');
    if (!c) return;
    const n = S.meta.depts.reduce((s, d) => s + ovN(LASTD.C['u' + d.id] && LASTD.C['u' + d.id].T), 0), T = ovN(LASTD.C.all && LASTD.C.all.T);
    c.querySelector('b').textContent = n.toLocaleString('vi'); c.querySelector('em').textContent = rpPct(n, T) + '%';
  }
  const _ro = renderOverview;
  renderOverview = function (m) {
    const on = m.querySelector('.ovtb .ovi.on'), g0 = on && geo(on);
    ovLazyLoad();
    _ro(m);
    header(m);
    tools(m);
    kpiShared(m);
    slide(m, g0);
  };

  /* ── 2. Tổng quan là mặc định; ở chế độ Tổng quan không còn thanh công cụ ── */
  S.ov = true;
  const _st = setTab;
  setTab = function (t) { if (t === 'all' && S.tab !== 'all' && !NAV.ovfix && !NAV.lock) S.ov = true; return _st.apply(this, arguments) };
  const _rb = renderBar;
  renderBar = function () {
    if (ovOn()) { const el = $('#bar'); if (el) { el.innerHTML = ''; el.style.display = 'none' } return }
    return _rb.apply(this, arguments);
  };

  /* ── 6. thanh tab: tab "Tải riêng" chưa nạp vẫn hiện số (theo phạm vi đang chọn), cộng cả vào nhóm và Tất cả ── */
  const lzCount = () => {
    const lz = new Set(lzTabs()), c = {};
    OVL.rows.forEach(([t, d, o, , n]) => { if (lz.has(t) && (S.dept === 'all' || d == S.dept) && (!I.scO || I.scO.has(o))) c[t] = (c[t] || 0) + n });
    return c;
  };
  const em = (el, n, lazy) => {
    if (!el) return; let e = el.querySelector('em');
    if (!e) { e = document.createElement('em'); el.append(e) }
    e.textContent = n; if (lazy) { e.classList.add('hx-lz'); el.title = (el.title || '') + ' · chưa tải dòng, số lượng lấy từ máy chủ' }
  };
  /* tab đầu tiên: "Tổng quan", không hiện số (số nằm ngay trong Tổng quan) */
  const allTab = () => {
    const b = document.querySelector('#tb [data-a=tab][data-id=all]'); if (!b) return;
    const sp = b.querySelector('span'); if (sp) sp.textContent = 'Tổng quan';
    b.querySelector('em')?.remove(); b.title = 'Tổng quan';
  };
  const _rf = renderFoot;
  renderFoot = function () {
    const out = _rf.apply(this, arguments);
    try {
      const lt = lzTabs(); if (!lt.length) { allTab(); return out }
      ovLazyLoad(); if (!OVL.rows.length) { allTab(); return out }
      const lc = lzCount(), sc = scoped(), ld = typeof cntBy === 'function' ? cntBy(sc, 'tab_id', scopeKey()) : sc.reduce((c, a) => (c[a.tab_id] = (c[a.tab_id] || 0) + 1, c), {});
      const n = id => lt.includes(id) ? (lc[id] || 0) : (ld[id] || 0), tb = $('#tb');
      lt.forEach(id => tb.querySelectorAll(`[data-a=tab][data-id="${id}"]`).forEach(el => em(el, n(id), true)));
      tabGroups().forEach(x => { if (x.ts && x.ts.some(t => lt.includes(t.id))) tb.querySelectorAll(`[data-a=tabg2]`).forEach(el => { if (el.dataset.g === x.g) em(el, x.ts.reduce((s, t) => s + n(t.id), 0), true) }) });
    } catch (e) { console.warn('hx tab counts', e) }
    allTab();
    return out;
  };

  /* ── 8. luôn mới + dựng sẵn ── */
  const HX = { active: window.top === window, v: null, busy: 0, pend: 0, tm: 0 };
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.hx !== 'accounts-active') return;
    const was = HX.active; HX.active = !!e.data.on;
    if (HX.active && !was) syncTick();
    // iframe vừa hiện / vừa ẩn: tab đang nạp dở → hiện / ẩn khung tải (dòng giả + thẻ tiến độ góc dưới phải sau 5 giây)
    if (HX.active !== was && HX.lzView) HX.lzView();
  });
  const uiBusy = () => !!document.querySelector('.pop,.overlay,#modal,#sheet,#dvz,#nbox,#dbox') || (S.sel && S.sel.size > 0) || S.focus != null
    || (document.activeElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable));
  /* vẽ lại sau khi dữ liệu đổi ngầm: đang thao tác thì để dành */
  const bgRender = (all = true) => { if (HX.active && uiBusy()) { HX.pend = 1; return } HX.pend = 0; if (all) renderAll(); else { renderFoot(); if (ovOn()) renderBody() } };
  const verNow = async () => { const r = await fetch('/api/ver', { cache: 'no-store' }); if (!r.ok) throw new Error('ver'); return (await r.json()).ver };
  async function syncTick() {
    clearTimeout(HX.tm);
    try {
      if (!HX.busy && !HX.bulk && S.ts && S.meta) {
        HX.busy = 1;
        const v = await verNow();
        if (HX.v === null) HX.v = v;
        else if (v !== HX.v) { HX.v = v; OVL.ts = 0; await load(); HX.pend = 1 }   // OVL.ts = 0: số đếm tab chưa nạp hỏi lại
        if (HX.pend) bgRender();
      }
    } catch (e) { /* mất mạng / phiên hết hạn: lần sau thử lại */ }
    finally { HX.busy = 0; HX.tm = setTimeout(syncTick, RT2.ok ? 60000 : HX.active && !document.hidden ? 4000 : 20000) }
  }

  /* ── 8b. thời gian thực (SSE) ── */
  const RT2 = { es: null, ok: false, fails: 0, q: [], run: 0, again: 0 };
  window.HXRT = RT2;   // xem trạng thái khi cần (console: HXRT.ok)
  function rtConnect() {
    if (!window.EventSource || RT2.es) return;
    let es; try { es = new EventSource('/api/events') } catch (e) { return }
    RT2.es = es;
    es.addEventListener('hello', () => { RT2.ok = true; RT2.fails = 0; syncTick() });      // vừa nối (lại): tự bù đoạn có thể đã lỡ
    es.addEventListener('delta', e => {
      let d; try { d = JSON.parse(e.data) } catch (x) { return }
      RT2.q.push(d); if (RT2.q.length > 30) RT2.q.shift();
      if (d.ver != null) HX.v = d.ver; OVL.ts = 0;
      if (!(d.ts <= S.ts)) pushApply();
    });
    es.onerror = () => {
      RT2.ok = false;
      if (es.readyState === 2) { RT2.es = null; RT2.fails++; setTimeout(rtConnect, Math.min(30000, 1000 * 2 ** Math.min(5, RT2.fails))) }   // 0 = trình duyệt đang tự nối lại
    };
  }
  /* áp delta được đẩy qua đúng đường load() của bản gốc (vá tăng dần, chỉ mục, Cú vọ…): load() xin "delta?since=…" → trả luôn từ hàng đợi */
  async function pushApply() {
    if (RT2.run || !S.ts || HX.bulk) { RT2.again = 1; return }
    RT2.run = 1;
    let card = null;
    try {
      do {
        RT2.again = 0;
        // chính mình vừa sửa hàng loạt (đã nạp xong) → không hiện thẻ "đồng bộ" cho thay đổi của chính mình
        const big = RT2.q.filter(d => d.big && d.ts > S.ts && !(HX.selfVer != null && d.ver != null && d.ver <= HX.selfVer)).reduce((n, d) => n + d.big, 0);
        if (big && !card && HX.active) card = opCard(`Đang đồng bộ ${nf(big)} dòng thay đổi`, true);
        await load(); HX.pend = 1; bgRender();
      } while (RT2.again)
      if (card) card.ok('Đã đồng bộ');
    }
    catch (e) { if (card) card.fail('Chưa đồng bộ được — sẽ thử lại') }
    finally { RT2.run = 0 }
  }
  /** gộp các delta đã đẩy (liền mạch từ `since`) thành 1 delta riêng cho trình duyệt này; thiếu đoạn → null (tải từ máy chủ) */
  function takePushed(since) {
    const evs = RT2.q.filter(d => d.ts > since).sort((a, b) => a.from - b.from);
    if (!evs.length || evs[0].from > since + 0.05 || evs.some(d => d.big)) return null;   // thay đổi lớn: tải từ máy chủ
    for (let i = 1; i < evs.length; i++) if (evs[i].from > evs[i - 1].ts + 0.05) return null;
    const acc = new Map(), del = new Set(), lk = new Map();
    for (const d of evs) {
      for (const id of d.deleted || []) { acc.delete(id); del.add(id) }
      for (const a of d.accounts || []) { acc.set(a.id, a); del.delete(a.id) }
      for (const l of d.links || []) lk.set(l.id, l);
    }
    const last = evs[evs.length - 1], ex = new Set(lzTabs());   // tab tải riêng chưa nạp: dòng thuộc tab đó coi như rời trình duyệt
    const keep = [];
    for (const a of acc.values()) { if (ex.has(a.tab_id)) del.add(a.id); else keep.push(a) }
    const ok = new Set(keep.map(a => a.id)), known = x => ok.has(x) || (!!I.acc[x] && !del.has(x));
    RT2.q = RT2.q.filter(d => d.ts > last.ts);
    return { meta: last.meta, devices: last.devices, accounts: keep, links: [...lk.values()].filter(l => known(l.src) && known(l.dst)), deleted: [...del], ts: last.ts, delta: 1 };
  }
  { const _api = api; api = function (path, body) {
      if (!body && typeof path === 'string' && path.startsWith('delta?since=') && RT2.q.length) { const d = takePushed(parseFloat(path.slice(12))); if (d) return Promise.resolve(d) }
      return _api.apply(this, arguments);
    } }
  /* tự mình ghi (mut) thì bản gốc đã nạp lại → ghi nhận phiên bản mới, khỏi nạp thêm lần nữa */
  const _mut = mut;
  mut = async function () { const r = await _mut.apply(this, arguments); OVL.ts = 0; try { HX.v = await verNow() } catch (e) { /* bỏ qua */ } return r };
  addEventListener('visibilitychange', () => { if (!document.hidden) syncTick() });
  /* dựng sẵn mọi tab bảng lúc rảnh: bản gốc chỉ chạy khi đang đứng ở một bảng → cho chạy cả khi đang ở Tổng quan (mặc định) */
  warmRun = function () {
    if (WARM.busy || typeof S === 'undefined' || !S.accs || !S.accs.length || (!isTbl() && !ovOn()) || S.sel.size || S.focus != null || document.querySelector('.pop,.overlay,#dvz')) return;
    const sigFor = t => { const o = { tab: S.tab, q: S.q, st: S.st, tf: S.tf, idf: S.idf, devf: S.devf, page: S.page }; Object.assign(S, { tab: t, q: '', st: new Set(), tf: new Set(), idf: null, devf: null, page: 1 }); try { return keepSig() } finally { Object.assign(S, o) } };
    const todo = ['all', ...S.meta.tabs.filter(t => !+t.lazy || (S.lz && S.lz.has(t.id))).map(t => t.id)].filter(t => t !== S.tab && !KEEP.m.has(sigFor(t)));
    if (!todo.length) return; WARM.busy = true;
    const step = () => {
      if (!todo.length || typeof S === 'undefined' || S.sel.size || S.focus != null || (!isTbl() && !ovOn())) { WARM.busy = false; return }
      const t = todo.shift(); if (t === S.tab || KEEP.m.has(sigFor(t))) { step(); return }
      warmOne(t); (window.requestIdleCallback || (f => setTimeout(f, 40)))(step, { timeout: 2000 });
    };
    step();
  };
  /* báo cho khung HireX (host.tsx): khung trang đã vẽ xong → thôi hiện khung giả của HireX, hiện trang thật */
  (function ready() {
    if (!document.querySelector('#tb .tab')) { setTimeout(ready, 30); return }
    try { if (window.parent !== window) window.parent.postMessage({ hx: 'accounts-ready' }, location.origin) } catch (e) { /* bỏ qua */ }
  })();
  (function boot() { if (!(S.ts && S.meta && S.accs && S.accs.length)) { setTimeout(boot, 500); return } rtConnect(); setTimeout(syncTick, 1500); warmLater() })();

  /* ── 9. thao tác hàng loạt rất lớn (sửa / đổi trạng thái / owner / thiết bị / xoá hàng nghìn dòng) ──
     Trước: 1 lệnh duy nhất cho 19.000 dòng → màn hình đứng im, không biết đang chạy hay đã hỏng.
     Giờ: chia lô (1.000–2.000 dòng / lệnh), thẻ tiến độ góc dưới phải "Đang cập nhật 6.000 / 19.000 dòng"; hỏng giữa chừng → báo rõ đã xong
     bao nhiêu dòng, nạp lại đúng hiện trạng. Xong hết mới nạp phần thay đổi 1 lần rồi vẽ lại (bảng chỉ vẽ vùng đang thấy).
     Máy chủ: chụp bản an toàn ở lô đầu, ghi nhật ký 1 lần ở lô cuối (đủ số dòng). */
  function opCard(label, spin) {
    const el = document.createElement('div');
    el.className = 'ldw on hx-op'; el.setAttribute('role', 'status');
    el.innerHTML = '<div class="ldw-t"><span class="ldw-ph"></span><b class="ldw-p"></b></div><div class="ldw-bar"><div class="ldw-f"></div></div><div class="ldw-s"><span class="ldw-g"></span><span class="ldw-x"></span></div>';
    document.body.appendChild(el);
    const $q = s => el.querySelector(s), close = ms => setTimeout(() => { el.classList.add('off'); setTimeout(() => el.remove(), 200) }, ms);
    $q('.ldw-ph').textContent = label;
    const C = {
      set(done, tot, sub) { const p = tot ? Math.min(100, 100 * done / tot) : 0; $q('.ldw-f').style.transform = `scaleX(${(p / 100).toFixed(4)})`; $q('.ldw-p').textContent = Math.floor(p) + '%'; $q('.ldw-x').textContent = sub || `${nf(done)} / ${nf(tot)} dòng` },
      stage(t) { $q('.ldw-g').textContent = t },
      ok(t) { el.classList.add('hx-ok'); $q('.ldw-ph').textContent = t; $q('.ldw-p').textContent = '✓'; $q('.ldw-f').style.transform = 'scaleX(1)'; $q('.ldw-g').textContent = ''; close(1600) },
      fail(t) { el.classList.add('hx-err'); $q('.ldw-ph').textContent = 'Không hoàn tất'; $q('.ldw-p').textContent = ''; $q('.ldw-g').textContent = ''; $q('.ldw-x').textContent = t; close(8000) },
    };
    if (spin) { el.classList.add('hx-spin'); C.stage('Đang tải phần thay đổi') } else C.stage('Đang ghi');
    return C;
  }
  const BIGOPS = { mass_set: 'ids', rows_set: 'items', status_set: 'ids', owner_set: 'ids', device_set: 'ids', delete_accounts: 'ids' };
  const BIG_MIN = 1500;
  { const _m = mut; mut = async function (path, body) {
      const key = BIGOPS[path], arr = key && body && Array.isArray(body[key]) ? body[key] : null;
      if (!arr || arr.length <= BIG_MIN) return _m.apply(this, arguments);
      const n = arr.length, CH = path === 'rows_set' ? 1000 : 2000, parts = Math.ceil(n / CH), del = path === 'delete_accounts';
      const card = opCard(`${del ? 'Đang xoá' : 'Đang cập nhật'} ${nf(n)} dòng`), res = {};
      let done = 0; HX.bulk = 1; card.set(0, n);
      try {
        for (let i = 0; i < parts; i++) {
          const part = arr.slice(i * CH, (i + 1) * CH);
          const r = await api(path, { ...body, [key]: part, hx_batch: { i, of: parts, n } });
          for (const [k, v] of Object.entries(r || {})) { if (typeof v === 'number') res[k] = (res[k] || 0) + v; else if (!(k in res)) res[k] = v }
          done += part.length; card.set(done, n);
        }
      } catch (e) {
        HX.bulk = 0;
        card.fail(`Đã ${del ? 'xoá' : 'cập nhật'} ${nf(done)} / ${nf(n)} dòng rồi dừng: ${e && e.message || e}`);
        try { await load(); renderAll() } catch (x) { /* bỏ qua */ }
        throw e;
      }
      HX.bulk = 0;
      card.stage('Đang cập nhật bảng');
      try { HX.v = HX.selfVer = await verNow() } catch (e) { /* bỏ qua */ }
      await load(); if (document.querySelector('#modal .sg') && typeof drawSettings === 'function') drawSettings(); renderAll();
      card.ok(`${del ? 'Đã xoá' : 'Đã cập nhật'} ${nf(n)} dòng`);
      OVL.ts = 0;
      if (RT2.again) pushApply();
      return res;
    } }

  /* ── 7. tab "Tải riêng": ĐỦ và ĐÚNG mới hiện ──
     · Mở app: dữ liệu chính (các tab thường) về trước → dùng được ngay; tab tải riêng không chặn gì.
     · Nạp ngầm lúc rảnh, tab nhỏ trước, không hiện khung tải. Nạp theo từng phần (con trỏ id, ổn định khi đang có người ghi)
       vào bộ đệm riêng; xong hết mới gộp vào dữ liệu một lần + bắt kịp thay đổi trong lúc nạp (delta từ lúc bắt đầu).
       → bảng / số đếm / Cú vọ không bao giờ thấy dữ liệu dở dang.
     · Người dùng mở tab đang nạp: hiện khung tải kèm tiến độ "đã về / tổng" cho tới khi đủ; mở tab chưa nạp: nạp ngay (chen trước). */
  const BG_MAX = 500000;   // tab quá lớn (theo số đếm của máy chủ) thì chỉ nạp khi mở tab
  const LZQ = new Map();   // tab đang nạp → job
  HX.inLoad = 0;
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  const lzTotal = id => { const j = LZQ.get(id); if (j && j.total) return j.total; let n = 0; OVL.rows.forEach(r => { if (r[0] === id) n += r[4] }); return n || (I.tab[id] && I.tab[id].lazy_n) || 0 };
  const nf = n => (+n || 0).toLocaleString('vi');
  lzEnsure = function (tab) {
    const id = +tab, t = I.tab[id];
    if (!t || !+t.lazy || lzLoaded(id)) return Promise.resolve(false);
    let job = LZQ.get(id);
    if (!job) {
      job = { got: 0, t0: performance.now(), name: t.name }; LZQ.set(id, job);
      job.paint = () => { if (LZV.id === id) lzPaint(job, id) };
      job.full = (async () => {
        const t0 = S.ts, buf = [], ids = new Set(), lks = new Map();
        for (const a of S.accs) if (a.tab_id === id) ids.add(a.id);   // dòng đã có (delta đẩy vào) → không lặp
        let before = 0;
        try {
          for (let i = 0; ; i++) {
            const r = await api(`tab_chunk?tab=${id}&before=${before}&n=${i ? 8000 : 3000}`);
            for (const a of r.accounts) if (!ids.has(a.id)) { ids.add(a.id); buf.push(a) }
            for (const l of r.links) lks.set(l.id, l);
            if (r.total != null) job.total = r.total;
            job.got = buf.length; job.paint(); renderFoot();
            if (!r.next) break;
            before = r.next; await yieldUI();
          }
          /* đủ rồi mới gộp: 1 lần index, rồi bắt kịp mọi thay đổi xảy ra trong lúc nạp */
          const cur = new Set(S.accs.map(a => a.id));
          for (const a of buf) if (!cur.has(a.id)) S.accs.push(a);
          const have = new Set(S.links.map(l => l.id)), ok = x => ids.has(x) || !!I.acc[x];
          for (const l of lks.values()) if (!have.has(l.id) && ok(l.src) && ok(l.dst)) S.links.push(l);
          S.lz.add(id); index();
          if (t0 > 0) try { const d = await api('delta?since=' + t0); applyDelta(d); index() } catch (e) { /* lần hỏi dữ liệu mới sau sẽ bắt kịp */ }
          const mm = $('#main'); if (mm) mm.dataset.stale = 1;
          LZQ.delete(id); lzView();
          bgRender(S.tab == id);
          return true;
        } finally { LZQ.delete(id); lzView(); renderFoot() }
      })();
      job.full.catch(e => console.warn('hx nạp tab', id, e));
    }
    lzView(); if (S.tab == id) renderFoot();
    // trong lúc load() (mở app / làm mới) không chờ → các tab khác vẽ ngay; nơi khác (Cú vọ…) chờ nạp đủ
    return HX.inLoad ? Promise.resolve(false) : job.full;
  };
  /* Khung tải (dòng giả trong bảng + thẻ tiến độ góc dưới phải) luôn nói đúng về TAB ĐANG XEM:
     · tab đang xem là tab tải riêng chưa về đủ → khung tải của chính tab đó (tên, % và "đã về / tổng" của nó)
     · tab khác / tab đã về đủ → không có khung tải, bảng hiện ngay
     · chuyển qua chuyển lại → tự bật / tắt; quay lại tab đã nạp lâu hơn 5 giây → thẻ tiến độ hiện luôn, không chờ lại
     Thẻ tiến độ dùng chung với lần tải lớn của bản gốc (mở app / làm mới — áp cho mọi tab): lúc đó thẻ của bản gốc
     đứng trên, tab tải riêng không ghi đè tên / %; bản gốc xong mà tab đang xem vẫn đang nạp → thẻ chuyển về tab đó. */
  const LZV = { own: false, id: null };
  function lzPaint(j, id) {
    if (!LDR.el || LDR.n > 1) return;   // lần tải lớn của bản gốc đang chạy: để thẻ của nó
    const tot = lzTotal(id);
    LDR.lab = 'Đang tải ' + j.name; LDR.ph = 1;
    LDR.p = tot ? Math.min(96, 8 + 88 * j.got / tot) : Math.max(8, LDR.p);
    LDR.sub = tot ? `${nf(j.got)} / ${nf(tot)} dòng` : `${nf(j.got)} dòng`;
    ldrPaint();
  }
  function lzView() {
    const id = +S.tab, j = HX.active ? LZQ.get(id) : null;
    if (j) {
      if (!LZV.own) {
        if (LDR.n > 0) { LZV.id = null; return }   // bản gốc đang tải lớn (mọi tab): thẻ của nó đã đúng
        document.querySelectorAll('.ldw.off:not(.hx-op)').forEach(e => e.remove());   // thẻ cũ đang mờ dần: bỏ hẳn, không dùng lại
        ldrStart('Đang tải ' + j.name, lzTotal(id), 60); LZV.own = true;
        if (performance.now() - j.t0 > 5000 && LDR.el) LDR.el.classList.add('on');
      }
      if (LZV.id !== id) {   // vừa chuyển sang tab tải riêng khác cũng đang nạp: thẻ + dòng giả theo tab mới
        LZV.id = id; LDR.p = 0;
        if (performance.now() - j.t0 > 5000 && LDR.el) LDR.el.classList.add('on');
        LDR.sig = ''; requestAnimationFrame(() => requestAnimationFrame(ldrSkel));
      }
      lzPaint(j, id);
    } else if (LZV.own) { LZV.own = false; LZV.id = null; ldrEnd() }
  }
  HX.lzView = lzView;
  /* lần tải lớn của bản gốc bắt đầu khi thẻ đang là của tab tải riêng → thẻ đổi ngay sang lần tải lớn (bản gốc chỉ đổi tên, không vẽ lại) */
  { const _ls = ldrStart; ldrStart = function (lab, n) { const mine = LZV.own && LDR.n > 0, r = _ls.apply(this, arguments);
      if (mine && LDR.el) { LDR.lab = lab || 'Đang tải dữ liệu'; LDR.sub = n ? nf(n) + ' dòng' : ''; LDR.ph = 0; LDR.p = 0; ldrPaint() }
      return r } }
  /* lần tải lớn của bản gốc vừa xong → nếu tab đang xem vẫn đang nạp thì nhận lại thẻ */
  { const _le = ldrEnd; ldrEnd = function () { const r = _le.apply(this, arguments); if (LDR.n === 0) { LZV.own = false; LZV.id = null } setTimeout(lzView, 0); return r } }
  /* rời tab đang nạp → bỏ khung tải; quay lại → hiện lại kèm tiến độ */
  { const _st = setTab; setTab = function () { const r = _st.apply(this, arguments); lzView(); return r } }
  /* chân trang: tab đang nạp → "đã về / tổng" thay cho "0 dòng" */
  { const _rf2 = renderFoot; renderFoot = function () { const r = _rf2.apply(this, arguments); const j = LZQ.get(+S.tab), pg = j && document.querySelector('#foot .pg'); if (pg) pg.textContent = `Đang tải ${nf(j.got)} / ${nf(lzTotal(+S.tab))} dòng`; return r } }
  /* Làm mới: bản gốc bỏ hết tab tải riêng đã nạp rồi nạp lại từ đầu → tab đó trống / về 0 trong lúc nạp.
     Giờ: nạp lại đủ dữ liệu chính như cũ, GIỮ các tab tải riêng đã có và bắt kịp thay đổi của chúng bằng delta (máy chủ trả cả dòng đã xoá)
     → mọi tab luôn đủ và đúng, làm mới vẫn nhanh. */
  { const _rl = ACT.reload; ACT.reload = async function () {
      const lz = new Set(S.lz), ts = S.ts, keep = S.accs.filter(a => lz.has(a.tab_id)), kid = new Set(keep.map(a => a.id));
      const kl = S.links.filter(l => kid.has(l.src) || kid.has(l.dst));
      HX.reloading = 1;
      let r; try { r = await _rl.apply(this, arguments) } finally { HX.reloading = 0 }
      if (lz.size && ts) {
        const now = new Set(S.accs.map(a => a.id)); for (const a of keep) if (!now.has(a.id)) S.accs.push(a);
        const have = new Set(S.links.map(l => l.id)), ids = new Set(S.accs.map(a => a.id));
        for (const l of kl) if (!have.has(l.id) && ids.has(l.src) && ids.has(l.dst)) S.links.push(l);
        for (const id of lz) if (lzTab(id)) S.lz.add(id);
        index();
        try { const d = await api('delta?since=' + ts); applyDelta(d); index() } catch (e) { /* lần hỏi dữ liệu mới sau sẽ bắt kịp */ }
        renderAll();
      }
      return r;
    } }
  const idle = () => new Promise(r => window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 4000 }) : setTimeout(r, 300));
  let bgRun = false;
  async function bgLazy() {
    if (bgRun || HX.reloading) return; bgRun = true;
    try {
      if (navigator.connection && navigator.connection.saveData) return;
      for (let guard = 0; guard < 50; guard++) {
        await idle();
        const big = {}; OVL.rows.forEach(([t, , , , n]) => { big[t] = (big[t] || 0) + n });
        const id = lzTabs().filter(t => (big[t] || 0) <= BG_MAX).sort((a, b) => (big[a] || 0) - (big[b] || 0))[0];   // tab nhỏ trước
        if (id == null) break;
        document.documentElement.classList.add('hx-bg');
        try { lzEnsure(id); const j = LZQ.get(id); if (j) await j.full; if (!S.lz.has(id)) break } catch (e) { console.warn('hx nạp ngầm', id, e); break }
        finally { document.documentElement.classList.remove('hx-bg') }
      }
    } finally { bgRun = false }
  }
  const _ld = load;
  load = async function () { HX.inLoad++; try { return await _ld.apply(this, arguments) } finally { HX.inLoad--; setTimeout(bgLazy, 1200) } };

  /* ── 1. bấm dòng trong cây → đổi luôn Phạm vi (combobox trên cùng) ── */
  const _pick = ACT.ovpick;
  ACT.ovpick = (el, e) => {
    if (e && e.target.closest('[data-a=ovtg]')) return;
    const k = el.dataset.k, ow = k[0] === 'o' ? I.own[+k.slice(1)] : null;
    const d = k === 'all' ? 'all' : ow ? ow.dept_id : +k.slice(1), o = ow ? ow.id : null;
    if ((k[0] === 'o' && !ow) || d === undefined || Number.isNaN(d)) return _pick(el, e);
    OVS = k; LS('ahs.ovs', k);
    if (S.dept === d && (S.owner ?? null) === o) return renderBody();
    OVSK = o != null ? 'o' + o : d !== 'all' ? 'd' + d : 'all';   // đã đứng đúng dòng: không nhảy/cuộn lại
    setScope(d, o);
  };
})();
