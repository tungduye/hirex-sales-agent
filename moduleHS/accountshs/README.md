# accountshs — AccountsHS (Python v7) chạy trong HireX

Mục **Tài khoản** của HireX (`/accounts`) trước đây là iframe tới `server-ahs.hat11.io.vn` (Python `v7.py` + `ahs_pg.py`).
Nay toàn bộ AccountsHS chạy ngay trong HireX: cùng đăng nhập, cùng phân quyền, cùng Supabase, không còn server riêng.

## Quyết định đã chốt
- **Dữ liệu dùng nguyên bảng `ahs_*`**: chúng vốn nằm sẵn trong project Supabase của HireX. Không cần import, không đổi tên.
  Migration `supabase/migrations/121_hs_accountshs.sql` khai báo DDL (idempotent), giữ 4 trigger lịch sử, thêm hàm SQL, bảng `ahs_jobs`, `ahs_ai_samples` và bucket Storage `hs-accountshs`.
- **Phạm vi: toàn bộ**: v7.py, Cú vọ (chatbot), Vọng gác (checker), Cú vọ tự động (owl), CRM, 20 theme, core_animation.
- **Giao diện giữ CSS gốc**: chỉ có hiệu lực trong `.hs-acc` (`components/accountshs.css`), không lẫn với Tailwind của HireX. Theme chỉ áp trong vùng Tài khoản.
- **Quyền**: dùng quyền có sẵn "Tài khoản · Xem" (`accounts.view`) = xem + thêm/sửa/xoá/nhập, như bản Python (ai mở được là thao tác được).
  Tùy chỉnh, sao lưu/khôi phục, cấu hình Cú vọ, CRM = Quản trị viên workspace. Không thêm khoá quyền mới vào HireX.
- **Chỉ code trong `moduleHS/`**. Bên ngoài chỉ có 3 điểm nối bắt buộc: `src/app/(crm)/accounts/page.tsx`, `src/app/api/hs/accountshs/[...name]/route.ts`,
  `supabase/migrations/121_hs_accountshs.sql`. Không sửa `tsconfig.json`, `package.json`, `permission-catalog.ts` (import bằng đường dẫn tương đối).
- **Bảo mật**: bảng `ahs_*` bật RLS và không có policy, nên anon/authenticated không đọc được. Chỉ server đọc, sau khi đã kiểm quyền.
  Không còn `ahs_pg.json` hay mật khẩu Postgres trong code.

## Bố cục
```
moduleHS/accountshs/
  types.ts                kiểu dữ liệu (giữ đúng cột ahs_* và JSON của v7.py)
  core/      text.ts      fold/ngày/định dạng · model.ts  S/I, tìm cú pháp, lọc, sắp xếp, view (thuần, có test)
  server/    db.ts        Supabase đặc quyền + requireHs(view|edit|manage) + nhật ký kèm người làm
             handler.ts   một cửa cho /api/hs/accountshs/<name>, giữ tên + JSON y như do_GET/do_POST/ROUTES của Python
             accounts-data.ts · accounts-routes.ts   đọc / ghi (get_meta, get_data_fast, delta, bulk2, mass_set, upsert, delete…)
             backup.ts    .ahs.gz (đọc được bản sao lưu cũ) + xlsx (exceljs) trên Storage
             attachments.ts · docx-html.ts   đính kèm trên Storage, xem trước docx/xlsx/csv/text
             themes.ts    20 theme (themes/*.css)
             owl*.ts      Cú vọ: owl.ts (routes ai_*), owl-rules.ts + owl-hint.ts (luật hiểu câu, thuần), owl-query.ts (đánh giá truy vấn, thuần)
             checker*.ts  Vọng gác · owl-auto.ts  thu thập · crm.ts  đồng bộ CRM
  components/ accounts-app.tsx (khung) · store.ts · ui-kit.tsx · icons.tsx (480 icon) · table*.tsx · forms*.tsx · detail*.tsx
             reports.tsx · graph.tsx · devices.tsx · settings*.tsx · owl-chat.tsx · owl-auto.tsx · checker-panel.tsx · crm-panel.tsx
             attachments.tsx · scope.tsx · shortcuts.ts · animation.ts · accountshs.css
  themes/    *.css (20 theme + _shared/_side/_dark/…)
  worker/    checkfb*.py, checkgmail/proxy/telegram.py, owl_postfb.py, crm*.py, _pgshim.py, requirements.txt
src/app/(crm)/accounts/page.tsx            trang (đã gỡ iframe)
src/app/api/hs/accountshs/[...name]/route.ts   (gồm cả /internal/tick cho việc định kỳ)
moduleHS/accountshs/worker/hs-accountshs-worker.py · ensure-worker.ps1 · install-worker-task.ps1
moduleHS/accountshs/themes/preview/*.jpg      ảnh xem trước theme (phục vụ qua /api/hs/accountshs/theme-preview/<id>.jpg)
moduleHS/accountshs/tests/*.test.mjs          node --test moduleHS/accountshs/tests/*.test.mjs
```
Mã Python gốc để đối chiếu nằm ở `_src_python/` trên máy chủ (đã có trong `.gitignore`, không push).

