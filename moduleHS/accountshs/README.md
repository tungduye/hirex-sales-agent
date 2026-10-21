# accountshs — AccountsHS (Python v7) chuyển sang HireX

## Đã chốt (21/10/2026)
- Dữ liệu: đã nằm sẵn trong Supabase của HireX (bảng `ahs_*`) → dùng nguyên, không import; migration chỉ khai báo DDL + RLS.
- Phạm vi: toàn bộ — v7.py + chatbot Cú vọ + checker Vọng gác + owl + style (theme) + core_animation. Làm nhiều đợt, lõi v7 trước.
- UI: giữ CSS/theme gốc AccountsHS (`var(--ui-*)`, class `.btn .pri .ghost …`), scope trong trang Tài khoản; không dùng Tailwind cho phần này.
- Thay iframe `server-ahs.hat11.io.vn` ở `src/app/(crm)/accounts/page.tsx` bằng UI nhúng; quyền `accounts.view` giữ nguyên.

## Nguồn Python
`_src_python/` = bản sao mã nguồn (không kèm DB/backup/attachments/`ahs_pg.json`). Nghiên cứu & kế hoạch: `MIGRATION_PLAN.md`.

## Bảng đối chiếu cũ → mới
(điền khi convert)
