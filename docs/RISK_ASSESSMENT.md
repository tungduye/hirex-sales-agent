# Đánh giá rủi ro vận hành — HireX Sales Agent

*Cập nhật: 13/10/2026. Dựa trên mã nguồn tới migration 069 và các nguồn công khai liệt kê cuối tài liệu. Đây là đánh giá kỹ thuật, không phải tư vấn pháp lý.*

## Tóm tắt

| # | Rủi ro | Khả năng | Tác động | Ưu tiên |
| --- | --- | --- | --- | --- |
| 1 | Tài khoản Facebook cá nhân / Zalo cá nhân bị khóa vì dùng công cụ tự động không chính thức | Cao | Cao: mất kênh, mất lịch sử, gián đoạn chiến dịch và AI Recruiter | **Cao** |
| 2 | Máy Windows duy nhất hỏng, mất điện, bị đăng xuất | Trung bình | Cao: toàn bộ web, worker, scheduler, bridge dừng; khóa mã hóa và `runtime/` có thể mất | **Cao** |
| 3 | Tuân thủ dữ liệu cá nhân và tin nhắn quảng cáo (ứng viên, khách hàng) | Trung bình | Cao: phạt hành chính, uy tín | **Trung bình – Cao** |
| 4 | AI Recruiter AUTO trả lời sai hoặc gửi quá nhiều | Thấp – Trung bình | Trung bình | Trung bình (đã giảm nhờ 069) |

## 1. Kênh cá nhân không chính thức

### Hiện trạng trong mã nguồn

- **Facebook cá nhân**: `scripts/facebook-profile-bridge.mjs` dùng Playwright mở `facebook.com/messages` bằng phiên đăng nhập lưu trong `runtime/facebook-profile-bridge-*`, đọc và gửi tin như người dùng.
- **Zalo**: tài khoản Zalo đăng nhập trong Deplao, HireX nói chuyện với Deplao qua `scripts/deplao-realtime-supervisor.mjs` và cầu nối ký HMAC. Không dùng Zalo Official Account API.
- Cả hai kênh được dùng cho **chiến dịch hàng loạt** (`057`, `059`, `063`–`066`) và cho **AI Recruiter AUTO**.

### Vì sao rủi ro cao

- Meta quy định dữ liệu chỉ được truy cập bằng chương trình qua Platform API (`graph.facebook.com`); truy cập hoặc thu thập dữ liệu bằng phương tiện tự động khi chưa được phép là vi phạm Điều khoản, kể cả khi không cố ý. Bridge Facebook cá nhân thuộc đúng trường hợp này.
- Điều khoản của Zalo (theo tổng hợp của CafeF, 09/2026) cấm đăng nhập, sử dụng dịch vụ qua phần mềm bên thứ ba không do Zalo phát triển hoặc chấp thuận. Các tích hợp Zalo cá nhân khác (ví dụ OpenClaw) cũng tự cảnh báo có thể khiến tài khoản bị đình chỉ hoặc cấm.
- Gửi tin chủ động số lượng lớn từ tài khoản cá nhân là hành vi các nền tảng chủ động phát hiện. Mã nguồn đã giãn nhịp gửi (pacing), giới hạn một thao tác mỗi tài khoản (send slot), hoãn khi bận (busy-defer) và theo dõi sức khỏe tài khoản. Các biện pháp này giảm tần suất nhưng **không làm việc sử dụng trở nên hợp lệ**.

### Hệ quả khi bị khóa

Mất tài khoản và danh bạ của người phụ trách. Hội thoại đã đồng bộ vẫn còn trong HireX, nhưng không gửi tiếp được. Chiến dịch dở dang bị kẹt. AI Recruiter trên kênh đó ngừng hoạt động.

### Khuyến nghị

**Ngay (tuần này)**
1. Chỉ dùng tài khoản phụ dành riêng cho HireX, không dùng tài khoản cá nhân chính của nhân viên.
2. Đặt trần gửi chủ động mỗi tài khoản mỗi ngày (ví dụ tối đa vài chục tin cho người chưa từng nhắn), và **không** dùng kênh cá nhân cho chiến dịch "lạnh" tới người chưa có hội thoại.
3. Theo dõi theo tuần: số tài khoản bị yêu cầu đăng nhập lại, bị hạn chế, tỷ lệ tin `DELIVERY_UNKNOWN`/`FAILED`. Có dấu hiệu bất thường thì dừng chiến dịch trên tài khoản đó.

**Trung hạn (1–3 tháng): chuyển dần sang kênh chính thức**

| Kênh chính thức | Điều kiện chính | Phù hợp cho |
| --- | --- | --- |
| Facebook Page + Messenger Platform (HireX đã có adapter) | Chỉ trả lời trong 24 giờ kể từ tin gần nhất của người dùng; ngoài cửa sổ cần message tag. Tag `HUMAN_AGENT` cho phép tới 7 ngày nhưng phải qua App Review | Hỏi đáp ứng viên, AI Recruiter trả lời |
| Zalo Official Account (tin tư vấn) | Người dùng phải quan tâm/tương tác với OA; giới hạn broadcast theo tháng (theo eSMS: OA đã xác thực tối đa 4 tin/tháng cho mỗi khách) | Trả lời ứng viên đã nhắn OA |
| Zalo ZNS | Mẫu tin phải được Zalo duyệt, có đồng ý hoặc thông báo trước, gắn với giao dịch | Xác nhận lịch phỏng vấn, nhắc hồ sơ |

