/* HireX · chạy TRƯỚC JS gốc (build_ui.py chèn vào <head>).
   Dựng khung ngay: lần đầu mở trang, bản gốc phải chờ meta (tab, trường, bộ phận…) mới vẽ được khung → trắng trang.
   Giờ dùng meta đã lưu từ lần trước (localStorage, chỉ cấu trúc — không có dữ liệu tài khoản) để vẽ khung + dòng giả ngay,
   đồng thời vẫn hỏi meta mới; dữ liệu đầy đủ (kèm meta mới nhất) về sau sẽ thay hết. Chỉ áp cho lần hỏi meta đầu tiên. */
(() => {
  const K = 'hx.meta.v1', U = '/api/meta', f0 = window.fetch.bind(window);
  let first = true;
  window.fetch = function (u, o) {
    if (first && typeof u === 'string' && u === U && !(o && o.method && o.method !== 'GET')) {
      first = false;
      let c = null; try { c = localStorage.getItem(K) } catch (e) { /* chế độ riêng tư */ }
      const net = f0(u, o).then(r => { if (r.ok) r.clone().text().then(t => { try { localStorage.setItem(K, t) } catch (e) { /* đầy */ } }); return r });
      if (c) { net.catch(() => {}); return Promise.resolve(new Response(c, { status: 200, headers: { 'Content-Type': 'application/json' } })) }
      return net;
    }
    return f0(u, o);
  };
})();
