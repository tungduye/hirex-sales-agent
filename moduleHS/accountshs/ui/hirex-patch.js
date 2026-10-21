/* HireX · vá thêm cho trang gốc v7 — nạp SAU toàn bộ JS gốc (build_ui.py chèn vào cuối trang).
   Chỉ bọc hàm/ACT của bản gốc (như các khối vá rNN), không sửa mã Python gốc.
   1. Tổng quan: bấm bộ phận / owner trong cây → combobox Phạm vi trên cùng nhảy theo.
   2. Tab Tất cả: mặc định mở Tổng quan; bỏ thanh công cụ riêng — nút Tổng quan/Chi tiết + Xuất Excel nằm ở đầu khung chi tiết.
   3. Tổng quan: tab "Tải riêng" chưa nạp vẫn có số đếm (server gom, không tải dòng về).
   4. Tổng quan: tiêu đề cột đầu của cây = bộ chọn nhóm nền tảng (Tất cả nền tảng / Tài khoản / Dữ liệu Marketing…);
      các dòng bên dưới là phạm vi (Toàn hệ thống › bộ phận › owner) — khớp đúng tên trong combobox Phạm vi.
   5. Tổng quan: ô chọn trong cây trượt mượt sang dòng mới (không còn nền hover). */
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
      .then(r => { OVL = { k, ts: Date.now(), rows: r.rows || [], busy: 0 }; if (ovOn()) renderBody() })
      .catch(() => { OVL.busy = 0; OVL.ts = Date.now(); OVL.k = k });
  }

  let LASTD = null;
  const _ovData = ovData;
  ovData = function () {
    const D = _ovData(), C = D.C, al = ovAllow();
    const [pa, pb] = ovRange(), lz = new Set(lzTabs()), rk = OVL.k.endsWith('|' + pa + '|' + pb);
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
