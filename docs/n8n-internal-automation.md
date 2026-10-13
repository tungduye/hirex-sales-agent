# Tự động hoá n8n cho nhân sự HireX

Mục **Tự động hoá** nằm ngay trên **Cài đặt** trong thanh điều hướng CRM. Hiện tại đây là màn hình giám sát **chỉ đọc**: tối đa 50 workflow và 20 lần chạy gần đây. Không có nút chạy, kích hoạt workflow, gọi webhook hoặc gửi tin.

## Cấu hình máy chủ

Đặt hai biến sau trong môi trường chạy HireX, không đặt trong biến `NEXT_PUBLIC_` hoặc nhập qua trình duyệt:

```text
HIREX_N8N_INSTANCE_1_API_KEY=<api-key của n8n HireX 1>
HIREX_N8N_INSTANCE_2_API_KEY=<api-key của n8n HireX 2>
```

Hai origin n8n được cố định trong mã nguồn và mỗi instance dùng một API key riêng phía máy chủ. Định danh instance được kiểm tra trước khi chọn khóa, vì vậy khóa của instance này không được gửi tới instance kia. API key không được đưa ra trình duyệt. Sau khi cấu hình, khởi động lại ứng dụng HireX theo quy trình triển khai hiện hành.

## Quyền và kiểm tra

- Chỉ vai trò hệ thống **Quản trị viên** có `roles.manage` và `settings.view` mới thấy mục và mở trang. Vai trò **Nhân viên** không thấy menu; truy cập URL trực tiếp cũng bị chuyển về trang chủ. Máy chủ kiểm tra lại vai trò trước khi gọi n8n.
- Chỉ dùng API key n8n có quyền đọc workflow và execution cần giám sát; không cấp thêm quyền vận hành nếu chưa có quy trình phê duyệt. Instance thứ hai hiện không cho sửa scopes khi tạo key, nên **chưa tạo key** và chưa kết nối API.
- Truy cập `/settings/automation`: trạng thái phải là **Đã kết nối** và chỉ hiện tên workflow, trạng thái chạy, thời điểm. Không hiển thị API key, payload hay dữ liệu đăng nhập.
- Nếu n8n chưa cấu hình, trả lời sai định dạng, lỗi mạng hoặc chuyển hướng, trang hiển thị trạng thái lỗi an toàn; không tự chạy workflow.
- Tài khoản không có quyền không được thấy mục điều hướng và không được mở trang bằng URL trực tiếp.

Triển khai màn hình này không thay đổi quyền gửi Zalo, Facebook hoặc Email. Bất kỳ thao tác chạy workflow từ HireX nào cũng cần thiết kế riêng: quyền thao tác, danh sách workflow cho phép, xác nhận của người dùng, ghi audit và chính sách chống gửi lặp.
