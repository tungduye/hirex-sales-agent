-- 138: HireX HQ mức 2 (bản đồ văn phòng). profiles.avatar_url: ảnh đại diện of a member, set on Vai trò và phân quyền.
-- Empty = the map shows the member's initials. Only https links.
begin;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles drop constraint if exists profiles_avatar_url_shape;
alter table public.profiles add constraint profiles_avatar_url_shape
  check (avatar_url is null or (avatar_url ~ '^https://[^[:space:]]+$' and length(avatar_url) <= 1000));
commit;