Gợi ý lộ trình: đưa AI Recruiter sang Facebook Page và Zalo OA trước, vì đây là luồng "trả lời người đã nhắn" khớp với cửa sổ chính thức. Chỉ giữ kênh cá nhân cho tác vụ thủ công của nhân viên.

**Lưu ý khi đổi sang kênh chính thức:** `execute-channel-outbound-action.ts` đã kiểm tra cửa sổ phản hồi Facebook (23 giờ, bảo thủ hơn 24 giờ). Zalo OA cần adapter mới nhưng dùng lại được hợp đồng `ChannelAdapter`.

## 2. Kiến trúc một máy Windows

### Hiện trạng

- Web, 2 worker, 4–5 tác vụ lịch và 2 bridge cùng chạy trên `C:\Users\Admin\hirex-sales-agent`.
- Tác vụ lịch Gmail chạy "chỉ khi người dùng đăng nhập" (`docs/WINDOWS_SCHEDULER.md`). Máy bị đăng xuất hoặc khởi động lại thì đồng bộ Gmail và chiến dịch dừng.
- `runtime/` chứa trạng thái không có ở nơi nào khác: phiên đăng nhập Facebook cá nhân, snapshot tài liệu Human đã mã hóa, trạng thái Deplao. Khóa giải mã nằm trong `.env.local` trên **cùng máy**.
- Log không xoay vòng: `runtime/gmail-scheduler.log` khoảng 8,7 MB, `channel-campaign-scheduler.log` khoảng 1,7 MB và còn tăng. Có khoảng 150 file `deplao-supervisor-state.json.*.tmp` bị bỏ lại.
- Giới hạn tần suất của hỏi đáp tài liệu nằm trong bộ nhớ tiến trình, nên chỉ đúng khi có một máy.

### Khuyến nghị

**Ngay**
1. Sao lưu `.env.local` (các khóa mã hóa) ra một nơi an toàn **khác máy**, ví dụ password manager của công ty. Sao lưu `runtime/` định kỳ ra nơi khác. Không bao giờ để chung khóa và dữ liệu trong cùng một bản sao lưu không mã hóa.
2. Bật giám sát uptime từ bên ngoài cho `https://app.hirexmkt.online/login`, để có cảnh báo khi web chết.
3. Đổi các tác vụ lịch sang "Run whether user is logged on or not" và đặt máy tự khởi động lại sau khi mất điện (BIOS + UPS).
4. Thêm xoay vòng log (giữ 7–14 ngày) và dọn file `.tmp` cũ. Đồng thời sửa supervisor Deplao để luôn xóa file tạm sau khi ghi.

**Trung hạn**
5. Chuyển web và worker lên một máy chủ luôn bật (VPS hoặc máy chủ trong văn phòng có UPS). Đóng gói bằng Docker theo hướng `ARCHITECTURE.md` §2.
6. Chuyển trạng thái `runtime/` cần thiết sang Supabase Storage (đã mã hóa) hoặc ổ dùng chung, để có thể dựng lại trên máy khác.
7. Chuyển giới hạn tần suất sang Postgres trước khi chạy hơn một máy.

**Dài hạn**: tách worker, dùng hàng đợi (Redis/BullMQ hoặc tiếp tục dùng bảng Postgres có lease), có môi trường staging riêng để thử migration trước khi lên production.

## 3. Dữ liệu cá nhân và tin nhắn quảng cáo

### Bối cảnh pháp lý (cần luật sư xác nhận)

- **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15** có hiệu lực từ 01/01/2026; Nghị định 356/2025/NĐ-CP hướng dẫn thi hành. Báo chí nêu mức phạt có thể tới 5% doanh thu năm liền kề với một số vi phạm. Nghị định 13/2023/NĐ-CP là văn bản trước đó.
- **Nghị định 91/2020/NĐ-CP** về chống tin nhắn rác, thư điện tử rác, cuộc gọi rác: chỉ được gửi tin nhắn, email quảng cáo khi người nhận đã đồng ý trước.

### Điểm chạm trong HireX

