# record — Cuộc họp (Meeting Hub) trong HireX

Mục **Tiện ích** (`/utilities`) trên thanh bên của HireX có 2 tab:
- **Cuộc họp**: chạy Meeting Hub (trước là project riêng `meeting-hub`, Node `server.js` cổng 3101).
- **Kiểm thử phần mềm**: đang trống.

Meeting Hub làm được: ghi âm hoặc tải file lên → phiên âm (kèm dịch trực tiếp Việt · English · 日本語) → biên bản Word, hoặc điền thẳng vào mẫu Word/Excel → lưu trên máy chủ → thông báo Zalo. Có thêm tab Đọc văn bản (chuyển văn bản thành audio).

## File
```
moduleHS/record/
  utilities.tsx   trang Tiện ích (2 tab) + trang xem công khai; nạp giao diện Cuộc họp
  meeting-ui.js   giao diện gốc (ghi âm, phụ đề trực tiếp, đọc văn bản, lưu trữ, cài đặt, trình xem), vẽ vào khung .hs-rec
  meeting.css     CSS gốc, chỉ có hiệu lực trong .hs-rec
  api.ts          một cửa /api/hs/record?action=… (cần đăng nhập) + link công khai f/ d/
  pipeline.ts     FFmpeg + OpenAI: phiên âm, biên bản, dịch, giọng đọc, phụ đề trực tiếp
  office.ts       tạo .docx/.xlsx, đọc và điền thẳng vào file mẫu
  data.ts         lưu trữ (thư mục), cấu hình, hằng số
  zalo.ts         gửi thông báo bằng nick Zalo của HireX
```
Bên ngoài `moduleHS/` có 5 chỗ nối:
- `src/app/(crm)/utilities/page.tsx`
- `src/app/api/hs/record/[[...p]]/route.ts`
- `src/app/m/[...p]/page.tsx`
- thêm 1 dòng "Tiện ích" trong `src/components/layout/sidebar.tsx`
- thêm `/utilities` vào `fullBleed` trong `src/components/layout/app-shell.tsx`

## Từ bản gốc sang HireX
| meeting-hub | HireX |
| --- | --- |
| `http.createServer`, `?action=`, cổng 3101 | Route handler `/api/hs/record` (giữ nguyên tên action và JSON) |
| `ADMIN_PASSWORD` (Basic auth) + CSRF | Đăng nhập HireX (mọi thành viên), chặn POST khác origin; Cài đặt Zalo chỉ Quản trị viên |
| `.env` riêng, `OPENAI_API_KEY` riêng | Key `OPENAI_API_KEY` của HireX; Responses API qua `src/lib/openai/responses.ts` |
| Zalo đăng nhập QR riêng (zca-js) | Nick Zalo đã kết nối trong HireX, gửi qua hàng gửi chuẩn (`channel_outbound_actions`) vào nhóm chọn trong Cài đặt › Zalo |
| `data/` cạnh `server.js` | `runtime/hs-record/` (đã gitignore; đổi được bằng `HS_RECORD_DIR`) |
| Link `/f/<slug>`, `/d/<slug>/<loại>` | Trang xem `/m/<slug>[/<loại>]`, tải file `/api/hs/record/d/<slug>/<loại>?dl=1` (công khai) |
| Tải file lên 1 lần (≤ 512 MB) | Tải từng phần 16 MB (HireX giới hạn mỗi request ~26 MB) |
| `ui/public.html`, `viewer.*`, `tokens.css`, `lib/zalo.js` | Bỏ: không được dùng (giao diện chỉ dùng `index.html`; Zalo đã nằm trong `server.js`) |

`office.ts` vẫn tự thao tác OOXML. Lý do: điền mẫu phải giữ nguyên từng đoạn và ô của file gốc, mà exceljs sẽ dựng lại file.

## Vận hành
- **FFmpeg** phải có trên máy chủ HireX: trong `PATH`, hoặc khai báo `FFMPEG_PATH` trong `.env.local`. Kiểm tra bằng cách mở `/api/hs/record?action=health` khi đã đăng nhập.
- **Model**: mặc định giống bản gốc. Đổi bằng `HS_RECORD_TEXT_MODEL`, `HS_RECORD_TRANSCRIBE_MODEL`, `HS_RECORD_TTS_MODEL`, `HS_RECORD_LIVE_TEXT_MODEL`.
- **Tham số giữ tên cũ**: `LIVE_*`, `TRANSCRIBE_SEGMENT_SECONDS`, `AUDIO_BITRATE`, `RECORD_SLICE_MS`, `TTS_MAX_CHARS`, `MAX_UPLOAD_MB`, `CODE_MIN/MAX`, `PENDING_RETENTION_HOURS`.
- **Link gửi Zalo** dùng `APP_BASE_URL` (hoặc `HS_RECORD_PUBLIC_URL`).
- **Micro** chỉ chạy trên HTTPS hoặc localhost. Trang `app.hirexmkt.online` đã dùng HTTPS.
- **Chuyển dữ liệu cũ**: chép thư mục `data/` của meeting-hub vào `runtime/hs-record/`, gồm `m/`, `cfg/`, `templates/`.
