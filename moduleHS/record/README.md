# record — Cuộc họp (Meeting Hub) trong HireX

Mục **Tiện ích** (`/utilities`) trên thanh bên của HireX có 2 tab:
- **Cuộc họp**: chạy Meeting Hub (trước là project riêng `meeting-hub`, Node `server.js` cổng 3101).
- **Kiểm thử phần mềm**: đang trống.

Meeting Hub làm được: ghi âm hoặc tải file lên → phiên âm (kèm dịch trực tiếp Việt · English · 日本語) → biên bản Word (bố cục cố định, ngữ cảnh lấy tự động từ HireX) → lưu trên máy chủ + Tài liệu → thông báo Zalo. Có thêm tab Đọc văn bản (chuyển văn bản thành audio).

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
  context.ts      ngữ cảnh cuộc họp lấy tự động từ dữ liệu HireX (thành viên, màn hình, thuật ngữ)
  minutes.ts      biên bản: làm sạch JSON của AI, dựng Word / HTML theo mẫu
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
| Zalo đăng nhập QR riêng (zca-js) | Nick Zalo đã kết nối trong HireX, gửi bằng **Gửi hàng loạt Zalo** của HireX (chế độ gửi ngay 1 nhóm, người duyệt = Quản trị viên đã cài đặt) vào nhóm chọn trong Cài đặt › Zalo; worker Zalo gửi trong ~20 giây, mỗi lần gửi hiện trong Gửi hàng loạt |
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

## Ngữ cảnh cuộc họp (tự động, không cần cài đặt)
Không còn Chủ đề / Mẫu báo cáo / Từ vựng / Công ty nhập tay. `context.ts` tự lấy từ dữ liệu HireX (cùng nguồn Soda đọc), làm mới 10 phút / lần:
- Thành viên: tài khoản HireX (tên, bộ phận, quản trị viên), chủ sở hữu ở Tài nguyên, người dùng Human; CEO = anh Dũng.
- Hệ thống: tên màn / chức năng HireX và nghiệp vụ (Suối Nguồn, Soda, Hola/Hole, Tài nguyên, Vọng gác, Cú vọ, KIT, Hạng 1–7, X1/X2, AM1/AM2…), nhãn Suối Nguồn, khách hàng nhiều CV, job đang tuyển, 5 cuộc họp gần nhất.
Dùng cho: prompt phiên âm (tên người + thuật ngữ), từ khoá phụ đề trực tiếp, bối cảnh viết biên bản. Sửa phần cố định ở `HIREX_MAP` / `TERMS` trong `context.ts`.

## Biên bản
- AI (`HS_RECORD_MINUTES_MODEL`, mặc định `gpt-5.6-sol`; lỗi model thì dùng `HS_RECORD_TEXT_MODEL`) viết theo kiểu CEO tự ghi chú: từng màn / việc, ý ngắn cụ thể (đổi gì → thành gì, ai làm, số liệu), không lời dẫn chung chung. Trả JSON có cấu trúc → `minutes.ts` dựng Word + HTML cùng một bố cục.
- Bố cục theo mẫu người dùng chọn: Arial 10, tiêu đề đỏ có gạch chân, mục I–V (Tóm tắt điều hành · Nội dung thảo luận · Kết luận và quyết định · Công việc cần thực hiện (bảng) · Vấn đề chưa chốt), chân trang "Trang x / y".
- Xong thì lưu vào **Tài liệu › Tài liệu HireX › Biên bản cuộc họp** (bảng `hirex_documents`) để Soda đọc được ("gần nhất R&D họp gì"); tạo lại thì cập nhật đúng tài liệu đó.
- Tạo lại: dùng lại bản phiên âm đã có, chỉ viết lại biên bản. Bản ghi cũ (Excel / điền mẫu) vẫn xem và tải được như trước.

## Phụ đề trực tiếp
- Một bộ nhận dạng (OpenAI realtime `gpt-live-transcribe`), tự nhận tiếng Việt / English / 日本語 khi người nói đổi qua lại; không còn chọn ngôn ngữ nói hay Google / OpenAI. Nút Gốc · VI · EN · JA chỉ đổi ngôn ngữ hiển thị (dịch).
- Mỗi câu 2 bước: chữ nháp hiện ngay khi đang nói → nói xong câu, trình duyệt gửi lại âm thanh của đúng câu đó (WAV, `live_fix`) cho model phiên âm chính kèm ngữ cảnh HireX → thay bằng chữ chuẩn (thường 1–2 giây), rồi mới dịch.
- Realtime không nối được → tự cắt đoạn 3 giây gửi lên máy chủ (cũng có ngữ cảnh).
- Biên bản vẫn phiên âm lại từ file ghi âm đầy đủ sau cuộc họp (3 phần chạy song song).
