# AccountsHS → HireX: nghiên cứu & kế hoạch convert (21/10/2026)

Nguồn: `_src_python/` (104 file code, ~26k dòng; v7.py 7.489 dòng = ~2.4k Python + ~5k HTML/CSS/JS trong chuỗi `HTML`).
Chưa đọc từng dòng các module phụ — mục nào ghi "cần xác nhận" là suy ra từ cấu trúc/import.

## 1. Ba phát hiện quyết định cách làm
1. **Dữ liệu đã ở sẵn trong Supabase của HireX.** `ahs_pg.json` trỏ cùng project Supabase mà `.env.local` của HireX dùng (tiền tố ref trùng `dyhi…`). Bảng `ahs_*` (13 bảng) đã tồn tại, hiện ~1.275 tài khoản, 10.442 lượt check. → **Không cần import dữ liệu**; chỉ cần đưa DDL vào migration `118_hs_accountshs.sql` (idempotent) và bật RLS theo workspace. Quyết định "chuyển sang Supabase" = nhận nguyên bảng cũ, không đổi tên.
2. **Python đang tự viết lại những thứ nền tảng đã có**: HTTP server, nén gzip, dịch SQL sqlite→pg (1.020 dòng `ahs_pg.py`), ghi OOXML xlsx bằng tay, đọc docx bằng XML tay, sao lưu/khôi phục tự chế, không đăng nhập (chỉ 127.0.0.1). → Bỏ hết, dùng thư viện/khung HireX (bảng §2).
3. **Mô hình tải khác hẳn.** Python nạp *toàn bộ* tài khoản về trình duyệt rồi lọc/tìm phía client (`S.accs`, delta theo `updated`). Mục tiêu ~10 triệu dòng thì phải đổi: lọc/tìm/sắp xếp/đếm chạy ở Postgres, phân trang keyset, bảng ảo hoá chỉ giữ cửa sổ đang xem. Đây là phần tốn công nhất của "convert 100%": **hành vi giữ nguyên, cách lấy dữ liệu đổi**.

## 2. Tự làm tay (Python) → dùng sẵn (HireX)
| Python | Thay bằng | Ghi chú |
| --- | --- | --- |
| `ahs_pg.py` translate/guard/pipeline/COPY/ensure_schema | `@supabase/supabase-js` + migration SQL + RLS | Hàm `ahs_typeof/ahs_jpath` chỉ để dịch sqlite → bỏ. Giữ 4 trigger lịch sử (`ahs_f_hist_*`) nguyên văn. |
| `http.server` class `H`, `ROUTES`, `_send` gzip | Server Actions + Route Handlers (`src/app/api/hs/accountshs/*`) | Next tự nén; ROUTES (`account, bulk, mass_set…`) → server actions cùng tên. |
| Không đăng nhập; `LOCK` toàn cục | `getAccountContext` + `hasPermission("accounts.view")` (+ thêm `accounts.edit/manage`) + RLS | Ghi sổ `ahs_logs` kèm `userId`. |
| `write_xlsx`/`xlsx_all` (tự ghép zip XML) | `exceljs` (đã có) | |
| `xlsx_sheets` (xem trước xlsx), nhập xlsx | `read-excel-file` (đã có) | |
| `docx_html` (parse XML tay) | `mammoth` (thêm 1 dep) — HireX đã có `docx.test.mjs` nên kiểm tra helper sẵn trước | cần xác nhận |
| Đính kèm lưu file đĩa (`attachments/<id>`) | Supabase Storage bucket + cơ chế Phase 5 attachments của HireX | |
| `bk_loop`, `.ahs.gz`, prune, restore | Backup/PITR của Supabase + route xuất/nhập thủ công; lịch tự động theo mẫu Windows Task Scheduler + `/api/internal/*` có sẵn | giữ nút "Sao lưu/Khôi phục" ở UI |
| `llm_plan` (gọi AI ngoài tự viết) | `src/lib/openai/responses.ts` | |
| `AI_index.db` 571 MB SQLite cục bộ (chỉ mục Cú vọ) + `AI_cache.db` | Postgres FTS / `pg_trgm` trên `ahs_accounts.data` | bỏ file 571 MB; cần xác nhận phạm vi `AI_engine` |
| Combobox, popover, modal, toast, confirmBox tự viết | Giữ **CSS gốc** (anh đã chọn) nhưng viết thành React component dùng lại (1 file `components/ui-kit.tsx`) thay vì HTML chuỗi + `ACT[data-a]` | không `onclick` inline |
| Quill từ CDN | giữ Quill hoặc thay editor HireX nếu có | cần xác nhận |
| `style/themes/*.css` (30 theme) + `core_animation.py` | giữ CSS, nạp theo theme, scope dưới `.hs-acc` | không ảnh hưởng phần còn lại của HireX |
| `crm/` (kéo chat-stats về) | **trùng chức năng** với `modules/inbox`, `customers/partner-sync` của HireX | cần xác nhận trước khi port |