## Tự làm tay (Python) → nền tảng có sẵn
| Python | HireX |
| --- | --- |
| `http.server`, ROUTES, gzip, LOCK | Route Handler Next (`handler.ts`); mỗi route khai báo mức quyền |
| `ahs_pg.py` (dịch SQL sqlite→pg, pipeline, COPY, guard) | supabase-js + hàm SQL (`ahs_accounts_json`, `ahs_links_json`, `ahs_key_lookup`, `ahs_check_db`, `ahs_repair`, `ahs_restore_*`…) |
| Không đăng nhập (chỉ 127.0.0.1) | Đăng nhập HireX + `accounts.*` + RLS |
| `write_xlsx` dựng OOXML bằng tay / `xlsx_sheets` | `exceljs` |
| `docx_html` | `docx-html.ts` (jszip + saxes, đã có sẵn trong node_modules) |
| Thư mục `attachments/`, `backup/` | Supabase Storage `hs-accountshs/{att,backup,ai}` |
| `bk_loop`, `_sched` (luồng nền) | `POST /api/hs/accountshs/internal/tick` (Bearer AUTOMATION_CRON_SECRET; worker gọi 5 phút/lần) |
| `AI_index.db` FTS5 571 MB, `AI_cache.db` | Postgres + bộ nhớ (nạp lại khi `ahs_ver` đổi) |
| Gọi LLM tự viết, nhiều nhà cung cấp | `src/lib/openai/responses.ts`, key ở `OPENAI_API_KEY` (không lưu DB) |
| Theme ghép CSS + `ui_tokenize` lúc chạy | CSS đã tokenize + scope sẵn; theme nạp `/api/hs/accountshs/theme/<id>.css` |

## Cài đặt / vận hành
1. **Migration**: chạy `121_hs_accountshs.sql` (qua `release.ps1`, hoặc `npx supabase db push`).
2. **Worker** (Vọng gác Facebook, Cú vọ tự động, CRM; kèm việc định kỳ):
   - `pip install -r moduleHS/accountshs/worker/requirements.txt`, nên có `curl_cffi`.
   - `.env.local` cần `SUPABASE_DB_URL` và `AUTOMATION_CRON_SECRET`.
   - Chạy một lần với quyền Administrator: `powershell -ExecutionPolicy Bypass -File moduleHS\accountshs\worker\install-worker-task.ps1`.
   - Log ghi ở `runtime/hs-accountshs-worker*.log`.
3. **Giờ VN**: đặt `TZ=Asia/Ho_Chi_Minh` cho tiến trình web, để Cú vọ hiểu "hôm nay / tháng này" theo giờ Việt Nam.
4. **Tắt bản Python**: sau khi chạy ổn trên HireX, tắt `v7.py` / `server-ahs`. Đổi mật khẩu Postgres, vì mật khẩu cũ từng nằm trong `ahs_pg.json`.

## Khác bản gốc (có chủ ý)
- **Dữ liệu**: vẫn nạp toàn bộ về trình duyệt và lọc tại chỗ như v7, nạp theo delta và hỗ trợ tab "tải riêng". Cú vọ nạp dữ liệu vào RAM server.
  Ở cỡ vài triệu dòng nên chuyển sang lọc phía Postgres.
- **Cú vọ**: chỉ dùng OpenAI. Bỏ chọn nhà cung cấp, model local và ô nhập key. Mặc định bật.
- **Cú vọ, đã sửa các bẫy bỏ dấu của bản gốc**:
  - lương / lượng
  - mới / mỗi
  - chi / chỉ
  - nháp / nhập
  - "không phải live" thành điều kiện loại trừ
  - giữ owner trong lệnh xoá
  - Đã đối chiếu 70 câu với Python, có test.
- **Hành vi giữ như v7**: bấm nút trên sơ đồ là nhảy tới dòng; độ sâu sơ đồ 1/2/3/Tất cả; nhấp đúp cột Cập nhật mở lịch sử; "Sửa hàng loạt" là bảng đối chiếu cũ → mới (`rows_set`).
- **Theo quyền HireX**: ẩn Tùy chỉnh và CRM với người không phải Quản trị viên.

## Chưa port / lược bớt
- **Giao diện**: tooltip `.tt` (đang dùng `title`), hiệu ứng nháy dòng khi Quay lại, hiệu ứng "con nhện" lúc Cú vọ nghĩ (đang dùng ba chấm).
- **Cú vọ tự động**: tạm dừng chỉ best-effort; khi đồng bộ, ghép cột theo map mặc định của kịch bản.
- **CRM**: địa chỉ chat-stats và token nhập trong CRM › Cài đặt (hoặc biến `HS_CRM_URL`), không ghi cứng trong code. Chạy `crm.py` qua `_pgshim.py` (dịch SQL), chưa chạy thử trên DB thật. Nên bấm Sao lưu rồi thử với dữ liệu nhỏ trước.
- **Tự động hoá chuột phải**: `automation.py` không port, vì v7.py không dùng (chỉ bản nháp `new_project_notnow` dùng).
