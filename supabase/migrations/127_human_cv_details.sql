-- 127: Màn CV · hồ sơ chi tiết. Human gives each CV's full record one at a time (GET /cv/{cvId}); HireX keeps a copy,
-- fetched again only when the CV changed on the list (fingerprint) or someone opens it after an hour. Same rights as the CV.
begin;

alter table public.human_cvs
  add column detail jsonb,
  add column detail_fingerprint text,
  add column detail_fetched_at timestamptz,
  add column detail_error text check (detail_error is null or char_length(detail_error) <= 100),
  add column fingerprint text,
  add column detail_search text not null default '';

commit;
