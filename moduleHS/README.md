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
- **Chạy ở đâu:** trên máy anh Tùng, lệnh `next dev` ở cổng **3005**. Dùng chung thư mục code và database với bản thật, tự cập nhật vài giây sau mỗi lần sửa code. Bản thật (cổng 3000, app.hirexmkt.online) không bị đụng tới.
- **Cài một lần** trên máy anh Tùng: nhấp đúp `moduleHS\HS-XEM-TRUOC-CAI-DAT.cmd` và đồng ý quyền Administrator. Lệnh này tạo task "HireX HS Preview", tự chạy mỗi khi đăng nhập Windows, và mở cổng 3005 trong mạng nội bộ.
- **Cách mở:**
  - Trong mạng nội bộ: `http://<IP máy anh Tùng>:3005` (IP ghi trong `runtime\hs-preview.txt`).
  - Qua Cloudflare: trỏ `tienich.hat11.io.vn` → `http://<IP>:3005`. Đi qua https thì micro mới dùng được.
- **Khi deploy:** bản xem trước tự nghỉ trong lúc `release.ps1` / `restart-web.ps1` chạy, xong thì tự bật lại. Build của nó nằm ở `runtime\hs-preview\next`. Log ghi ở `runtime\hs-preview.log`.