## 3. Phần không chuyển thẳng sang Next.js được — cần anh chọn
`checker/` (Vọng gác check live FB/Email/Telegram/Proxy), `owl/` + `automation.py` (kịch bản tự động, đăng bài FB) dùng **`curl_cffi`** (giả TLS Chrome) → Node không có tương đương. Hướng đề xuất: giữ chúng là **worker** (`scripts/`), Next chỉ gọi/nhận kết quả qua `/api/internal/*` (đúng mẫu `ai-recruiter-worker.mjs`), hoặc dùng Playwright (HireX đã có `facebook-profile-bridge`). Port sang Node chỉ làm được với các check không cần giả TLS (Telegram, Gmail, Proxy).

## 4. Bố cục đích (mỗi mảng 1 nơi, ít file)
```
moduleHS/accountshs/
  types.ts
  core/        search-syntax.ts (cú pháp tìm v4→SQL) · fields.ts (định dạng cột, bulk diff) · owl-nlu.ts (luật Cú vọ)
  server/      accounts-data.ts (đọc/phân trang) · accounts-actions.ts (ROUTES) · backup.ts · attachments.ts · owl.ts · checker.ts
  components/  accounts-app.tsx (bảng, lọc, chi tiết) · reports.tsx · devices.tsx · settings.tsx · owl-chat.tsx · ui-kit.tsx · themes/*.css
src/app/(crm)/accounts/page.tsx   ← thay iframe server-ahs bằng <AccountsApp/>
supabase/migrations/118_hs_accountshs.sql
```
Alias `@hs/*` → `moduleHS/*` thêm vào `tsconfig.json` (và `next.config.ts` nếu cần).

## 5. Thứ tự làm
- **Đợt 1 (lõi)**: migration 118 + RLS · đọc meta (tab/trường/trạng thái/owner/bộ phận) · bảng tài khoản phân trang + tìm/lọc/sắp xếp · chi tiết/sửa/xoá · liên kết · lịch sử · gắn vào `/accounts`, gỡ iframe.
- **Đợt 2**: bulk/mass_set/nhập-xuất xlsx · thiết bị · báo cáo & sơ đồ liên kết · sao lưu · đính kèm.
- **Đợt 3**: Cú vọ (luật + AI) · theme + animation.
- **Đợt 4**: Vọng gác/Owl/automation (worker) · `crm/` nếu còn cần.
- Mỗi đợt: đối chiếu hành vi với `v7.py` bằng test (`tests/accountshs-*.test.mjs`), chạy `typecheck` + `lint`.

## 6. Bảo mật — làm ngay
`ahs_pg.json` chứa **mật khẩu Postgres (superuser) của đúng project HireX** dạng chữ thường và nằm trong file zip gửi lên. Em **không chép** file này vào repo. Anh nên **đổi mật khẩu DB** (Supabase → Database → Reset password) rồi cập nhật chỗ Python còn chạy; HireX dùng `SUPABASE_SECRET_KEY` + RLS, không dùng mật khẩu này. Các bảng `ahs_*` chứa mật khẩu/cookie tài khoản: giữ RLS bật, không policy cho `anon/authenticated`, chỉ truy cập qua server (service role) sau khi kiểm `accounts.view`.
