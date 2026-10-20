-- 113: Two different things at the top of a Zalo group (Đợt D, fixed after testing):
--   "Ghim tin" (pin_message): the broadcast message is sent, then that message is pinned ("Tin ghim").
--   "Ghi chú"  (pin_note):    a note is added to the group board and pinned ("Ghi chú").
-- pin_status keeps tracking the note; message_pin_status tracks the pinned message.
begin;
alter table public.zalo_broadcasts add column pin_message boolean not null default false;
alter table public.zalo_broadcasts drop constraint zalo_broadcasts_does_something,
  add constraint zalo_broadcasts_does_something check (send_message or pin_note),
  add constraint zalo_broadcasts_pin_needs_message check (not pin_message or send_message);
alter table public.zalo_broadcast_targets
  add column message_pin_status text not null default 'NONE' check (message_pin_status in ('NONE', 'PENDING', 'PINNED', 'FAILED')),
  add column message_pin_attempts integer not null default 0 check (message_pin_attempts between 0 and 3);
commit;
