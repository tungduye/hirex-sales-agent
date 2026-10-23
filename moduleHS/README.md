# moduleHS — các project riêng của THS gộp vào HireX

Mỗi project con là một thư mục `moduleHS/<project>/`. Project lớn chia thư mục giống `src/modules/*` của HireX:

```
moduleHS/<project>/
  types.ts      kiểu dữ liệu dùng chung của project
  core/         logic thuần (không I/O), test được bằng node --test
  server/       dữ liệu + route handler
  components/   UI (React), mỗi mảng 1 file, không tách vụn
  README.md     nguồn gốc, bảng đối chiếu cũ → mới, cách vận hành, việc còn lại
```

Project nhỏ thì để phẳng, mỗi chức năng 1 file, như `record/`.

- **Đường dẫn**: trang nằm ở `src/app/(crm)/<đường-dẫn>/page.tsx`, API ở `src/app/api/hs/<project>/`. Import mã bằng đường dẫn tương đối tới `moduleHS/…`, không sửa tsconfig.
- **Dữ liệu**: bảng Supabase tiền tố riêng (vd `ahs_`), bật RLS và chỉ server đọc sau khi đã kiểm quyền. File để ở `runtime/<project>/`.
- **Quyền**: dùng hệ `access` của HireX, không tự làm đăng nhập riêng.
- **Mã nguồn gốc** để đối chiếu đặt ở `moduleHS/<project>/_src_python/` (gitignore, không push).

| Project | Nguồn gốc | Trạng thái |
| --- | --- | --- |
| `accountshs` | `ATOOL_TONGHOP/AccountsHS` (v7.py + chatbot/owl/checker/crm/style/core_animation) | đã chuyển, xem `accountshs/README.md` |
| `record` | `meeting-hub` (ghi âm → biên bản, dịch trực tiếp, đọc văn bản, Zalo) | đã chuyển, mục **Tiện ích › Cuộc họp**, xem `record/README.md` |

## Bản xem trước (sửa là thấy ngay, không cần deploy)
- **Chạy ở đâu:** trên máy anh Tùng, lệnh `next dev` ở cổng **3005** (app2.hirexmkt.online): sửa code là có ngay, không build, không cần ai bấm gì. Dev 15 phút chưa lên thì tạm chạy bản build gần nhất 30 phút rồi thử lại; dev treo thì tự bật lại. Sửa `HS-XEM-TRUOC.ps1` thì script tự nạp bản mới. Bản thật (cổng 3000, app.hirexmkt.online) không bị đụng tới.
- **Cài một lần** trên máy anh Tùng: nhấp đúp `moduleHS\HS-XEM-TRUOC-CAI-DAT.cmd` và đồng ý quyền Administrator. Lệnh này tạo task "HireX HS Preview", tự chạy khi máy khởi động (kể cả chưa đăng nhập) và khi đăng nhập, tự bật lại khi sập; đồng thời mở cổng 3005 trong mạng nội bộ.
- **Cách mở:**
  - Trong mạng nội bộ: `http://<IP máy anh Tùng>:3005` (IP ghi trong `runtime\hs-preview.txt`).
  - Qua Cloudflare: trỏ `tienich.hat11.io.vn` → `http://<IP>:3005`. Đi qua https thì micro mới dùng được.
- **Khi deploy:** bản xem trước tự nghỉ trong lúc `release.ps1` / `restart-web.ps1` chạy, xong thì tự bật lại. Cache dev nằm ở `runtime\hs-preview\next`. Log ghi ở `runtime\hs-preview.log`.

## Key OpenAI (23/10/2026)
- `HS_OPENAI_API_KEY` trong `.env.local`: Ghi âm (record/data.ts `C.key`) và Kiểm thử (qa/api.ts) — để xem riêng token của dự án HS trên OpenAI.
- Soda và Cú vọ (Tài nguyên) dùng `OPENAI_API_KEY` chung của HireX.
- Soda ↔ Cú vọ: câu hỏi tài nguyên rõ ràng được Cú vọ trả lời thẳng (accountshs/server/soda.ts `sodaFast`, không gọi model Soda); câu trả lời có thẻ kết quả (accountshs/soda-card.tsx) với nút "Mở trong Tài nguyên" → host.tsx chuyển trang, Cú vọ hỏi lại đúng câu (dùng lại cách hiểu đã có, owl.ts `RECENT`), nút "Quay lại Trợ lý".
