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

## Dịch hội thoại trực tiếp (23/10, miễn phí)
- Combobox **Hội thoại** ở màn chính: *Việt ↔ Nhật (dịch 2 chiều)* (mặc định) · *Việt ↔ English (dịch 2 chiều)* · *Chỉ tiếng Việt* · *Tắt* (dừng nghe + ẩn khung). Mở trang luôn bật.
- Nghe: Web Speech API của Chrome / Edge (máy nhận giọng của Google, miễn phí). Mỗi lúc chỉ nghe được **một** thứ tiếng → bấm tên cột (VI | JP | EN)
  của người đang nói, hoặc phím **Space** lúc đang ghi. Cột đang nghe có micro đỏ.
- Hiển thị 2 cột như nhau (VI | JP hoặc VI | EN): lời gốc ở cột người nói, bản dịch ở cột kia; **dòng mới nhất ở trên cùng** (nền hồng = đang nói dở).
- Cắt đoạn kiểu Google Meet: mỗi câu trình duyệt chốt là 1 dòng; nói liền một mạch quá ~64 ký tự Việt / ~26 chữ Nhật thì cắt phần chữ đã ổn định
  ở dấu câu, hoặc trước từ nối (về, cho, và, trong…) / sau trợ từ Nhật, thành 1 dòng; câu chốt quá ngắn ("vâng ạ") nối vào dòng trước.
- Dịch: dòng đang nói dở → gọi thẳng Google Dịch từ trình duyệt (~0,2 giây, 1 yêu cầu bay một lúc, giữ nguyên thuật ngữ HireX trong từ điển);
  dòng chốt → `live_tr` sửa tên / thuật ngữ (chỉ tiếng Việt) → Google Dịch có giữ thuật ngữ → thay bản nháp. Không gọi OpenAI lúc đang họp.
- **Bên kia dùng điện thoại riêng (kiểu Google Meet)** — nút **Mời** trên khung hội thoại → mã QR / link `/api/hs/record/j/<mã>?l=ja` (không cần đăng nhập, mã ngẫu nhiên).
  Khách mở trên điện thoại (Chrome / Safari) → bấm タップして話す: điện thoại nghe tiếng Nhật bằng micro riêng, máy chủ trì nghe tiếng Việt → khỏi bấm đổi người nói, nói chen nhau vẫn ghi được.
  Cả hai màn hình hiện 2 cột VI | JP như nhau, dòng mới nhất ở trên; khách có nút 読み上げ (đọc to bản dịch tiếng Nhật).
  `room.ts`: phòng trong bộ nhớ (6 giờ), hỏi dài (long-poll) để nhận dòng mới ngay; dòng nói dở gửi ngay rồi ~4 lần/giây, dòng chốt qua máy chủ sửa từ điển + dịch.
  Hai micro cùng phòng nghe lẫn tiếng nhau → dòng chốt trùng thời gian, khác thứ tiếng, độ chắc thấp hơn hẳn (≥ 0,15) bị bỏ trên mọi máy.
  Bắt đầu ghi cuộc họp mới → phòng sang hội thoại mới (khách vẫn ở lại). Dòng của khách cũng ghi vào `live.jsonl` của cuộc họp.
- **Đọc to bản dịch** (nút loa trên khung, nhớ theo máy): đọc bản dịch bằng giọng có sẵn của trình duyệt / Windows (miễn phí) — kiểu Meet "speech translation" / tai nghe phiên dịch.
  Lúc máy đọc thì tạm ngừng nghe để micro không bắt lại tiếng loa; bấm đổi người nói là ngắt đọc. Nên đeo tai nghe. Thiếu giọng tiếng Việt thì thêm trong Cài đặt Windows › Giọng nói.
- `live.jsonl` của mỗi cuộc họp lưu `{t,k,fin,src,raw,text,tr,lang}` — `raw` (chữ trình duyệt nghe) dùng lại để học từ điển.

