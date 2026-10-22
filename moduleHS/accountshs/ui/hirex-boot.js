/* HireX · chạy TRƯỚC JS gốc (build_ui.py chèn vào <head>).
   1. Mở Tài nguyên = luôn vào Tổng quan (tab Tất cả › Tổng quan, không ô tìm): bản gốc đọc lựa chọn cũ (localStorage) ngay khi chạy
      và vẽ khung lần đầu TRƯỚC khi hirex-patch.js kịp chạy → phải sửa lựa chọn đã lưu từ đây. Phạm vi, bộ lọc từng tab… giữ nguyên.
   2. Dựng khung ngay: lần hỏi meta đầu tiên trả luôn meta đã lưu từ lần trước (chỉ cấu trúc, không có dữ liệu tài khoản),
      đồng thời vẫn hỏi meta mới.
   3. Không chờ nối tiếp: trang /accounts của HireX bắt đầu tải meta + data ngay khi trình duyệt nhận HTML (window.__hxBoot,
      song song với dựng trang HireX + tải trang này). Lần hỏi đầu tiên ở đây dùng lại đúng kết quả đó (cùng nguồn, < 60 giây). */
(() => {
  try {
    localStorage.setItem('ahs.ov', '1');
    const PK = 'accountshs.v2', p = JSON.parse(localStorage.getItem(PK) || 'null');
    if (p && (p.tab !== 'all' || p.q)) { p.tab = 'all'; p.q = ''; localStorage.setItem(PK, JSON.stringify(p)) }
  } catch (e) { /* chế độ riêng tư: bản gốc tự về mặc định */ }

  const K = 'hx.meta.v1', U = '/api/meta', D = '/api/data?lz=', f0 = window.fetch.bind(window);
  let pre = null;
  try { const b = window.parent !== window && window.parent.__hxBoot; if (b && Date.now() - b.t < 60000) { pre = b; window.parent.__hxBoot = null } } catch (e) { /* khác nguồn */ }
  const take = (k, u, o) => { const pr = pre && pre[k]; if (!pr) return null; pre[k] = null;
    return pr.then(r => r && r.ok ? r : f0(u, o), () => f0(u, o)) };   // tải sẵn lỗi / hết phiên → hỏi lại như thường
  let first = true;
  window.fetch = function (u, o) {
    const get = typeof u === 'string' && !(o && o.method && o.method !== 'GET');
    if (get && u === D) { const r = take('data', u, o); if (r) return r }
    if (first && get && u === U) {
      first = false;
      let c = null; try { c = localStorage.getItem(K) } catch (e) { /* chế độ riêng tư */ }
      const net = (take('meta', u, o) || f0(u, o)).then(r => { if (r.ok) r.clone().text().then(t => { try { localStorage.setItem(K, t) } catch (e) { /* đầy */ } }); return r });
      if (c) { net.catch(() => {}); return Promise.resolve(new Response(c, { status: 200, headers: { 'Content-Type': 'application/json' } })) }
      return net;
    }
    return f0(u, o);
  };
})();
