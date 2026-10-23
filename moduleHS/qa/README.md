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

## Giao diện (bản chốt 23/10)
- Phong cách: viền mảnh trắng – đỏ (reUI / shadcn) + vài điểm sáng kiểu Magic UI (nền lưới chấm + quầng đỏ ở Lượt mới, viền sáng chạy quanh màn hình khi agent làm, chữ "đang nghĩ" lấp lánh). Không chấm tròn / nhãn màu; chỉ lỗi và nút Dừng màu đỏ.
- Nút hành động gom thành nhóm liền khối `.q-bg` (1 khung viền, vạch ngăn thẳng): Word · Mở trang · Xoá; tiến độ · Tạm dừng · Dừng · Tự điều khiển; Ẩn/hiện trò chuyện · Phóng to.
- Trực tiếp: màn hình luôn vừa khung (cả ngang lẫn cao); kéo vạch giữa màn hình và trò chuyện để đổi cỡ (280–640px, bấm đúp về mặc định, nhớ trong trình duyệt); ẩn trò chuyện; Phóng to = phủ cả cửa sổ + toàn màn hình nếu trình duyệt cho, Esc để thoát.
- Hình trực tiếp: hỏi `action=frame&t=<lần trước>` ~5 lần/giây khi agent làm (204 nếu chưa có ảnh mới), 1 lần/giây khi chờ.
- Trò chuyện 3 lớp: lời agent = thẻ nền hồng đỏ nhạt (dài > 3 dòng thì gọn) · hành động = dòng nhỏ trên đường ray xám · tiến trình = dải riêng trên ô nhắn.
- Báo cáo: khối tóm tắt (điểm + 4 số) rồi các bảng có đầu xám; dòng lỗi tô hồng, "cần xem" tô vàng nhạt. Nhật ký: 1 bảng log liền (Lúc · Hành động · Kết quả · Mất · Ảnh), nhóm theo trường hợp đánh số.
- CSS / JS tải qua `action=asset&v=<mtime>` (né cache 4 giờ của Cloudflare) — sửa qa.css / qa-ui.js là có ngay, không cần build.