## Từ điển ngữ cảnh (`lexicon.ts`)
- Học từ toàn bộ dữ liệu HireX, **chỉ khi ra lệnh huấn luyện**, lưu `runtime/hs-record/lexicon/<workspace>.json`:
  thành viên (HireX / Tài nguyên / Human), ~800 khách hàng Human, bộ mã Human, job, nhãn Suối Nguồn, nick kênh, nhóm Zalo khách, chiến dịch, mẫu content, lịch hẹn,
  Tài nguyên (tab / trạng thái / trường), kỹ năng & vị trí CV, địa điểm; khai thác thuật ngữ từ Tài liệu Human + HireX, hội thoại Soda, bản gốc + biên bản cuộc họp trước.
- **Đã bỏ** cách học phiên âm do AI đoán ("bờ rích" → BrSE…) — không hiệu quả. File cũ `aliases.json` không còn được đọc.
- **Học từ âm thanh thật:** cùng một file họp được phiên âm 2 lần — bản thô (`gpt-4o-mini-transcribe`, không gợi ý — gần với tai trình duyệt) và bản chuẩn
  (`gpt-transcribe` + ngữ cảnh HireX). Căn hai bản bằng quy hoạch động (mốc từ hiếm + khoảng cách sửa theo từ), chỗ bản chuẩn là thuật ngữ trong từ điển mà bản thô nghe khác
  → ghi "cách nghe nhầm" (lọc: giống âm ≥ 0,55, cùng âm đầu, không phải số, không phải chữ Việt thường thay cho chữ nước ngoài). Lưu `lexicon/learned.json`.
  Phụ đề các cuộc họp thật (`live.jsonl` so với `transcript.txt`) cũng được học như vậy. Bản chuẩn còn cho biết từ nào thực sự hay được nói → được ưu tiên.
- **Sửa câu (`fixText`):** quy hoạch động trên các cách tách câu (đường đi điểm cao nhất), mỗi đoạn 1–6 tiếng giữ nguyên hoặc thay bằng mục khớp
  — khớp cả dấu > không dấu (đủ dài) > khớp âm Việt > gần đúng Levenshtein. Từ thường một mình không bị thay; tên một chữ chỉ sửa khi có anh / chị / em đứng trước.
- **Trình duyệt nghe đúng hơn:** gửi ~400 cụm từ HireX qua `SpeechRecognition.phrases` nếu trình duyệt hỗ trợ.
- **Sau cuộc họp (OpenAI, trả phí — giữ nguyên):** thuật ngữ đã nghe thấy đưa lên đầu prompt `gpt-transcribe`; bản gốc sửa bằng `fixText`;
  biên bản (`gpt-5.6-sol`, suy luận cao) nhận thêm bảng thuật ngữ / tên riêng của cuộc họp.

## Huấn luyện từ điển (chạy tay)
**Lệnh cho Claude:** khi người dùng chat **"Huấn luyện ghi âm full db"** (hoặc ý tương tự), chạy ở thư mục gốc HireX trên máy:
```
node moduleHS/record/lexicon-train.mjs                          # đọc lại DB + tài liệu + cặp âm thanh đã có (miễn phí, vài giây)
node moduleHS/record/lexicon-train.mjs --audio --seconds 150    # có file họp mới trong runtime/hs-record/lexicon/audio/ → phiên âm 2 lần rồi học
                                                                # (cắt đoạn 10 phút, chạy tiếp được; lặp tới khi in "còn 0 đoạn"; ~$0,45 / giờ âm thanh, key HS)
```
Rồi báo lại: số mục, mục mới, số chỗ nghe nhầm học được, ví dụ câu đã sửa. Web tự nạp file mới, không cần khởi động lại.
23/10/2026: 2.634 mục; học từ 4 file họp (~3 giờ, ~$1,4): 230 thuật ngữ thực sự được nói, cách nghe nhầm: "in talent" → Intalent, "set up" → setup.
