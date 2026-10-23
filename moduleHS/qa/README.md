# qa — Kiểm thử phần mềm (Tiện ích › Kiểm thử)

Nhập link + yêu cầu (tiếng Việt, kèm ảnh nếu có) → agent tự mở trình duyệt trên máy chủ, tự tạo dữ liệu test, bấm / điền / chọn / cuộn,
ghi nhật ký từng bước, đo tốc độ + lỗi console / mạng → AI viết báo cáo (chức năng, cơ chế, trường hợp test, lỗi & UX, tốc độ, đề xuất kỹ thuật). Tải Word.

## File
```
moduleHS/qa/
  qa-ui.js       giao diện (vẽ vào .hs-rec.hs-qa trong utilities.tsx; dùng chung nút / ô nhập của Cuộc họp)
  qa.css         bố cục riêng
  api.ts         /api/hs/qa?action=list|state|frame|img|docx (GET) · start|cmd|delete (POST), cần đăng nhập HireX
  qa-worker.mjs  tiến trình agent, 1 lượt test = 1 tiến trình (Playwright + OpenAI Responses), chạy độc lập với web
  report.ts      báo cáo → .docx (kiểu chữ của biên bản Cuộc họp)
```
Nối bên ngoài: `src/app/api/hs/qa/[[...p]]/route.ts`, tab Kiểm thử trong `moduleHS/record/utilities.tsx`.

## Cách chạy
- Mỗi lượt test: `runtime/hs-qa/runs/<id>/` gồm run.json, state.json (nhật ký), frame.jpg (hình trực tiếp ~1 giây / lần), step-NNN.jpg, cmd.jsonl (lệnh người dùng), report.json. Giữ 60 lượt gần nhất.
- Mỗi lượt AI nhận: yêu cầu, nhật ký, ảnh màn hình, danh sách phần tử tương tác [số] → gọi đúng 1 công cụ (click / fill / select / press / hover / scroll / goto / back / wait / note / ask_user / finish).
  Sau thao tác ghi: chữ mới hiện ra, ô nhập trình duyệt báo chưa hợp lệ, đổi trang, lỗi mới, thời gian.
- Đăng nhập: (1) nhập Tài khoản / Mật khẩu ở nút chìa khoá — AI chỉ thấy `{{user}}` / `{{pass}}`, không ghi ra đĩa; hoặc (2) agent dừng (ask_user) → người dùng tự bấm / gõ ngay trên màn hình trực tiếp rồi bấm Tiếp tục. Phiên đăng nhập lưu theo tên miền ở `runtime/hs-qa/auth/` cho lần sau.
- Tối đa 3 lượt chạy cùng lúc, mỗi lượt ≤ 20 phút, số bước: Nhanh 20 · Chuẩn 40 · Kỹ 70.
- Không bấm thao tác phá huỷ / thanh toán / gửi tin cho khách trừ khi yêu cầu nói rõ.

## Cấu hình (không bắt buộc)
`HS_QA_MODEL` (mặc định gpt-5.6-luna, chọn thao tác) · `HS_QA_REPORT_MODEL` (gpt-5.6-sol, viết báo cáo) · `HS_QA_DIR` · `HS_QA_CHROME` (đường dẫn trình duyệt).
Trình duyệt: Chromium của Playwright; không có thì tự dùng Microsoft Edge / Chrome cài trên máy.

## Bản 2 (23/10/2026)
- Xem trực tiếp: worker dùng CDP screencast (~12 hình/giây khi màn hình đổi) → `frame.jpg`; web phát qua `action=stream` (MJPEG, `<img>`), 6 giây không có hình thì tự đổi sang hỏi từng ảnh. Con trỏ ảo (`state.cursor`) chỉ chỗ agent sắp bấm.
- Trò chuyện: `action=say` (nhắn bất cứ lúc nào). Xong việc worker viết báo cáo rồi chờ 10 phút (`idle`) nhận tin tiếp; trình duyệt đã đóng thì `say` chạy lại worker với `--resume` (giữ nhật ký, trò chuyện, phát hiện). Mỗi tin giữa chừng +10 bước.
- Trạng thái: `state.phase` = open / load / look / think / act / wait / pause / report / idle (+ nhãn) → giao diện hiện đang làm gì.
- Chi phí: Luna cho từng bước (lịch sử chỉ nối thêm → OpenAI cache phần đầu), Terra cho bước bị kẹt và báo cáo; `state.usage` ghi token + ước tính USD. Ví dụ test form đăng nhập 10 bước + báo cáo ≈ $0.05.
- Key: `HS_OPENAI_API_KEY` (key riêng moduleHS, chung với Ghi âm) — không có thì dùng `OPENAI_API_KEY`. Đổi model: `HS_QA_MODEL`, `HS_QA_SMART_MODEL`, `HS_QA_REPORT_MODEL`.
