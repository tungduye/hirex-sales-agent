-- Thị trường of a nick (IT, IT JP, Khác), set in Cài đặt → Kênh. Suối Nguồn's people filter groups nicks by
-- Bộ phận (of the nick's main user) → Thị trường (of the nick) → Owner (main user) → nick. Null = Khác.
begin;
alter table public.channel_accounts add column if not exists market text;
alter table public.channel_accounts drop constraint if exists channel_accounts_market_allowed;
alter table public.channel_accounts add constraint channel_accounts_market_allowed check (market is null or market in ('IT', 'IT_JP', 'OTHER'));
commit;
