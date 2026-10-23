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

## Phụ đề trực tiếp + từ điển ngữ cảnh (23/10)
- **Phụ đề — một chế độ duy nhất, miễn phí:** combobox **Phụ đề** ở màn chính: *Lời gốc (tiếng Việt)* (mặc định) · *Lời gốc + dịch English* · *Lời gốc + dịch 日本語* · *Tắt* (dừng nghe + ẩn hẳn khung).
  Trình duyệt nghe tiếng Việt (Chrome / Edge — Web Speech API) → câu chốt → `live_tr` sửa tên / thuật ngữ theo từ điển → nếu chọn dịch thì Google Dịch (miễn phí, giữ nguyên thuật ngữ) hiện thêm dòng dưới lời gốc.
  Đổi ngôn ngữ giữa chừng thì dịch bù các câu đã có. Không gọi OpenAI lúc đang họp. (Bản dịch đầy đủ sau họp — trả phí — chọn ở "Tạo lại".)
- **Từ điển ngữ cảnh (`lexicon.ts`)** — học từ toàn bộ dữ liệu HireX, **chỉ khi ra lệnh huấn luyện** (không tự chạy theo giờ), lưu `runtime/hs-record/lexicon/<workspace>.json`:
  thành viên (HireX / Tài nguyên / Human, bỏ đuôi "- AM", "J3"…), ~800 khách hàng Human, bộ mã Human (vị trí, hạng, tình trạng CV…), job, nhãn Suối Nguồn, nick kênh, nhóm Zalo khách,
  chiến dịch, mẫu content, lịch hẹn, Tài nguyên (tab / trạng thái / trường), kỹ năng & vị trí CV, địa điểm VN + Nhật;
  khai thác thuật ngữ từ văn bản (toàn bộ Tài liệu Human + Tài liệu HireX, hội thoại Soda, bản gốc + biên bản các cuộc họp trước, mô tả job, nội dung mẫu) theo tần suất × số nguồn.
- **Cách nghe nhầm:** viết tay cho thuật ngữ cốt lõi ("bờ rích" → BrSE, "hai rếch" → HireX, "so đa" → Soda…), tự sinh khi đọc chữ cái / số ("am một" → AM1, "new một" → New 1),
  và AI học một lần cho thuật ngữ mới khi huấn luyện (`gpt-5.6-luna`, ~30 token / thuật ngữ, lưu vĩnh viễn `runtime/hs-record/lexicon/aliases.json`).
- **Thuật toán sửa câu (`fixText`):** quy hoạch động trên đồ thị các cách tách câu (đường đi điểm cao nhất): mỗi đoạn 1–6 tiếng giữ nguyên hoặc thay bằng mục khớp
  — khớp cả dấu > khớp không dấu (đủ dài) > khớp âm Việt (gi/d/r, tr/ch, s/x, c/t cuối, n/ng cuối) > gần đúng Levenshtein. Hàng rào: từ thường một mình không bao giờ bị thay,
  so khớp có dấu để "đẹp" không thành "Dev", "dài" không thành "Die"; tên một chữ ("Hải") chỉ viết hoa khi có anh / chị / em đứng trước.
- **Trình duyệt nghe đúng hơn:** gửi ~400 cụm từ HireX qua `SpeechRecognition.phrases` (contextual biasing) nếu trình duyệt hỗ trợ; không hỗ trợ thì bỏ qua.
- **Sau cuộc họp (OpenAI, trả phí — giữ nguyên):** thuật ngữ phụ đề đã nghe thấy được đưa lên đầu prompt phiên âm `gpt-transcribe`; bản gốc sửa lại bằng `fixText`;
  biên bản (`gpt-5.6-sol`, suy luận cao) nhận thêm bảng "thuật ngữ / tên riêng đã nhận ra trong cuộc họp này" (tên chuẩn · loại · cách hay nghe nhầm) bên cạnh bối cảnh HireX.

## Huấn luyện từ điển (chạy tay)
**Lệnh cho Claude:** khi người dùng chat **"Huấn luyện ghi âm full db"** (hoặc ý tương tự), chạy ở thư mục gốc HireX trên máy:
```
node moduleHS/record/lexicon-train.mjs --seconds 130     # lặp lại tới khi in "còn 0 từ chưa học" (mỗi lần chạy ≤ 3 phút)
node moduleHS/record/lexicon-train.mjs --no-ai           # chỉ đọc lại dữ liệu, không gọi AI (miễn phí)
```
Rồi báo lại: số mục, mục mới, số từ AI vừa học, token đã dùng, ví dụ câu đã sửa. Web tự nạp file mới, không cần khởi động lại.
Chưa từng huấn luyện thì lần đầu web tự dựng từ dữ liệu (không AI). Lần huấn luyện đầu 23/10/2026: 2.632 mục, AI học 2.222 từ, ~60.000 token.
