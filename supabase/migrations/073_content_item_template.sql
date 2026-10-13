-- 073: Record which sample template each content item was written from (shown in the library).
begin;
alter table public.content_items
  add column template_id uuid,
  add constraint content_items_template_fk foreign key (template_id, workspace_id)
    references public.content_templates(id, workspace_id) on delete set null (template_id);
create index content_items_template on public.content_items(template_id) where template_id is not null;
grant insert (template_id) on public.content_items to authenticated;
commit;
