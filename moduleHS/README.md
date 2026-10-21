# moduleHS — các project riêng của THS gộp vào HireX

Mỗi project con là một thư mục: `moduleHS/<project>/`. Quy cách giống `src/modules/*` của HireX:

```
moduleHS/<project>/
  components/   UI (React client/server components) — mỗi mảng 1 file, không tách vụn
  core/         logic thuần (không I/O), test được bằng node --test
  server/       data (Supabase) + server actions / route handlers
  types.ts      kiểu dữ liệu dùng chung của project
  README.md     nguồn gốc (repo Python cũ), bảng đối chiếu hàm cũ → mới, việc còn lại
```

- Route/page vẫn nằm ở `src/app/(crm)/<đường-dẫn>/page.tsx`, chỉ import từ `@hs/<project>/...` (alias `@hs/*` → `moduleHS/*` trong `tsconfig.json`).
- Schema DB: `supabase/migrations/NNN_hs_<project>_*.sql`, bảng đặt tiền tố `hs_<project>_`.
- Quyền: dùng hệ `access` của HireX (`hasPermission("<project>.view")`), không tự làm đăng nhập riêng.
- Không gọi ra server ngoài (server-ahs…) — mọi thứ chạy trong HireX.

| Project | Nguồn gốc | Trạng thái |
| --- | --- | --- |
| `accountshs` | `ATOOL_TONGHOP/AccountsHS` (Python v7.py + chatbot/owl/checker/style/core_animation) | đang chuyển đổi |
