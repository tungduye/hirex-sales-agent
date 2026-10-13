# HireX Sales Agent

CRM đa kênh cho đội Sales và Tuyển dụng của HireX: quản lý công ty/liên hệ, hộp thư hợp nhất (Gmail, Facebook Page, Facebook cá nhân, Zalo), chiến dịch email và chiến dịch đa kênh, AI Recruiter tự động trò chuyện với ứng viên, cùng các công cụ AI (Scan CV, Scan Website, hỏi đáp tài liệu Human).

Tài liệu liên quan:

- [`ARCHITECTURE.md`](ARCHITECTURE.md): kiến trúc, ranh giới AI, chế độ AUTO.
- [`ROADMAP.md`](ROADMAP.md): trạng thái hiện tại và các giai đoạn tiếp theo.
- [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md): mô hình dữ liệu gốc (Contact/ContactChannel).
- [`docs/`](docs): ghi chú theo từng tính năng (Gmail send, chiến dịch email, omnichannel, Zalo, n8n, Human documents, Task Scheduler).

> `AGENTS.md`/`CLAUDE.md` do `next dev` tự sinh: dự án dùng **Next.js 16.3**, có thay đổi phá vỡ so với các bản cũ (ví dụ `src/proxy.ts` thay cho `middleware.ts`). Đọc `node_modules/next/dist/docs/` trước khi sửa phần routing.

## Tính năng chính

| Khu vực | Đường dẫn | Ghi chú |
| --- | --- | --- |
| Tổng quan, Công ty, Liên hệ | `/`, `/companies`, `/contacts` | Mỗi liên hệ có nhiều kênh (`contact_channels`) và trạng thái đồng ý marketing |
| Hồ Chứa (Inbox hợp nhất) | `/inbox`, `/inbox/all` | Gmail + Facebook Page + Facebook cá nhân + Zalo; giao người phụ trách, tag, trả lời nhanh, chuyển cho người (takeover) |
| Chiến dịch | `/campaigns` | Email (chuỗi bước, đính kèm, HTML, hủy đăng ký, quota Gmail), đa kênh Zalo/Facebook (`/campaigns/omnichannel`), Facebook cá nhân (`/campaigns/facebook-profile`) |
| Scan | `/scan/cv`, `/scan/website` | Đọc CV và quét website bằng OpenAI |
| AI Recruiter | `/settings/ai-recruiter` | 4 chatbot (SALE, RECRUITER, COLLABORATOR, INTERNAL_HR), chế độ **AUTO** tự gửi tin. Xem mục *AI Recruiter* bên dưới |
| Tài liệu Human | `/documents`, `/settings/human` | Hỏi đáp trên snapshot tài liệu đã mã hóa |
| Tự động hoá | `/settings/automation` | Giám sát n8n (chỉ đọc) |
| Phân quyền | `/settings/roles` | Vai trò và quyền theo workspace, kết hợp RLS của Supabase |

## Công nghệ

Next.js 16.3 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) · Zod · OpenAI Responses API (gọi bằng `fetch`) · Playwright.

## Cài đặt môi trường dev

Yêu cầu: Node.js 22.18+ (unit test import trực tiếp file `.ts` nhờ type stripping của Node), tài khoản Supabase (hoặc Supabase local qua CLI).

```powershell
npm install
copy .env.example .env.local   # rồi điền giá trị thật, KHÔNG commit file này
npm run dev                    # http://localhost:3000
```

Áp dụng migration lên database:

```powershell
npx supabase db push           # chạy các file supabase/migrations/NNN_*.sql chưa áp dụng
```

Schema **chỉ** được thay đổi bằng migration mới, đánh số tiếp theo (hiện tới `068`). Các file trong `supabase/tests/` là test SQL cho từng migration và cho tình huống tranh chấp đồng thời.

## Biến môi trường

Đặt trong `.env.local` (đã nằm trong `.gitignore`). Các khóa mã hóa là chuỗi base64 32 byte.

| Biến | Bắt buộc | Dùng cho |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Có | Kết nối Supabase phía người dùng |
| `SUPABASE_SECRET_KEY` | Có | Client đặc quyền phía server, worker và script |
| `AUTOMATION_CRON_SECRET` | Có | Bearer token cho mọi endpoint `/api/internal/*` (worker, scheduler) |
| `APP_BASE_URL` | Có | Link tuyệt đối (hủy đăng ký, OAuth) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Có nếu dùng AI | AI Recruiter, Scan CV, gợi ý trả lời |
| `OPENAI_WEBSITE_SCAN_MODEL` | Không | Model riêng cho Scan Website (mặc định `gpt-4.1-mini`) |
| `HUMAN_DOCUMENTS_AI_MODEL`, `HUMAN_API_BASE_URL` | Không | Hỏi đáp tài liệu Human |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI` | Có nếu dùng Gmail | OAuth Gmail |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | Có nếu dùng Gmail | Mã hóa token Gmail (và kết nối Human) |
| `EMAIL_UNSUBSCRIBE_SIGNING_KEY` | Có nếu chạy chiến dịch email | Ký link hủy đăng ký |
| `CHANNEL_TOKEN_ENCRYPTION_KEY` | Có nếu dùng Facebook/Zalo | Mã hóa credential kênh |
| `FACEBOOK_WEBHOOK_VERIFY_TOKEN` | Có nếu dùng Facebook Page | Xác minh webhook Meta |
| `HIREX_N8N_INSTANCE_1_API_KEY`, `HIREX_N8N_INSTANCE_2_API_KEY` | Không | Màn hình giám sát n8n |
| `HIREX_INTERNAL_BASE_URL` | Không | URL nội bộ cho worker (mặc định `http://127.0.0.1:3000`) |
| `HIREX_BUILD_DIR` | Không | Đổi thư mục build (mặc định `.next`) |
| `HIREX_CAMPAIGN_SCHEDULER_URL`, `HIREX_SCHEDULER_DRY_RUN` | Không | Ghi đè endpoint / chạy thử scheduler chiến dịch |

