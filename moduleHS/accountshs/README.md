# accountshs — AccountsHS (Python v7) chạy trong HireX

Mục **Tài nguyên** của HireX (`/accounts`) chạy toàn bộ AccountsHS ngay trong HireX: cùng đăng nhập, cùng phân quyền, cùng Supabase, không còn server Python riêng.

## Kiến trúc
- **Giao diện = nguyên văn trang gốc của v7.py.** `ui/build_ui.py` lắp trang từ mã Python giống hệt `main()` của v7
  (HTML + Cú vọ chat + core_animation + `ui_tokenize` + THEME_BOOT). Không viết lại bằng React, nên UI/UX giống bản gốc 100%.
  Chỉ đổi đường dẫn: `/api/x` → `/api/hs/accountshs/x`, `/style/theme/` → `/api/hs/accountshs/theme/`, `/owl` → `/api/hs/accountshs/owl-page`.
- `/accounts` (`src/app/(crm)/accounts/page.tsx`) kiểm quyền rồi nhúng iframe cùng origin `/api/hs/accountshs/ui`. Cookie đăng nhập HireX đi kèm mọi request.
- **Backend viết lại bằng TypeScript**, giữ đúng tên route, JSON, mã lỗi của `do_GET`/`do_POST` (409 `{error}` khi xung đột, 500 `{error}`).
- **Đổi giao diện**: sửa bản Python gốc, rồi chạy lại
  `python moduleHS/accountshs/ui/build_ui.py <thư mục AccountsHS python> moduleHS/accountshs/ui`.
  Không sửa tay `ui/index.html` / `ui/owl.html`.

## Bố cục
```
moduleHS/accountshs/
  ui/        build_ui.py  lắp trang · index.html (trang chính) · owl.html (Cú vọ tự động) · themes/*.css + preview/*.jpg
  types.ts   kiểu dữ liệu (đúng cột ahs_* và JSON của v7)
  core/      text.ts      fold/ngày/định dạng (dùng cho Cú vọ)
  server/    handler.ts   một cửa /api/hs/accountshs/<name> (+ ui, owl-page, internal/tick)
             db.ts        Supabase đặc quyền, requireHs(view|edit|manage), nhật ký, pages() đọc quá 1000 dòng
             accounts-data.ts · accounts-routes.ts   đọc / ghi (meta, data, delta, bulk2, mass_set, upsert, delete…)
             backup.ts · attachments.ts · docx-html.ts · themes.ts
             owl.ts · owl-rules.ts · owl-hint.ts · owl-query.ts   Cú vọ chat (routes ai_*)
             checker.ts · checker-mods.ts   Vọng gác · owl-auto.ts   Cú vọ tự động
  worker/    hs-accountshs-worker.py + script Python dự phòng của Vọng gác / owl (mặc định chạy bằng Node)
  tests/     node --test moduleHS/accountshs/tests/*.test.mjs
```
Điểm nối bên ngoài `moduleHS/`: `src/app/(crm)/accounts/page.tsx`, `src/app/api/hs/accountshs/[...name]/route.ts`, migration `supabase/migrations/1xx_hs_accountshs.sql`.

## Quyết định đã chốt
- **Dữ liệu**: dùng nguyên các bảng `ahs_*` có sẵn trong Supabase của HireX. Migration khai báo DDL idempotent, trigger lịch sử, hàm SQL, bảng `ahs_jobs` / `ahs_ai_samples`, bucket `hs-accountshs`.
- **Quyền**:
  - `accounts.view`: xem, thêm, sửa, xoá, nhập (như bản Python).
  - Tùy chỉnh, sao lưu / khôi phục, cấu hình Cú vọ: Quản trị viên workspace.
- **Bảo mật**: `ahs_*` bật RLS và không có policy; chỉ server đọc, sau khi đã kiểm quyền. Không có mật khẩu Postgres hay token trong code.
- Supabase chỉ trả tối đa 1000 dòng mỗi lần đọc, nên mọi chỗ đọc toàn bảng đều đi qua `pages()`.

## Khác bản gốc (có chủ ý)
- Đăng nhập và quyền theo HireX.
- File đính kèm, sao lưu, dữ liệu AI lưu trên Supabase Storage (`hs-accountshs/{att,backup,ai}`).
- Cú vọ chỉ dùng OpenAI, qua `src/lib/openai/responses.ts` (key `OPENAI_API_KEY`). Ô chọn nhà cung cấp vẫn hiện nhưng không có tác dụng.
- Việc nền (sao lưu tự động, Vọng gác, Cú vọ tự động) chạy qua worker và `POST /api/hs/accountshs/internal/tick`.

## Cài đặt / vận hành
1. **Migration**: chạy SQL trên Supabase trước, rồi mới thêm file migration, để `release.ps1` không thấy migration lạ.
2. **Worker**:
   - `pip install -r moduleHS/accountshs/worker/requirements.txt`
   - `.env.local` cần `SUPABASE_DB_URL` và `AUTOMATION_CRON_SECRET`.
   - Chạy một lần với quyền Administrator: `powershell -ExecutionPolicy Bypass -File moduleHS\accountshs\worker\install-worker-task.ps1`
   - Log ở `runtime/hs-accountshs-worker*.log`.
3. Tiến trình web nên đặt `TZ=Asia/Ho_Chi_Minh`, để "hôm nay / tháng này" tính theo giờ Việt Nam.
4. Sau khi chạy ổn: tắt `v7.py` / `server-ahs` và đổi mật khẩu Postgres (mật khẩu cũ từng nằm trong `ahs_pg.json`).

Mã Python gốc để đối chiếu (`_src_python/`, `ahs_pg.json`) không bao giờ commit.
