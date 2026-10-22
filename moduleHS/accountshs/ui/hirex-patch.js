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
  /* ── 14. Tổng quan: nhóm cột "Tình trạng sở hữu" ──
     Bên cạnh nhóm "Tất cả" (Tổng · Live · Die · Khác) là nhóm cùng 4 cột nhưng chỉ đếm tài nguyên có trường "Tình trạng sở hữu"
     thuộc các giá trị đang chọn (mặc định Lâu dài + Tạm thời = đang sở hữu). Cùng phạm vi (cây bên trái), cùng nhóm nền tảng, cùng
     cách tính Live / Die / Khác như nhóm Tất cả → mỗi số sở hữu luôn ≤ số cùng cột bên trái, đọc ngang là so được ngay.
     · Cột Tổng có thanh tỉ lệ (sở hữu / tổng nền tảng); rê chuột xem chia theo từng giá trị (Lâu dài, Tạm thời, Mất, Không xác định, Chưa nhập).
     · Nền tảng không có trường sở hữu (Bài đăng FB, Nhóm FB…) → 1 ô gộp mờ "Không theo dõi".
     · Bấm 1 số → mở đúng nền tảng, đúng phạm vi, lọc sẵn theo tình trạng sở hữu (+ Live / Die).
     · Thẻ số phía trên có thêm thẻ "Sở hữu" cùng màu nhóm. Xuất Excel có thêm trang "Tình trạng sở hữu". */
  const OWN0 = '∅', OWND = ['Lâu dài', 'Tạm thời'], OWN1 = ['Lâu dài'];   // OWND = "Đang sở hữu"; mặc định lần đầu = Lâu dài
  let OWNS = (() => { try { const v = JSON.parse(LS('hx.ovown2') || 'null'); const w = Array.isArray(v) ? v.filter(x => x !== OWN0) : []; return w.length ? w : OWN1 } catch (e) { return OWN1 } })();
  const ownLab = v => v === OWN0 ? 'Chưa nhập' : v;
  const ownSel = () => OWNS.length === 2 && OWND.every(v => OWNS.includes(v)) ? 'Đang sở hữu' : OWNS.map(ownLab).join(' + ');
  const OWF = { k: -1, m: {} };
  const ownField = t => {
    if (OWF.k !== DVER) { OWF.k = DVER; OWF.m = {}; (S.meta.tabs || []).forEach(tb => { const f = tb.fields.find(x => /^\s*tình trạng sở hữu\s*$/i.test(x.label)); if (f) OWF.m[tb.id] = f }) }
    return OWF.m[t] || null;
  };
  const ownVals = () => { const o = new Set(); Object.values((ownField(0), OWF.m)).forEach(f => String(f.opts || '').split(',').map(x => x.trim()).filter(Boolean).forEach(x => o.add(x))); OWNS.forEach(v => o.add(v)); return [...o] };
  const scopeTest = k => {
    if (k === 'all') return () => true;
    const id = +k.slice(1);
    if (k[0] === 'd') return a => a.dept_id === id;
    if (k[0] === 'u') return a => a.dept_id === id && !(a.owner_id && I.own[a.owner_id]);
    if (k[0] === 'o') return a => { const o = a.owner_id && I.own[a.owner_id]; return !!o && o.path.includes(id) };
    return () => false;
  };
  const OWC = new Map();
  function ownCount(sk) {
    const key = DVER + '#' + OWNS.join('|');
    if (OWC.key !== key) { OWC.clear(); OWC.key = key }
    if (OWC.has(sk)) return OWC.get(sk);
    const sel = new Set(OWNS), inSk = scopeTest(sk), m = {};
    ownField(0);
    for (const a of ovAll()) {
      const f = OWF.m[a.tab_id]; if (!f || !inSk(a)) continue;
      const v = a.data && a.data[f.id], vv = v == null || v === '' ? OWN0 : String(v), h = rpH(a);
      const x = m[a.tab_id] ??= { sel: rpE(), tot: rpE(), by: {} };
      x.tot[h]++; x.by[vv] = (x.by[vv] || 0) + 1;
      if (sel.has(vv)) x.sel[h]++;
    }
    OWC.set(sk, m); return m;
  }
  const nf0 = n => n.toLocaleString('vi');
  function ownCols(m) {
    const t = m.querySelector('.ovw:not(.ovsk) .ovt'); if (!t || !t.tHead || !t.tBodies[0]) return;
    const hr = t.tHead.rows[0], ths = [...hr.cells]; if (ths.length !== 6) return;
    const cnt = ownCount(OVS), lz = new Set(lzTabs());
    const top = document.createElement('tr'); top.className = 'hx-og';
    top.innerHTML = `<th rowspan="2">${ths[0].innerHTML}</th><th colspan="4" class="hx-og0"><span>Tất cả</span></th>`
      + `<th colspan="4" class="hx-og1"><button class="hx-ownb" data-a="hxown" aria-haspopup="true" title="Chọn tình trạng sở hữu được đếm trong nhóm cột này"><span>Tình trạng sở hữu</span><b>${esc(ownSel())}</b>${ico('chevd', 13)}</button></th>`
      + `<th rowspan="2" class="tr">${ths[5].innerHTML}</th>`;
    ths[0].remove(); ths[5].remove(); hr.classList.add('hx-og2');
    hr.insertAdjacentHTML('beforeend', `<th class="hx-o hx-o0">Tổng</th><th class="hx-o g">Live</th><th class="hx-o b">Die</th><th class="hx-o hx-ok">Khác</th>`);
    t.tHead.insertBefore(top, hr);
    t.classList.add('hx-ownt');
    const S0 = { sel: rpE(), base: 0 };
    const RTW = { a: 4, b: 3 };   // độ rộng chung (ký tự) của phần số và phần "/tổng" trên cả bảng → mọi dòng thẳng hàng, không dư khoảng trống
    for (const tr of t.tBodies[0].rows) {
      const tid = +tr.dataset.t, f = ownField(tid), x = cnt[tid], td5 = tr.cells[tr.cells.length - 1], tb = I.tab[tid];
      let html;
      if (!f || lz.has(tid)) html = '<td class="hx-o hx-o0"></td><td class="hx-o"></td><td class="hx-o"></td><td class="hx-o"></td>';   // không có trường sở hữu: để trống
      else {
        const sel = x ? x.sel : rpE(), tot = x ? x.tot : rpE(), n = ovN(sel), all = ovN(tot), p = all ? n / all * 100 : 0;
        S0.sel.g += sel.g; S0.sel.w += sel.w; S0.sel.b += sel.b; S0.sel.n += sel.n; S0.base += all;
        const by = x ? x.by : {}, nm = tb ? tb.name : '';
        const tip0 = `${nm} · ${ownSel()}: ${nf0(n)} / ${nf0(all)} (${Math.round(p)}%)\n` + ownVals().filter(v => by[v]).map(v => `${OWNS.includes(v) ? '✓' : '  '} ${ownLab(v)}: ${nf0(by[v])}`).join('\n');
        const pc = (v, of) => of ? Math.round(v / of * 100) : 0;
        // "%  (số/tổng)": % cột cố định căn phải, "(số/tổng)" cột cố định căn trái (đo theo số dài nhất cả bảng), cả cụm căn giữa dưới tiêu đề cột
        const rt = (v, of) => (RTW.b = Math.max(RTW.b, (nf0(v) + '/' + nf0(of)).length + 2), of
          ? `<span class="hx-rt"><b>${pc(v, of)}%</b><small class="hx-of">(${nf0(v)}/${nf0(of)})</small></span>`
          : `<span class="hx-rt"><b class="z">–</b><small class="hx-of"></small></span>`);
        const c = (h, cls, v, of, lab) => `<td class="hx-o hx-r ${cls}" data-a="hxowngo" data-t="${tid}" data-h="${h}" title="${esc(`${nm} · ${lab}: ${nf0(v)} / ${nf0(of)} (${pc(v, of)}%) thuộc ${ownSel().toLowerCase()} — bấm để mở danh sách`)}">${rt(v, of)}</td>`;
        html = `<td class="hx-o hx-o0" data-a="hxowngo" data-t="${tid}" data-h="" title="${esc(tip0)}">${rt(n, all)}</td>`
          + c('g', 'g', sel.g, tot.g, 'Live') + c('b', 'b', sel.b, tot.b, 'Die') + c('o', 'hx-ok', sel.w + sel.n, tot.w + tot.n, 'Khác');
      }
      td5.insertAdjacentHTML('beforebegin', html);
    }
    t.style.setProperty('--rtb', (RTW.b * 0.82 + 0.2).toFixed(1) + 'ch');
    // thẻ số "Sở hữu" cùng hàng thẻ Tổng / Live / Die
    const ks = m.querySelector('.ovw:not(.ovsk) .ovks');
    if (ks && S0.base) {
      const n = ovN(S0.sel);
      ks.classList.add('hx-ks5');
      ks.insertAdjacentHTML('beforeend', `<div class="ovkc hx-okc" title="${esc(`${ownSel()}: ${nf0(n)} / ${nf0(S0.base)} tài nguyên có theo dõi sở hữu (${rpPct(n, S0.base)}%)`)}"><span>${esc(ownSel())}</span><b>${nf0(n)}</b><em>${rpPct(n, S0.base)}% · ${nf0(S0.sel.g)} live · ${nf0(S0.sel.b)} die</em></div>`);
    }
  }
  /* chọn giá trị đếm: popup tích nhiều ô, tích xong vẫn mở (bảng cập nhật ngay phía sau); bấm ra ngoài / Esc để đóng */
  const ownSave = v => { OWNS = v.length ? v : OWN1; LS('hx.ovown2', JSON.stringify(OWNS)); OWC.clear(); renderBody() };
  const ownPopHtml = () => {
    const box = on => `<span class="hx-cb ${on ? 'on' : ''}" aria-hidden="true">${on ? ico('check', 12) : ''}</span>`, all = ownSel() === 'Đang sở hữu';
    return `<div class="mh">Đếm tình trạng sở hữu</div>`
      + ownVals().map(v => `<button class="mi hx-ownv" data-v="${esc(v)}" role="menuitemcheckbox" aria-checked="${OWNS.includes(v)}">${box(OWNS.includes(v))}<span class="t">${esc(v)}</span></button>`).join('')
      + `<div class="sep"></div><button class="mi hx-ownv" data-v="" ${all ? 'disabled' : ''}><span class="t">Đang sở hữu (Lâu dài + Tạm thời)</span></button>`;
  };
  ACT.hxown = el => {
    const p = openPop(el, ownPopHtml(), 'hx-ownp');
    p.addEventListener('click', e => {
      const b = e.target.closest('.hx-ownv'); if (!b || b.disabled) return;
      e.stopPropagation();
      const v = b.dataset.v;
      if (!v) ownSave(OWND);
      else if (OWNS.includes(v)) { if (OWNS.length > 1) ownSave(OWNS.filter(x => x !== v)) }   // luôn giữ ít nhất 1 giá trị
      else ownSave([...OWNS, v]);
      if (POP === p) p.innerHTML = ownPopHtml();
      else { const a = document.querySelector('.hx-ownb'); if (a) ACT.hxown(a) }   // phòng khi vẽ lại đóng popup: mở lại đúng chỗ
    });
  };
  /* bấm 1 số sở hữu → mở nền tảng đó trong đúng phạm vi, lọc sẵn tình trạng sở hữu (+ Live / Die / Khác) */
  ACT.hxowngo = el => {
    const tr = el.closest('tr'), t = +el.dataset.t, h = el.dataset.h, f = ownField(t); if (!tr || !f) return;
    OVF = { k: OVS, t };
    ovInfo(tr.dataset.d, tr.dataset.o ? +tr.dataset.o : null, t, !!tr.dataset.u);
    S.fl[t] = [...(S.fl[t] || []).filter(c => String(c.k) !== String(f.id)), { k: f.id, op: 'in', v: OWNS.map(v => v === OWN0 ? EMP : v) }];
    const sts = (I.tab[t] ? I.tab[t].statuses : []).filter(s => h === 'g' ? s.h === 'g' : h === 'b' ? s.h === 'b' : h === 'o' ? s.h !== 'g' && s.h !== 'b' : false).map(s => s.id);
    if (sts.length) S.st = new Set(sts);
    savePref(); renderAll();
  };
  { const _os = ovSheets; ovSheets = function () {
      const out = _os.apply(this, arguments), D = LASTD || ovData(), H = ['Phạm vi', 'Cấp', 'Nền tảng', 'Tổng', 'Live', 'Die', 'Khác', `${ownSel()} · Tổng`, `${ownSel()} · Live`, `${ownSel()} · Die`, `${ownSel()} · Khác`, '% sở hữu'];
      const rows = [H];
      D.rows.forEach(r => { const cc = ownCount(r.k), c = D.C[r.k] || {}; D.tabs.forEach(t => {
        if (!ownField(t.id) || !c[t.id] || !ovN(c[t.id])) return;
        const a = c[t.id], x = cc[t.id] || { sel: rpE() }, n = ovN(x.sel);
        rows.push([r.name, r.lv, t.name, ovN(a), a.g, a.b, a.w + a.n, n, x.sel.g, x.sel.b, x.sel.w + x.sel.n, rpPct(n, ovN(a))]);
      }) });
      out['Tình trạng sở hữu'] = rows; return out;
    } }
  const _ro = renderOverview;
  renderOverview = function (m) {
    const on = m.querySelector('.ovtb .ovi.on'), g0 = on && geo(on);
    ovLazyLoad();
    _ro(m);
    header(m);
    tools(m);
    kpiShared(m);
    try { ownCols(m) } catch (e) { console.warn('hx sở hữu', e) }
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
    if (HX.active && !was) { syncTick(); if (HX.wake) HX.wake() }
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
      if (!body && !HX.direct && typeof path === 'string' && path.startsWith('delta?since=') && RT2.q.length) { const d = takePushed(parseFloat(path.slice(12))); if (d) return Promise.resolve(d) }
      return _api.apply(this, arguments);
    } }
  /* tự mình ghi (mut) thì bản gốc đã nạp lại → ghi nhận phiên bản mới, khỏi nạp thêm lần nữa */
  const _mut = mut;
  mut = async function () { const r = await _mut.apply(this, arguments); OVL.ts = 0; verNow().then(v => { HX.v = v }, () => { /* bỏ qua */ }); return r };   // không bắt người dùng chờ thêm 1 lượt hỏi phiên bản
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
    C.el = el; C.close = () => close(0);
    return C;
  }
  /** như api() của bản gốc nhưng không bật thông báo lỗi (dùng khi tự thử lại) */
  async function apiQuiet(path, body) {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = 'Lỗi máy chủ ' + r.status; try { m = (await r.json()).error || m } catch (e) { /* bỏ qua */ } throw new Error(m) }
    return r.json();
  }
  const BIGOPS = { mass_set: 'ids', rows_set: 'items', status_set: 'ids', owner_set: 'ids', device_set: 'ids', delete_accounts: 'ids' };
  const BIG_MIN = 1500;
  const frame = () => new Promise(z => requestAnimationFrame(() => requestAnimationFrame(z)));   // chờ trình duyệt vẽ xong
  /** Đối chiếu dữ liệu trên trình duyệt với đúng những gì vừa ghi (đã nạp lại từ máy chủ). Trả danh sách id chưa khớp.
   *  Cùng luật với máy chủ: trường phải thuộc tab của dòng, trạng thái phải thuộc tab của dòng; dòng không còn (bị xoá) bỏ qua. */
  function hxVerify(path, body) {
    const bad = [], has = (o, k) => Object.prototype.hasOwnProperty.call(o, k), sv = x => x == null ? '' : String(x);
    const fOk = (k, a) => { const f = I.field[k]; return !!f && f.tab_id === a.tab_id && f.type !== 'link' && f.type !== 'file' };
    const want = new Map();
    const put = (id, w) => { const o = want.get(id) || { data: {} }; Object.assign(o.data, w.data || {}); for (const c of ['note', 'status_id', 'owner_id', 'device_id']) if (has(w, c)) o[c] = w[c]; want.set(id, o) };
    if (path === 'delete_accounts') { for (const id of body.ids || []) if (I.acc[id]) bad.push(id); return bad }
    if (path === 'rows_set') for (const it of body.items || []) put(+it.id, { data: it.data || {}, ...['note', 'status_id', 'owner_id', 'device_id'].reduce((o, c) => (has(it, c) && (o[c] = it[c] === '' ? null : it[c]), o), {}) });
    else {
      const w = { data: path === 'mass_set' ? body.data || {} : {} };
      if (path === 'mass_set') {
        if (body.note != null && body.note_mode !== 'append') w.note = body.note;
        if (body.status_id) w.status_id = body.status_id;
        if (body.set_owner) w.owner_id = body.owner_id;
        if (body.set_device) w.device_id = body.device_id;
      }
      if (path === 'status_set') w.status_id = body.status_id;
      if (path === 'owner_set' && body.owner_id) w.owner_id = body.owner_id;
      if (path === 'device_set') w.device_id = body.device_id;
      for (const id of body.ids || []) put(+id, w);
    }
    for (const [id, w] of want) {
      const a = I.acc[id]; if (!a) continue;
      let ok = true;
      for (const [k, v] of Object.entries(w.data)) if (fOk(k, a) && sv(a.data && a.data[k]) !== sv(v)) ok = false;
      if (has(w, 'note') && sv(a.note) !== sv(w.note)) ok = false;
      if (has(w, 'status_id')) { const st = w.status_id ? I.status[w.status_id] : null; if ((!w.status_id || (st && st.tab_id === a.tab_id)) && sv(a.status_id) !== sv(w.status_id || '')) ok = false }
      if (has(w, 'owner_id') && (!w.owner_id || I.own[w.owner_id]) && sv(a.owner_id) !== sv(w.owner_id || '')) ok = false;
      if (has(w, 'device_id') && sv(a.device_id) !== sv(w.device_id || '')) ok = false;
      if (!ok) bad.push(id);
    }
    return bad;
  }
  /** Ghi xong → nạp lại THẲNG từ máy chủ (không dùng phần thay đổi đã đẩy qua thời gian thực trong lúc ghi), đối chiếu từng dòng;
   *  lệch → nạp lại toàn bộ rồi đối chiếu lần nữa. Vẽ lại bảng xong (trình duyệt đã vẽ) mới báo xong. */
  async function hxSettle(path, body, card) {
    const n = nRows(body);
    card.stage('Đang tải dữ liệu mới…');
    HX.direct = (HX.direct || 0) + 1; try { await load() } finally { HX.direct-- }
    card.stage('Đang đối chiếu…');
    let bad = hxVerify(path, body);
    if (bad.length) {
      console.warn('hx: chưa khớp sau khi ghi', path, bad.length, bad.slice(0, 20));
      card.stage('Đang nạp lại toàn bộ để đối chiếu…');
      HX.direct = (HX.direct || 0) + 1; try { await load(true) } finally { HX.direct-- }
      bad = hxVerify(path, body);
    }
    card.stage('Đang vẽ lại bảng…');
    if (document.querySelector('#modal .sg') && typeof drawSettings === 'function') drawSettings();
    renderAll(); await frame();
    return { n, bad };
  }
  { const _m = mut; mut = async function (path, body) {
      const key = BIGOPS[path], arr = key && body && Array.isArray(body[key]) ? body[key] : null;
      if (!arr || arr.length <= BIG_MIN) return _m.apply(this, arguments);
      const n = arr.length, CH = 4000, parts = Math.ceil(n / CH), del = path === 'delete_accounts';
      const card = opCard(`${del ? 'Đang xoá' : 'Đang cập nhật'} ${nf(n)} dòng`), res = {};
      let done = 0; HX.bulk = 1; card.set(0, n);
      // thanh tiến độ chạy đều trong lúc chờ từng lô (ước theo tốc độ các lô trước), không bao giờ vượt quá lô đang ghi
      let rate = 0, lot = 0, t0 = 0;
      const tick = setInterval(() => { if (!lot || !rate) return; card.set(done + Math.floor(Math.min(lot * 0.95, (performance.now() - t0) * rate)), n) }, 200);
      // lỗi mạng / máy chủ tạm lỗi (rớt mạng, khởi động lại, 502/503/504/524): thử lại lô đó, tối đa 3 lần.
      // Ghi theo lô là ghi đè giá trị (lặp lại vẫn đúng); riêng "nối thêm ghi chú" lặp lại sẽ nối 2 lần → không tự thử lại.
      const again = !(path === 'mass_set' && body.note_mode === 'append');
      const send = async (b, what) => {
        for (let k = 1; ; k++) {
          try { return await (k === 1 ? api : apiQuiet)(path, b) }
          catch (e) {
            const net = e instanceof TypeError || /Failed to fetch|NetworkError|Lỗi máy chủ|50[234]|52[0-4]/i.test(String(e && e.message || e));
            if (!again || !net || k >= 4) throw e;
            card.stage(`Mất kết nối, đang thử lại ${what} (${k}/3)…`); await new Promise(z => setTimeout(z, 1500 * k * k)); card.stage('Đang ghi');
          }
        }
      };
      try {
        try {
          if (path === 'delete_accounts') {   // xoá: chụp bản an toàn trước (sửa thì lịch sử dòng đã giữ bản cũ)
            card.stage('Đang chụp bản an toàn…');
            await send({ ...body, [key]: [], hx_batch: { i: 0, of: parts + 1, n, snap: 1 } }, 'bước chụp bản an toàn');
          }
          card.stage('Đang ghi');
          for (let i = 0; i < parts; i++) {
            const part = arr.slice(i * CH, (i + 1) * CH);
            lot = part.length; t0 = performance.now();
            const r = await send({ ...body, [key]: part, hx_batch: { i: i + 1, of: parts + 1, n } }, `lô ${i + 1}/${parts}`);
            const ms = performance.now() - t0; rate = rate ? (rate + part.length / ms) / 2 : part.length / ms; lot = 0;
            for (const [k, v] of Object.entries(r || {})) { if (typeof v === 'number') res[k] = (res[k] || 0) + v; else if (!(k in res)) res[k] = v }
            done += part.length; card.set(done, n);
          }
        } finally { clearInterval(tick) }
      } catch (e) {
        HX.bulk = 0;
        card.fail(`Đã ${del ? 'xoá' : 'cập nhật'} ${nf(done)} / ${nf(n)} dòng rồi dừng: ${e && e.message || e}`);
        HX.direct = (HX.direct || 0) + 1; try { await load(); renderAll() } catch (x) { /* bỏ qua */ } finally { HX.direct-- }
        throw e;
      }
      HX.bulk = 0;
      try { HX.v = HX.selfVer = await verNow() } catch (e) { /* bỏ qua */ }
      let st;
      try { st = await hxSettle(path, body, card) }
      catch (e) { card.fail(`Đã ghi xong ${nf(n)} dòng nhưng chưa tải lại được bảng: ${e && e.message || e}. Bấm F5 để xem dữ liệu mới.`); throw e }
      OVL.ts = 0;
      if (st.bad.length) card.fail(`Đã ghi ${nf(n)} dòng, ${nf(st.bad.length)} dòng hiện khác giá trị vừa sửa (có thể vừa bị người khác sửa tiếp). Mở lịch sử dòng để xem.`);
      else card.ok(`${del ? 'Đã xoá' : 'Đã cập nhật'} ${nf(n)} dòng`);
      if (RT2.again) pushApply();
      return res;
    } }

  /* ── 9b. thao tác 1 dòng nhanh: ghi + lấy phần thay đổi trong CÙNG 1 lượt ──
     Trước: lưu → chờ phản hồi → hỏi /delta (thêm 1 lượt mạng, máy chủ kiểm tra đăng nhập lại, đọc lại meta) → vẽ.
     Giờ: gửi kèm mốc dữ liệu đang có (hx_since + tab tải riêng đã nạp); máy chủ ghi xong tính luôn phần thay đổi, trả chung phản hồi
     → load() của bản gốc nhận ngay phần đó, không gọi mạng nữa. Lô ghi lớn (hx_batch) vẫn đi đường riêng ở mục 9. */
  const WR = new Set(['account', 'status_set', 'owner_set', 'mass_set', 'delete_accounts', 'quick', 'bulk', 'delete', 'reorder', 'dept', 'owner', 'tab', 'field',
    'status', 'device', 'device_set', 'rows_set', 'device_bulk', 'grp_icon', 'tab_keys', 'tab_pk', 'opt_colors', 'hist_cfg', 'log_clear', 'repair']);
  HX.pre = null;
  { const _api = api; api = async function (path, body) {
      if (body && typeof path === 'string' && WR.has(path) && !body.hx_batch && S.ts && S.accs && S.accs.length) {
        const since = S.ts, r = await _api.call(this, path, { ...body, hx_since: since, hx_lz: typeof lzList === 'function' ? lzList() : '' });
        if (r && typeof r === 'object' && r.__d) { HX.pre = { since, d: r.__d }; delete r.__d }
        return r;
      }
      if (!body && typeof path === 'string' && path.startsWith('delta?since=') && HX.pre) {
        const p = HX.pre; HX.pre = null;
        if (Math.abs(parseFloat(path.slice(12)) - p.since) < 1e-6) return p.d;
      }
      return _api.apply(this, arguments);
    } }
  /* trang Tài nguyên đang chạy nền (đang ở trang khác của HireX) hoặc tab trình duyệt bị ẩn: không hỏi Vọng gác 30 giây/lần,
     không tải "lịch sử dòng" cho các bảng dựng sẵn ngầm — để dành, hiện lại là tải ngay. Đang có lượt check chạy thì vẫn theo dõi. */
  const shown = () => HX.active && !document.hidden;
  if (typeof cyvLoad === 'function') {
    const _cl = cyvLoad;
    window.cyvLoad = function () {
      const run = typeof CYV !== 'undefined' && (CYV.running || CYV.open);
      if (!shown() && !run && CYV.st) { clearTimeout(CYV.t); CYV.t = setTimeout(window.cyvLoad, 300000); HX.cyvLater = 1; return Promise.resolve() }
      HX.cyvLater = 0; return _cl.apply(this, arguments);
    };
  }
  if (typeof hlFlush === 'function') {
    const _hf = hlFlush;
    window.hlFlush = function () { if (!shown()) { HX.hlLater = 1; return } HX.hlLater = 0; return _hf.apply(this, arguments) };
  }
  HX.wake = () => { if (HX.cyvLater) window.cyvLoad(); if (HX.hlLater) window.hlFlush() };
  addEventListener('visibilitychange', () => { if (!document.hidden && HX.active) HX.wake() });

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

  /* ── 10. tải đúng chỗ, đúng lúc ──
     · Vọng gác / CRM chạy xong: bản gốc tải lại TOÀN BỘ (~20.000+ dòng, khung tải đè lên trang) dù đang ở Tổng quan.
       Thay đổi đã về qua thời gian thực (SSE) → chỉ cần lấy phần thay đổi (delta) im lặng, vẽ lại lúc người dùng rảnh.
     · Dòng giả (khung tải bảng) chỉ hiện khi màn đang xem thật sự là BẢNG; Tổng quan / Sơ đồ / Báo cáo / Thiết bị không bao giờ có dòng giả.
       Chuyển tab trong lúc tải: dòng giả theo bảng mới hoặc tắt. */
  HX.soft = 0;
  { const _l = load; load = function (full) { if (full && HX.soft && !HX.reloading && S.ts && S.accs && S.accs.length) full = false; return _l.call(this, full) } }
  { const _ra = renderAll; renderAll = function () {
      if (HX.soft && !HX.inBg) { HX.inBg = 1; try { bgRender() } finally { HX.inBg = 0 } return }
      return _ra.apply(this, arguments);
    } }
  for (const nm of ['cyvLoad', 'crmLoad']) {
    const f = window[nm]; if (typeof f !== 'function') continue;
    window[nm] = async function () { HX.soft++; try { return await f.apply(this, arguments) } finally { HX.soft-- } };
  }
  const tblView = () => typeof S !== 'undefined' && isTbl() && !ovOn() && !!document.querySelector('#main #tw');
  { const _sk = ldrSkel; ldrSkel = function () { if (!tblView()) { if (LDR.sk) ldrSkOff(); return } return _sk.apply(this, arguments) } }
  { const _st = setTab; setTab = function () {
      const r = _st.apply(this, arguments);
      if (LDR.el) { ldrSkOff(); LDR.sig = ''; requestAnimationFrame(() => requestAnimationFrame(ldrSkel)) }
      return r;
    } }

  /* ── 11. cột, khóa chính, màu giá trị Danh sách, đúp chuột chọn giá trị ──
     · Cột Thiết bị (ít dùng) đứng ngay trước Ghi chú, ở mọi bảng.
     · Khóa chính (trường làm tên dòng: liên kết, tìm, Cú vọ, nhật ký…) chọn trong Cài đặt › Trường, không buộc là cột đầu.
       Máy chủ đưa khóa lên đầu fields[] (mọi chỗ của bản gốc coi fields[0] là tên) → thứ tự cột trên bảng / trong cài đặt vẫn theo pos.
     · Giá trị Danh sách có màu: mặc định theo thương hiệu / ý nghĩa (nhà mạng, loại email, sở hữu…), đổi trong Cài đặt › Trường (nút bảng màu).
     · Đúp chuột ô Danh sách → chọn giá trị ngay (đang chọn nhiều dòng cùng tab → áp cho cả các dòng đó). */
  /** phiên sửa Cài đặt: thay đổi giữ ở đây, bấm Lưu mới ghi + vẽ lại bảng (mục 12) */
  const SE = { pend: new Map(), order: new Map(), st: new Map(), pk: new Map(), render: 0, busy: 0 };
  if (typeof LG !== 'undefined') Object.assign(LG, { tab_pk: ['key', 'Khóa chính'], opt_colors: ['palette', 'Màu giá trị'] });
  const nzk = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
  const OC_DEF = (() => {
    const m = {}, put = (c, ...vs) => vs.forEach(v => { m[nzk(v)] = c });
    // nhà mạng: màu nhận diện thương hiệu
    put('#ee0033', 'Viettel'); put('#f26f21', 'Vietnamobile'); put('#0057b8', 'Mobifone'); put('#00a0e3', 'Vinaphone');
    put('#c2185b', 'Itel', 'iTel', 'Itelecom'); put('#7c3aed', 'Gmobile'); put('#e11d48', 'Reddi'); put('#0f766e', 'Wintel'); put('#64748b', 'Local');
    // loại email
    put('#ea4335', 'Gmail'); put('#0078d4', 'Outlook', 'Hotmail'); put('#6d4aff', 'Proton'); put('#6001d2', 'Yahoo'); put('#a01e2b', 'Tuta', 'Tutanota');
    put('#1f6fb2', 'Runbox'); put('#475467', 'Domain'); put('#98a2b3', 'Tempmail');
    // sở hữu / trạng thái xử lý / danh mục
    put('#12b76a', 'Lâu dài', 'Đã quét UID', 'Tham gia & Đăng bài', 'Chat REC người Việt');
    put('#f79009', 'Tạm thời', 'Cần CEO Check'); put('#2e90fa', 'Quét UID', 'Chat', 'Kết bạn');
    put('#7a5af8', 'Cào thành viên', 'Comment', 'Chatbot'); put('#0e9384', 'Đăng bài', 'Chat HRNB'); put('#98a2b3', 'Tham gia', 'Chưa sử dụng', 'Trống', 'KXD', 'Other');
    put('#d92d20', 'Chat REC Người Nhật');
    put('#12b76a', 'Có'); put('#f04438', 'Không'); put('#98a2b3', 'Không xác định');
    // proxy
    put('#2e90fa', 'v4'); put('#7a5af8', 'v6'); put('#da251d', 'VN'); put('#3c3b6e', 'US'); put('#bc002d', 'JP'); put('#ef3340', 'SG');
    return m;
  })();
  /* icon nhà mạng: huy hiệu màu thương hiệu + chữ viết tắt (không chép logo gốc) — dùng chung bộ icon IC của bản gốc */
  const badge = (c, t, fs = 9) => `<g stroke="none"><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="${c}"/><text x="12" y="${(12 + fs * 0.36).toFixed(1)}" text-anchor="middle" font-family="system-ui,'Segoe UI',Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${t}</text></g>`;
  Object.assign(IC, {
    c_viettel: badge('#ee0033', 'VT'), c_vinaphone: badge('#00a0e3', 'VN'), c_mobifone: badge('#0057b8', 'MB'), c_vietnamobile: badge('#f26f21', 'VM'),
    c_itel: badge('#c2185b', 'iT'), c_gmobile: badge('#7c3aed', 'G', 11), c_reddi: badge('#e11d48', 'R', 11), c_wintel: badge('#0f766e', 'W', 11),
    grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>',
  });
  const OI_DEF = (() => { const m = {}, put = (i, ...vs) => vs.forEach(v => { m[nzk(v)] = i });
    put('c_viettel', 'Viettel'); put('c_vinaphone', 'Vinaphone'); put('c_mobifone', 'Mobifone'); put('c_vietnamobile', 'Vietnamobile'); put('c_itel', 'Itel', 'iTel', 'Itelecom');
    put('c_gmobile', 'Gmobile'); put('c_reddi', 'Reddi'); put('c_wintel', 'Wintel'); put('b_gmail', 'Gmail'); put('check', 'Có'); put('x', 'Không');
    return m })();
  const ICPICK = ['c_viettel', 'c_vinaphone', 'c_mobifone', 'c_vietnamobile', 'c_itel', 'c_gmobile', 'c_reddi', 'c_wintel', ...TABICONS,
    'check', 'x', 'clock', 'lock', 'tag', 'calendar', 'folder', 'inbox', 'zap', 'bot', 'like', 'dislike', 'bulb', 'file', 'url', 'eye', 'layers', 'network'].filter((n, i, a) => IC[n] && a.indexOf(n) === i);
  const defMode = f => String(f.opts || '').split(',').some(v => OI_DEF[nzk(v.trim())]) ? 'both' : 'text';
  /** màu / icon / cách hiện của 1 giá trị; draft = đang sửa trong Cài đặt (chưa lưu) */
  function optStyle(f, v, draft) {
    const d = draft && SE.st.get(f.id), om = S.meta || {};
    const cm = d ? d.colors : (om.opt_colors && om.opt_colors[f.id]) || {}, im = d ? d.icons : (om.opt_icons && om.opt_icons[f.id]) || {};
    const ii = im[v] || OI_DEF[nzk(v)] || null;
    return { c: cm[v] || OC_DEF[nzk(v)] || null, i: ii === 'none' ? null : ii, m: (d ? d.mode : om.opt_mode && om.opt_mode[f.id]) || defMode(f) };
  }
  const optColor = (f, v) => (f && v != null && v !== '') ? optStyle(f, v).c : null;
  function tagHtml(v, st) {
    const io = st.i && st.m !== 'text', only = io && st.m === 'icon';
    return `<span class="tag hx-oc${only ? ' hx-oi' : ''}" style="--c:${st.c || '#98a2b3'}"${only ? ` title="${esc(v)}"` : ''}>${io ? ico(st.i, only ? 18 : 14) : ''}${only ? '' : `<span>${esc(v)}</span>`}</span>`;
  }
  const optVals = f => { const o = String(f.opts || '').split(',').map(x => x.trim()).filter(Boolean), seen = new Set(o);
    for (const a of S.accs) if (a.tab_id === f.tab_id) { const v = a.data && a.data[f.id]; if (v && !seen.has(v)) { seen.add(v); o.push(String(v)) } }
    return o };
  const posOrder = t => t.fields.slice().sort((a, b) => (a.pos - b.pos) || (a.id - b.id));
  /** chạy fn với t.fields theo thứ tự cột (pos) — phần đồng bộ của fn thấy đúng thứ tự hiển thị */
  const withPos = (t, fn) => { if (!t || !t.fields || t.fields.length < 2) return fn(); const f = t.fields, p = posOrder(t); if (p.every((x, i) => x === f[i])) return fn(); t.fields = p; try { return fn() } finally { t.fields = f } };
  /* hàng: ô Thiết bị chuyển xuống trước Ghi chú */
  const mvDev = h => { const i = h.indexOf('<td class="c-dev">'); if (i < 0) return h; const j = h.indexOf('</td>', i) + 5, seg = h.slice(i, j), rest = h.slice(0, i) + h.slice(j), k = rest.indexOf('<td class="c-note"'); return k < 0 ? h : rest.slice(0, k) + seg + rest.slice(k) };
  { const _r = rowHtml; rowHtml = function () { return mvDev(_r.apply(this, arguments)) } }
  { const _r = rowAll; rowAll = function () { return mvDev(_r.apply(this, arguments)) } }
  /* ô: chữ đậm cho khóa chính thật; giá trị Danh sách tô màu */
  { const _c = cell; cell = function (a, f, i) {
      const t = I.tab[a.tab_id], pk = t && t.fields[0];
      let h = _c.call(this, a, f, pk && f.id === pk.id ? 0 : 1);
      const v = f.type === 'select' && a.data[f.id];
      if (v) { const st = optStyle(f, v); if (st.c || (st.i && st.m !== 'text')) h = h.replace(`<span class="tag">${esc(v)}</span>`, tagHtml(v, st)) }
      return h;
    } }
  /* tiêu đề: Thiết bị trước Ghi chú, chìa khóa đúng cột khóa chính */
  function fixHead() {
    const hd = document.querySelector('#main #tw thead tr'); if (!hd) return;
    const dev = hd.querySelector('th.c-dev'), note = hd.querySelector('th[data-k="note"]');
    if (dev && note && dev.nextElementSibling !== note) hd.insertBefore(dev, note);
    const t = I.tab[S.tab], pk = t && t.fields[0];
    if (t && pk) {
      hd.querySelectorAll('th.pk').forEach(th => { if (th.dataset.k === String(pk.id)) return; const f = I.field[th.dataset.k], sv = th.querySelector('svg'); th.classList.remove('pk'); if (f && sv) sv.outerHTML = ico(f.type === 'link' ? (I.tab[f.link_tab] && I.tab[f.link_tab].icon || 'link') : TYPEIC[f.type], 13) });
      const th = hd.querySelector(`th[data-k="${pk.id}"]`); if (th && !th.classList.contains('pk')) { th.classList.add('pk'); const sv = th.querySelector('svg'); if (sv) sv.outerHTML = ico('key', 13) }
    }
    const tip = { outl: 'Phụ thuộc — dòng này cần / dựa vào các dòng nó trỏ tới (email khôi phục, SĐT xác minh, UID Admin…)', links: 'Dùng cho — các dòng khác đang dùng dòng này (vd. email này là email xác minh của 3 Facebook)' };
    for (const k in tip) { const th = hd.querySelector(`th[data-k="${k}"]`); if (th && !th.title) th.title = tip[k] }
    applyCW();
  }
  { const _rb = renderBody; renderBody = function () { const t = I.tab && I.tab[S.tab], r = withPos(t, () => _rb.apply(this, arguments)); fixHead(); return r } }
  /* cài đặt › Trường: danh sách + nút lên/xuống theo thứ tự cột; chọn khóa chính; bảng màu giá trị */
  { const _mv = ACT.mv; ACT.mv = function (el) { return el.dataset.t === 'fields' ? withPos(I.tab[SET.tab], () => _mv.apply(this, arguments)) : _mv.apply(this, arguments) } }
  { const _ds = drawSettings; drawSettings = function () {
      const t = SET.sec === 'field' ? I.tab[SET.tab] : null, r = withPos(t, () => _ds.apply(this, arguments));
      if (t) fixFieldPane(t);
      return r;
    } }
  const pkDraft = t => { if (!SE.pk.has(t.id)) return t.fields[0]; const v = SE.pk.get(t.id); return v ? I.field[v] : posOrder(t)[0] };
  function fixFieldPane(t) {
    const pane = document.querySelector('#modal .spane'); if (!pane) return;
    const pk = pkDraft(t);
    pane.querySelectorAll('input[data-api="field"][data-k="label"]').forEach(inp => {
      const row = inp.closest('.srow'), kb = row && row.querySelector('.kb'), f = I.field[inp.dataset.id]; if (!kb || !f) return;
      kb.innerHTML = pk && f.id === pk.id ? ico('key', 14) : ''; kb.title = pk && f.id === pk.id ? 'Khóa chính — hiển thị làm tên dòng' : '';
      if (f.type === 'select' && !row.querySelector('[data-a="hxoc"]')) {
        const op = row.querySelector('[data-k="opts"]'), b = `<button class="btn icon ghost sm hx-ocb" data-a="hxoc" data-id="${f.id}" title="Màu & icon giá trị">${ico('palette', 15)}</button>`;
        if (op) op.insertAdjacentHTML('afterend', b);
      }
    });
    if (!pane.querySelector('.hx-pkrow')) {
      const fs = posOrder(t).filter(f => !['link', 'lookup', 'file'].includes(f.type));
      const html = `<div class="srow tkrow hx-pkrow" title="Trường dùng làm tên dòng (liên kết, tìm kiếm, Cú vọ, nhật ký…) — không cần là cột đầu tiên"><span class="kb">${ico('key', 14)}</span><span class="tkl">Khóa chính</span>
        <select class="in" data-hxpk="${t.id}">${fs.map(f => `<option value="${f.id}" ${pk && f.id === pk.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></div>`;
      const tk = pane.querySelector('.tkrow'); if (tk) tk.insertAdjacentHTML('beforebegin', html);
      const k1 = pane.querySelector('.tkrow:not(.hx-pkrow) [data-tk="0"]'); if (k1 && pk && !tabKeys(t.id).length) k1.value = String(pk.id);   // khóa trùng mặc định = khóa chính
      const tk2 = pane.querySelector('.tkrow:not(.hx-pkrow)'); if (tk2) { const kb = tk2.querySelector('.kb'); if (kb) kb.innerHTML = ico('copy', 14); const tl = tk2.querySelector('.tkl'); if (tl) tl.textContent = 'Khóa trùng' }
    }
  }
  document.addEventListener('change', async e => {
    const x = e.target.closest && e.target.closest('[data-hxpk]'); if (!x) return;
    const tid = +x.dataset.hxpk, t = I.tab[tid], first = t && posOrder(t)[0];
    SE.pk.set(tid, first && +x.value === first.id ? null : +x.value);   // nháp — ghi khi bấm Lưu
    if (document.querySelector('#modal .sg')) drawSettings();
  });
  /* màu + icon + cách hiện giá trị của 1 trường (nháp trong phiên Cài đặt, ghi khi bấm Lưu) */
  const curSt = fid => { const om = S.meta || {};
    return { colors: { ...((om.opt_colors && om.opt_colors[fid]) || {}) }, icons: { ...((om.opt_icons && om.opt_icons[fid]) || {}) }, mode: (om.opt_mode && om.opt_mode[fid]) || '' } };
  const draft = fid => SE.st.get(fid) || (SE.st.set(fid, curSt(fid)), SE.st.get(fid));
  const MODES = [['text', 'Chữ'], ['both', 'Icon + chữ'], ['icon', 'Chỉ icon']];
  function ocHtml(f) {
    const vs = optVals(f), d = SE.st.get(f.id) || curSt(f.id), m = d.mode || defMode(f);
    if (!vs.length) return `<div class="mh">${esc(f.label)}</div><div class="hx-oce mut">Chưa có giá trị nào</div>`;
    return `<div class="mh">${esc(f.label)}</div><div class="hx-ocm">${MODES.map(([k, l]) => `<button class="chip ${m === k ? 'on' : ''}" data-a="hxocm" data-f="${f.id}" data-v="${k}">${l}</button>`).join('')}</div>`
      + vs.map(v => { const st = optStyle(f, v, true);
        return `<div class="hx-ocr"><input type="color" class="clr sm" value="${st.c || '#98a2b3'}" data-oc="${esc(v)}" data-f="${f.id}" title="Màu"><button class="btn icon ghost sm hx-icb" data-a="hxoci" data-f="${f.id}" data-v="${esc(v)}" title="Icon">${st.i ? ico(st.i, 16) : ico('plus', 14)}</button>${tagHtml(v, st)}${d.colors[v] || d.icons[v] ? '<em class="mut">đã đổi</em>' : ''}</div>` }).join('')
      + `<div class="sep"></div><button class="mi" data-a="hxocreset" data-id="${f.id}">${ico('undo', 15)}<span class="t">Về mặc định</span></button>`;
  }
  function icHtml(f, v) {
    const cur = optStyle(f, v, true).i;
    return `<div class="mh">${esc(v)} · icon</div><div class="hx-icg">${ICPICK.map(n => `<button class="${n === cur ? 'on' : ''}" data-a="hxocis" data-f="${f.id}" data-v="${esc(v)}" data-ic="${n}" title="${n}">${ico(n, 18)}</button>`).join('')}</div>`
      + `<div class="sep"></div><button class="mi" data-a="hxocis" data-f="${f.id}" data-v="${esc(v)}" data-ic="">${ico('x', 15)}<span class="t">Không icon</span></button><button class="mi" data-a="hxocback" data-f="${f.id}">${ico('chevl', 15)}<span class="t">Quay lại</span></button>`;
  }
  const ocRedraw = fid => { if (POP && POP._f === fid) POP.innerHTML = ocHtml(I.field[fid]); seFoot() };
  Object.assign(ACT, {
    hxoc(el) { const f = I.field[el.dataset.id]; if (f) { const p = openPop(el, ocHtml(f), 'hx-ocp'); p._f = f.id } },
    hxocreset(el) { const fid = +el.dataset.id; SE.st.set(fid, { colors: {}, icons: {}, mode: '' }); ocRedraw(fid) },
    hxocm(el) { const fid = +el.dataset.f; draft(fid).mode = el.dataset.v; ocRedraw(fid) },
    hxoci(el) { const f = I.field[el.dataset.f]; if (f && POP) POP.innerHTML = icHtml(f, el.dataset.v) },
    hxocis(el) { const fid = +el.dataset.f, v = el.dataset.v, d = draft(fid), def = OI_DEF[nzk(v)] || '';
      if (el.dataset.ic === def) delete d.icons[v]; else d.icons[v] = el.dataset.ic || 'none';
      if (el.dataset.ic && (d.mode || defMode(I.field[fid])) === 'text') d.mode = 'both';   // chọn icon → hiện luôn icon
      ocRedraw(fid) },
    hxocback(el) { ocRedraw(+el.dataset.f) },
  });
  document.addEventListener('input', e => {
    const x = e.target.closest && e.target.closest('[data-oc]'); if (!x) return;
    const fid = +x.dataset.f, v = x.dataset.oc, d = draft(fid), c = x.value.toLowerCase(), def = OC_DEF[nzk(v)] || '#98a2b3';
    if (c === def) delete d.colors[v]; else d.colors[v] = c;
    const tg = x.parentElement && x.parentElement.querySelector('.tag'); if (tg) tg.style.setProperty('--c', c);
    seFoot();
  });
  /* đúp chuột ô Danh sách → chọn giá trị. Cú nhấp đầu của bản gốc đổi vùng chọn thành 1 dòng → nhớ vùng chọn ngay trước đó */
  const PREV = { sel: null, t: 0 };
  document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#tw td[data-edit]') && S.sel && S.sel.size > 1) { PREV.sel = new Set(S.sel); PREV.t = performance.now() } }, true);
  document.addEventListener('dblclick', e => {
    const td = e.target.closest('#tw td[data-edit]'); if (!td || e.target.closest('button,a,input')) return;
    const a = I.acc[td.closest('tr') && td.closest('tr').dataset.id]; if (!a) return;
    const f = td.dataset.edit === 'label' ? null : I.field[td.dataset.edit]; if (!f || f.type !== 'select') return;
    e.preventDefault(); e.stopPropagation(); try { getSelection().removeAllRanges() } catch (x) { /* bỏ qua */ }
    const pv = PREV.sel && performance.now() - PREV.t < 1500 && PREV.sel.has(a.id) ? PREV.sel : null; PREV.sel = null;
    if (pv) { S.sel = pv; if (typeof paintSel === 'function') paintSel(false) }   // giữ vùng chọn nhiều dòng
    const ids = S.sel.has(a.id) && S.sel.size > 1 ? [...S.sel].filter(i => I.acc[i] && I.acc[i].tab_id === a.tab_id) : [a.id];
    const cur = v => ids.every(i => String(I.acc[i].data[f.id] ?? '') === v);
    const set = v => ids.length === 1 ? saveAcc(a, { data: { [f.id]: v } }) : mut('rows_set', { items: ids.map(id => ({ id, data: { [f.id]: v } })) });
    const items = [];
    if (ids.length > 1) items.push({ head: `${f.label} · ${nf(ids.length)} dòng đang chọn` });
    for (const v of optVals(f)) { const st = optStyle(f, v), ic = st.i && st.i !== 'none' && st.m !== 'text' ? st.i : null;
      items.push({ ...(ic ? { icon: ic } : { dot: st.c || '#98a2b3' }), label: v, check: cur(v), fn: () => set(v) }) }
    if (items.length) items.push({ sep: 1 });
    items.push({ icon: 'x', label: 'Bỏ trống', check: cur(''), fn: () => set('') });
    const r = td.getBoundingClientRect(); showMenu(r.left, r.bottom - 2, items);
    if (POP) POP.classList.add('hx-selm');
  }, true);

  /* ── 12. Cài đặt: sửa thoải mái → bấm Lưu mới ghi và vẽ lại bảng 1 lần; kéo thả để đổi thứ tự ──
     Trước: mỗi lần sửa 1 ô (tên, kiểu, tùy chọn, màu…) là ghi ngay + tải lại + vẽ lại cả bảng lớn phía sau → giật, chờ.
     Giờ: sửa tên / kiểu / tùy chọn / màu / icon / khóa chính / thứ tự chỉ giữ trong cửa sổ (thanh dưới: "N thay đổi chưa lưu · Hủy · Lưu").
     Thêm / xoá (có hỏi xác nhận) vẫn ghi ngay nhưng không vẽ lại bảng; bấm Lưu (hoặc đóng cửa sổ) mới vẽ lại 1 lần.
     Đổi thứ tự: kéo tay nắm ⋮⋮ ở đầu dòng (bộ phận, owner cùng cấp, tab, trường, trạng thái). */
  const seOn = () => !!document.querySelector('#modal .sg');
  const seN = () => SE.pend.size + SE.order.size + SE.st.size + SE.pk.size;
  const seClear = () => { SE.pend.clear(); SE.order.clear(); SE.st.clear(); SE.pk.clear() };
  const metaObj = (a, id) => a === 'field' ? I.field[id] : a === 'tab' ? I.tab[id] : a === 'owner' ? I.own[id] : a === 'dept' ? S.meta.depts.find(d => d.id === id)
    : a === 'status' ? S.meta.tabs.reduce((x, t) => x || t.statuses.find(s => s.id === id), null) : null;
  /* ô cài đặt có data-api: giữ nháp thay vì ghi ngay (đổi cha/bộ phận của owner, bật Tải riêng vẫn ghi ngay như cũ) */
  document.addEventListener('change', e => {
    if (!seOn()) return;
    const el = e.target.closest && e.target.closest('#modal [data-api]'); if (!el) return;
    const a = el.dataset.api, k = el.dataset.k, id = +el.dataset.id;
    if ((a === 'owner' && (k === 'parent_id' || k === 'dept_id')) || k === 'lazy' || !['field', 'status', 'tab', 'dept', 'owner'].includes(a)) return;
    e.stopImmediatePropagation();
    let v = el.type === 'checkbox' ? el.checked : el.value; if (k === 'link_tab') v = v ? +v : null;
    const key = a + ':' + id, p = SE.pend.get(key) || { api: a, id, vals: {} }; p.vals[k] = v; SE.pend.set(key, p);
    const o = metaObj(a, id); if (o) o[k] = v;
    if (k === 'type' || k === 'link_tab') drawSettings(); else seFoot();
  }, true);
  /* thao tác ghi ngay trong Cài đặt (thêm, xoá, khóa trùng, bật tô màu…): ghi + lấy meta mới, KHÔNG vẽ lại bảng */
  const SEP = new Set(['field', 'status', 'tab', 'dept', 'owner', 'reorder', 'delete', 'tab_keys', 'tab_pk', 'opt_colors', 'grp_icon', 'hist_cfg']);
  { const _m = mut; mut = async function (path, body) {
      if (!seOn() || !SEP.has(path)) return _m.apply(this, arguments);
      const r = await api(path, body);
      await load(path === 'delete' || (path === 'tab' && body && 'lazy' in body));
      SE.render = 1; seFoot(); return r;
    } }
  /* dữ liệu mới về trong lúc đang sửa (thời gian thực, thêm/xoá…): giữ nguyên các nháp */
  function seReapply() {
    for (const p of SE.pend.values()) { const o = metaObj(p.api, p.id); if (o) Object.assign(o, p.vals) }
    for (const o of SE.order.values()) orderApply(o.table, o.grp, o.ids);
  }
  { const _l = load; load = async function () { const r = await _l.apply(this, arguments); if (seN()) seReapply(); return r } }
  /* thanh dưới cửa sổ Cài đặt */
  function seFoot() {
    const md = document.querySelector('#modal .modal'); if (!md || !md.querySelector('.sg')) return;
    let f = md.querySelector(':scope > .hx-sefoot');
    if (!f) { md.insertAdjacentHTML('beforeend', `<footer class="hx-sefoot"><span class="hx-sen mut"></span><div class="grow"></div><button class="btn outline" data-a="hxsecancel">Hủy</button><button class="btn pri" data-a="hxsesave">${ico('check', 16)}<span>Lưu</span></button></footer>`); f = md.querySelector(':scope > .hx-sefoot') }
    const n = seN();
    f.querySelector('.hx-sen').textContent = SE.busy ? 'Đang lưu…' : n ? `${nf(n)} thay đổi chưa lưu` : SE.render ? 'Đã ghi — bấm Lưu để cập nhật bảng' : 'Chưa có thay đổi';
    f.querySelector('[data-a=hxsesave]').disabled = !!SE.busy || !(n || SE.render);
    f.querySelector('[data-a=hxsecancel]').disabled = !!SE.busy || !n;
  }
  async function seSave() {
    if (SE.busy) return; SE.busy = 1; seFoot();
    try {
      // đổi thứ tự trường không được làm đổi khóa chính: chưa đặt khóa riêng mà cột đầu đổi → ghim khóa hiện tại
      for (const o of SE.order.values()) if (o.table === 'fields') { const t = I.tab[+o.grp.slice(1)];
        if (t && !SE.pk.has(t.id) && t.fields[0] && posOrder(t)[0] && t.fields[0].id !== posOrder(t)[0].id) SE.pk.set(t.id, t.fields[0].id) }
      for (const [k, p] of [...SE.pend]) { await api(p.api, { id: p.id, ...p.vals }); SE.pend.delete(k) }
      for (const [k, o] of [...SE.order]) { await api('reorder', { table: o.table, ids: o.ids }); SE.order.delete(k) }
      for (const [fid, d] of [...SE.st]) { await api('opt_colors', { field_id: fid, colors: d.colors, icons: d.icons, mode: d.mode }); SE.st.delete(fid) }
      for (const [tid, fid] of [...SE.pk]) { await api('tab_pk', { tab_id: tid, field_id: fid }); SE.pk.delete(tid) }
      SE.render = 0;
      await load(); renderAll();
    } catch (e) { /* api đã báo lỗi; phần chưa ghi vẫn giữ để bấm Lưu lại */ }
    finally { SE.busy = 0; if (seOn()) drawSettings() }
  }
  Object.assign(ACT, {
    hxsesave() { return seSave() },
    async hxsecancel() { seClear(); closePop(); await load(); if (seOn()) drawSettings() },
  });
  { const _t = tryCloseModal; tryCloseModal = async function () {
      if (seOn() && seN()) {
        if (await confirmBox(`Còn ${nf(seN())} thay đổi chưa lưu. Lưu trước khi đóng?`, 'Lưu', 'check', 'pri')) await seSave();
        else { seClear(); await load() }
      }
      return _t.apply(this, arguments);
    } }
  { const _cm = closeModal; closeModal = function () {
      const was = seOn(), r = _cm.apply(this, arguments);
      if (was && !seOn()) {
        if (seN()) { seClear(); load().then(() => renderAll()).catch(() => {}) }
        else if (SE.render) { SE.render = 0; renderAll() }
      }
      return r;
    } }
  /* kéo thả đổi thứ tự: tay nắm ⋮⋮ ở đầu dòng thay cho 2 nút lên / xuống */
  mvBtns = function (t, id) { return `<span class="hx-drag" data-t="${t}" data-id="${id}" title="Kéo để đổi thứ tự" aria-label="Kéo để đổi thứ tự">${ico('grip', 15)}</span><button class="btn icon ghost sm" data-a="del" data-t="${t}" data-id="${id}">${ico('trash', 15)}</button>` };
  const dragGroup = (t, id) => { if (t === 'owners') { const o = I.own[id]; return o && I.own[o.parent_id] && I.own[o.parent_id].dept_id === o.dept_id ? 'k' + o.parent_id : 'r' + (o ? o.dept_id : 0) }
    return t === 'fields' || t === 'statuses' ? 't' + SET.tab : 'all' };
  function orderApply(t, grp, ids) {
    const rank = new Map(ids.map((id, i) => [id, i])), rk = x => { const k = x && typeof x === 'object' ? x.id : x; return rank.has(k) ? rank.get(k) : 1e9 };
    const srt = arr => { if (arr) arr.sort((a, b) => rk(a) - rk(b)) };
    if (t === 'fields') ids.forEach((id, i) => { if (I.field[id]) I.field[id].pos = i + 1 });
    else if (t === 'statuses') { const tb = I.tab[+grp.slice(1)]; if (tb) srt(tb.statuses) }
    else if (t === 'tabs') { srt(S.meta.tabs); S.meta.tabs.forEach((x, i) => { x.pos = i + 1 }) }
    else if (t === 'depts') srt(S.meta.depts);
    else if (t === 'owners') srt(grp[0] === 'k' ? I.kids[+grp.slice(1)] : I.roots[+grp.slice(1)]);
  }
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest && e.target.closest('#modal .hx-drag'); if (!h || e.button !== 0) return;
    const row = h.closest('.srow'); if (!row || !row.parentElement) return;
    const t = h.dataset.t, grp = dragGroup(t, +h.dataset.id);
    const rows = [...row.parentElement.children].filter(r => { const x = r.querySelector(`.hx-drag[data-t="${t}"]`); return x && x.closest('.srow') === r && dragGroup(t, +x.dataset.id) === grp });
    if (rows.length < 2) return;
    e.preventDefault(); try { h.setPointerCapture(e.pointerId) } catch (x) { /* bỏ qua */ }
    const R = rows.map(r => r.getBoundingClientRect()), i0 = rows.indexOf(row), y0 = e.clientY; let to = i0;
    row.classList.add('hx-lift'); rows.forEach(r => { if (r !== row) r.classList.add('hx-dz') }); document.body.classList.add('hx-dragging');
    const move = ev => {
      const dy = ev.clientY - y0, c = R[i0].top + R[i0].height / 2 + dy; row.style.transform = `translateY(${dy}px)`;
      to = i0; for (let k = 0; k < rows.length; k++) { const m = R[k].top + R[k].height / 2; if (k > i0 && c > m) to = k; if (k < i0 && c < m && to === i0) to = k }
      rows.forEach((r, k) => { if (k === i0) return; const sh = k > i0 && k <= to ? R[k - 1].top - R[k].top : k < i0 && k >= to ? R[k + 1].top - R[k].top : 0; r.style.transform = sh ? `translateY(${sh}px)` : '' });
    };
    const up = ev => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      try { h.releasePointerCapture(ev.pointerId) } catch (x) { /* bỏ qua */ }
      rows.forEach(r => { r.style.transform = ''; r.classList.remove('hx-dz', 'hx-lift') }); document.body.classList.remove('hx-dragging');
      if (to === i0 || ev.type === 'pointercancel') return;
      const ids = rows.map(r => +r.querySelector('.hx-drag').dataset.id), [m] = ids.splice(i0, 1); ids.splice(to, 0, m);
      SE.order.set(t + '|' + grp, { table: t, grp, ids }); orderApply(t, grp, ids); drawSettings();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }, true);
  /* vẽ lại cửa sổ: tay nắm lên đầu dòng, giữ vị trí cuộn, thanh Lưu */
  { const _ds = drawSettings; drawSettings = function () {
      const sp = document.querySelector('#modal .spane'), top = sp ? sp.scrollTop : 0, r = _ds.apply(this, arguments);
      document.querySelectorAll('#modal .srow > .hx-drag').forEach(h => { const row = h.parentElement; if (row.firstElementChild !== h) row.insertBefore(h, row.firstElementChild) });
      const sp2 = document.querySelector('#modal .spane'); if (sp2 && top) sp2.scrollTop = top;
      seFoot(); return r;
    } }

  /* ── 13. Thao tác trên dữ liệu lớn: không mất chỗ đang nhìn, không bấm chồng ──
     · Sắp xếp / lọc / sửa / dữ liệu mới về: bản gốc dựng lại khung bảng → giữ cuộn dọc nhưng cuộn ngang về đầu.
       Giờ cùng 1 bảng thì giữ cả 2 chiều. Đổi sắp xếp / bộ lọc → giữ nguyên vị trí cuộn; dữ liệu đổi (sửa, thêm, thời gian thực) →
       neo theo dòng đang ở đầu màn hình, dòng mới chen phía trên không đẩy lệch chỗ đang xem. Làm mới / chuyển trang vẫn lên đầu như cũ.
     · Đang ghi (lưu, sửa hàng loạt, đổi trạng thái / owner, xoá, nhập…) > 0,2 giây: lớp phủ nhẹ chặn bấm + phím, thẻ tiến trình góc dưới;
       xong tự tắt (im lặng), lỗi → báo rõ. Thao tác rất lớn đã có thẻ tiến độ riêng (mục 9) → chỉ thêm lớp phủ. */
  const viewSig = () => JSON.stringify([S.sort && S.sort[S.tab], S.q, S.fl && S.fl[S.tab], [...(S.st || [])], [...(S.tf || [])], S.dept, S.owner, S.devf, S.idf, S.page]);
  const VW = { sig: {} };   // bộ lọc / sắp xếp lần vẽ trước của từng tab (bản gốc còn dựng sẵn ngầm các tab khác)
  { const _rb = renderBody; renderBody = function () {
      const tw0 = document.querySelector('#main #tw'), same = !!tw0 && tw0.dataset.hxTab === String(S.tab) && isTbl() && !ovOn();
      const L = tw0 ? tw0.scrollLeft : 0, T = tw0 ? tw0.scrollTop : 0, sig = viewSig(), sameView = sig === VW.sig[S.tab];
      let anc = null;   // dòng đang ở đầu vùng nhìn
      if (same && sameView && typeof VROWH === 'number' && S.view && S.view.length) { const i = Math.min(S.view.length - 1, Math.floor(T / VROWH)); anc = { id: S.view[i], off: T - i * VROWH } }
      const r = _rb.apply(this, arguments);
      const tw = document.querySelector('#main #tw'), reset = (typeof RL !== 'undefined' && RL) || HX.reloading || S.scrollTo != null;
      if (tw && same && !reset) {
        if (tw.scrollLeft !== L) tw.scrollLeft = L;
        if (anc) { const j = S.view.indexOf(anc.id); if (j >= 0) { const nt = j * VROWH + anc.off; if (Math.abs(tw.scrollTop - nt) > 1) { tw.scrollTop = nt; if (typeof renderWindow === 'function') renderWindow(true) } } }
      }
      if (tw) tw.dataset.hxTab = String(S.tab);
      VW.sig[S.tab] = sig;
      return r;
    } }
  const BUSY = { n: 0, el: null, card: null, t: 0, big: 0 };
  const VERB = { delete_accounts: 'Đang xoá', delete: 'Đang xoá', quick: 'Đang thêm', bulk: 'Đang nhập', status_set: 'Đang đổi trạng thái', owner_set: 'Đang chuyển owner',
    device_set: 'Đang gán thiết bị', mass_set: 'Đang cập nhật', rows_set: 'Đang cập nhật', device_bulk: 'Đang cập nhật thiết bị' };
  const nRows = b => b && (Array.isArray(b.ids) ? b.ids.length : Array.isArray(b.items) ? b.items.length : Array.isArray(b.rows) ? b.rows.length : 1) || 1;
  function busyOn(path, body) {
    if (BUSY.n++ > 0) return;
    const n = nRows(body), big = BIGOPS[path] && n > BIG_MIN;
    const label = (VERB[path] || (path === 'account' ? (body && body.id ? 'Đang lưu' : 'Đang thêm') : 'Đang lưu')) + (n > 1 ? ` ${nf(n)} dòng` : '');
    BUSY.t = setTimeout(() => {
      const el = BUSY.el = document.createElement('div'); el.className = 'hx-busy'; el.setAttribute('aria-busy', 'true'); el.title = label + '…'; document.body.appendChild(el);
      if (!big) { BUSY.card = opCard(label, false); BUSY.card.el.classList.add('hx-spin', 'hx-top'); BUSY.card.stage('Đang ghi'); BUSY.card.set(0, 0, n > 1 ? `${nf(n)} dòng` : ''); BUSY.card.el.querySelector('.ldw-p').textContent = '' }
      else document.querySelectorAll('.ldw.hx-op').forEach(x => x.classList.add('hx-top'));
    }, 180);
  }
  function busyOff(err) {
    if (--BUSY.n > 0) return;
    clearTimeout(BUSY.t); if (BUSY.el) { BUSY.el.remove(); BUSY.el = null }
    const c = BUSY.card; BUSY.card = null;
    if (c) { if (err) c.fail(String(err && err.message || err).slice(0, 160)); else c.close() }
  }
  { const _m = mut; mut = async function (path, body) {
      busyOn(path, body);
      // ghi nhiều dòng: nạp lại thẳng từ máy chủ (chắc chắn đủ), không ghép từ các phần đã đẩy qua thời gian thực
      const many = nRows(body) > 1; if (many) HX.direct = (HX.direct || 0) + 1;
      try { const r = await _m.apply(this, arguments); busyOff(); return r }
      catch (e) { busyOff(e); throw e }
      finally { if (many) HX.direct-- }
    } }
  /* đang ghi: chặn phím (gõ, Enter, phím tắt) để không ra lệnh chồng; F5 / Ctrl+R vẫn dùng được */
  addEventListener('keydown', e => { if (!BUSY.el) return; if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^r$/i.test(e.key))) return; e.preventDefault(); e.stopImmediatePropagation() }, true);
})();