## Vận hành production (máy Windows hiện tại)

Ứng dụng chạy trên **một máy Windows** (`C:\Users\Admin\hirex-sales-agent`), lắng nghe `127.0.0.1:3000`, và được đưa ra ngoài qua tên miền `app.hirexmkt.online`.

**Tiến trình chính** (`npm run start` → `scripts/start-production.mjs`):

- `next start`: web và các API.
- `scripts/facebook-page-reconciler.mjs`: cứ 30 giây kéo tin nhắn Facebook Page bị lỡ webhook. Page lỗi liên tục được thử lại thưa dần, tối đa 1 giờ; trạng thái nằm trong `runtime/facebook-page-reconciler/status.json`.
- `scripts/ai-recruiter-worker.mjs`: cứ 5 giây gọi `/api/internal/ai-recruiter/process`, khi lỗi thì giãn dần tới 60 giây.

Hai worker trên tự khởi động lại sau 3 giây nếu bị tắt.

**Windows Task Scheduler**:

| Task | Script | Chu kỳ |
| --- | --- | --- |
| `HireX Local App` | `run-hirex-local-app.ps1` | Khi đăng nhập, tự khởi động lại |
| `HireX Gmail Incremental Sync` | `run-gmail-incremental-sync.ps1` | 5 phút |
| Email campaign scheduler | `run-email-campaign-scheduler.ps1` | 1 phút |
| Channel campaign scheduler | `run-channel-campaign-scheduler.ps1` | theo cài đặt |
| Deplao (Zalo) supervisor, Facebook profile bridge | `ensure-deplao-realtime-supervisor.ps1`, `ensure-facebook-profile-bridge.ps1` | watchdog |

Các script `install-*-task.ps1` / `uninstall-*-task.ps1` dùng để cài hoặc gỡ task. Xem thêm `docs/WINDOWS_SCHEDULER.md`.

**Triển khai bản mới**:

```powershell
$env:HIREX_BUILD_DIR = ".next-<tên-bản>"; npm run build; Remove-Item Env:HIREX_BUILD_DIR
powershell -File scripts\deploy-recruiter-tone.ps1 -Release <tên-bản>
```

Script chờ scheduler chiến dịch email chạy xong (khóa `runtime\email-campaign-scheduler.lock`), dừng web, đổi `.next` hiện tại thành `.next-before-<tên-bản>`, đưa bản mới vào và kiểm tra `/login`. Tên bản phải nằm trong danh sách `ValidateSet` của script.

**Quay lại bản cũ**: dừng task `HireX Local App`, đổi tên `.next` hiện tại, đổi `.next-before-<tên-bản>` về lại `.next`, rồi chạy lại task. Nên giữ khoảng 3 bản `.next-before-*` mới nhất.

**Dữ liệu cục bộ** trong `runtime/` (không commit): log scheduler, trạng thái bridge Zalo/Facebook, snapshot tài liệu Human đã mã hóa, khóa chống chạy trùng. Cần sao lưu thư mục này và các khóa mã hóa **riêng biệt** với nhau.

## AI Recruiter và chế độ AUTO

AUTO là chế độ chính thức: AI tự trả lời ứng viên mà không chờ người duyệt. Một hội thoại chỉ được gửi tự động khi **đồng thời** thỏa:

1. Bot được bật, `mode = AUTO`, và đang gắn với đúng tài khoản kênh của hội thoại.
2. Admin đã bật AUTO cho riêng hội thoại đó (`aiRecruiterModeOverride = AUTO`).
3. Hội thoại đang `OPEN`/`PENDING`, chưa bị người tiếp quản (`takeover_mode = BOT_ALLOWED`), bot chưa bị tạm dừng, không phải nhóm chat.
4. Người nhận không nằm trong danh sách chặn của kênh đó.

Thiếu bất kỳ điều kiện nào thì hệ thống chỉ tạo bản nháp (DRAFT). Chi tiết các rào chắn và hạn chế đã biết nằm trong `ARCHITECTURE.md` §4.

Cách dừng AI ngay lập tức:

- Một hội thoại: bấm tiếp quản (takeover) trong Inbox, hoặc chuyển hội thoại về DRAFT.
- Một bot: tắt bot hoặc chuyển bot về DRAFT ở `/settings/ai-recruiter`.
- Toàn bộ: dừng tiến trình `ai-recruiter-worker.mjs`.

## Kiểm tra

```powershell
npm run lint
node --test tests/*.test.mjs          # unit test cho logic thuần
npx playwright test                   # e2e (cần auth đã capture trong playwright/.auth)
```

Thư mục `scripts/validate-*.mjs` chứa các kịch bản kiểm tra theo từng giai đoạn, chạy tay khi cần.

## Bảo mật

- Không commit `.env*`, `runtime/`, log (`*.log`), `playwright/.auth/`.
- Token Gmail/Facebook/Zalo được mã hóa AES-256-GCM trong database; AI không bao giờ nhận credential của kênh.
- Mọi endpoint `/api/internal/*` yêu cầu `AUTOMATION_CRON_SECRET`; webhook Facebook/Zalo được kiểm tra chữ ký.
