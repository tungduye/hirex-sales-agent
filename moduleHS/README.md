# moduleHS — các project riêng của THS gộp vào HireX

Mỗi project con là một thư mục: `moduleHS/<project>/`. Quy cách giống `src/modules/*` của HireX:

```
moduleHS/<project>/
  types.ts      kiểu dữ liệu dùng chung của project
  core/         logic thuần (không I/O), test được bằng node --test
  server/       dữ liệu (Supabase) + route handler
  components/   UI (React) — mỗi mảng 1 file, không tách vụn
  README.md     nguồn gốc, bảng đối chiếu cũ → mới, cách vận hành, việc còn lại
```

- Trang vẫn nằm ở `src/app/(crm)/<đường-dẫn>/page.tsx`, API ở `src/app/api/hs/<project>/`, import mã qua alias `@hs/*` → `moduleHS/*` (tsconfig).
- Schema DB: `supabase/migrations/NNN_hs_<project>.sql`, bảng tiền tố riêng (vd `ahs_`), RLS khoá, chỉ server đọc sau khi kiểm quyền.
- Quyền dùng hệ `access` của HireX (`permission-catalog.ts`), không tự làm đăng nhập riêng.
- Mã nguồn gốc để đối chiếu đặt ở `moduleHS/<project>/_src_python/` (gitignore, không push).

| Project | Nguồn gốc | Trạng thái |
| --- | --- | --- |
| `accountshs` | `ATOOL_TONGHOP/AccountsHS` (v7.py + chatbot/owl/checker/crm/style/core_animation) | đã chuyển — xem `accountshs/README.md` |