| Dữ liệu / hành vi | Nơi xử lý | Đã có | Còn thiếu |
| --- | --- | --- | --- |
| CV ứng viên gửi OpenAI | `api/cv-scan`, AI Recruiter | `store: false`; nội dung CV được coi là không đáng tin | Thông báo cho ứng viên rằng CV được xử lý bằng AI bên thứ ba ở nước ngoài; `store: false` **không** có nghĩa là OpenAI không lưu tạm |
| Hồ sơ và facts ứng viên | `ai_recruiter_candidate_facts`, `conversation_states` | Chỉ lưu khi có trích dẫn nguyên văn | Thời hạn lưu và cách xóa theo yêu cầu |
| Chiến dịch đa kênh | `022`, `contact_channels.marketing_consent_status` | Chỉ gửi tới liên hệ `OPTED_IN`; danh sách chặn; link hủy email | Bằng chứng đồng ý (nguồn, thời điểm) khi nhập danh sách từ Excel |
| AI Recruiter AUTO | `process-ai-recruiter.ts` | Bot xưng "em" như recruiter | Cân nhắc cho ứng viên biết họ đang nói chuyện với trợ lý AI, ít nhất ở tin đầu tiên |
| Tài liệu Human | `runtime/human-documents` | Mã hóa, chỉ admin | Phân loại tài liệu có dữ liệu nhân sự nhạy cảm |

### Khuyến nghị

1. Nhờ luật sư rà soát ba việc: thông báo xử lý dữ liệu cho ứng viên (gồm việc chuyển dữ liệu cho OpenAI), quy trình xin và lưu bằng chứng đồng ý cho chiến dịch, và thời hạn lưu dữ liệu.
2. Thêm trường nguồn và thời điểm đồng ý bắt buộc khi nhập danh sách chiến dịch.
3. Quyết định chính sách công khai AI trong tin mở đầu của AI Recruiter.

## 4. AI Recruiter AUTO

Đã xử lý trong migration 069: lớp kiểm tra cuối trong database yêu cầu cả bot và hội thoại bật AUTO, tin AI không mang tên người duyệt, và mọi lần bật/tắt được ghi audit. Còn lại (xem `ARCHITECTURE.md` §4.2–4.3):

- Trần số tin AUTO mỗi bot / mỗi tài khoản kênh mỗi giờ, cùng một công tắc dừng toàn workspace, kiểm tra ngay trong hàm database.
- Chỉ số hằng ngày: số tin AUTO, tỷ lệ chuyển người, tỷ lệ phải dùng câu trả lời dự phòng, tỷ lệ ứng viên dừng trả lời.
- Bộ hội thoại mẫu để chạy lại mỗi khi đổi prompt hoặc model.

Kết hợp với mục 1: AUTO trên kênh cá nhân làm tăng tốc độ gửi tự động, nên là điểm cần hạn chế đầu tiên nếu tài khoản có dấu hiệu bị theo dõi.

## 5. Kế hoạch hành động đề xuất

| Thời hạn | Việc | Người phụ trách gợi ý |
| --- | --- | --- |
| Tuần này | Sao lưu khóa và `runtime/` ra ngoài máy; giám sát uptime; tác vụ lịch chạy cả khi đăng xuất | Vận hành |
| Tuần này | Trần gửi chủ động trên kênh cá nhân; dừng chiến dịch lạnh qua kênh cá nhân | Sales lead |
| 2 tuần | Xoay vòng log, dọn file tạm Deplao | Kỹ thuật |
| 1 tháng | Trần tin AUTO và công tắc dừng toàn workspace trong database; chỉ số AUTO | Kỹ thuật |
| 1 tháng | Rà soát pháp lý dữ liệu ứng viên và bằng chứng đồng ý | Quản lý + luật sư |
| 1–3 tháng | Đưa AI Recruiter sang Facebook Page / Zalo OA; đăng ký mẫu ZNS | Kỹ thuật + Sales |
| 3–6 tháng | Chuyển sang máy chủ luôn bật, Docker, staging | Kỹ thuật |

## Nguồn

- [Meta — Automated Data Collection](https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/)
- [Meta — Messenger Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api)
- [CafeF — Thao tác có thể khiến tài khoản Zalo bị khóa vĩnh viễn (09/2026)](https://cafef.vn/thao-tac-co-the-khien-tai-khoan-zalo-cua-ban-bi-khoa-vinh-vien-188260910160926853.chn)
- [OpenClaw — Zalo cá nhân (cảnh báo tích hợp không chính thức)](https://docs.openclaw.ai/vi/channels/zalouser)
- [eSMS — Zalo OA: loại tin và hạn mức](https://helpcenter.esms.vn/cau-hoi-thuong-gap/zalo-oa)
- [Infobip — Zalo compliance guidelines](https://www.infobip.com/docs/zalo/compliance-guidelines)
- [LuatVietnam — Nghị định hướng dẫn Luật Bảo vệ dữ liệu cá nhân 2025](https://luatvietnam.vn/dan-su/nghi-dinh-huong-dan-luat-bao-ve-du-lieu-ca-nhan-2025-la-nghi-dinh-nao-568-103658-article.html)
- [VnEconomy — Xâm phạm dữ liệu cá nhân có thể bị phạt tới 5% doanh thu](https://vneconomy.vn/xam-pham-du-lieu-ca-nhan-co-the-bi-phat-toi-da-den-5-doanh-thu-nam-lien-ke.htm)
- [Nghị định 91/2020/NĐ-CP (bản PDF)](https://www.qtsc.com.vn/uploads/files/2020/09/07/91_2020_ND-CP.pdf)
