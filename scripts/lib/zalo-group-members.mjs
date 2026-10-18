// Zalo group member names/avatars from Deplao's page_group_member table, mapped to HireX rows.
// Pure helpers; unit-tested. Rows without a usable name are skipped (nothing to show).

const zaloId = /^[0-9]{1,40}$/u;

export function mapGroupMemberRow(row, account) {
  if (!row || !account) return null;
  const groupId = String(row.group_id ?? ""), memberId = String(row.member_id ?? "");
  const name = typeof row.display_name === "string" ? row.display_name.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 255) : "";
  if (!zaloId.test(groupId) || !zaloId.test(memberId) || !name) return null;
  const avatar = typeof row.avatar === "string" && /^https?:\/\//u.test(row.avatar) && row.avatar.length <= 2048 ? row.avatar : null;
  const role = Number.isSafeInteger(row.role) && row.role >= 0 && row.role <= 9 ? row.role : 0;
  const updatedMs = Number(row.updated_at);
  return {
    workspace_id: account.workspace_id, channel_account_id: account.id, group_id: groupId, member_id: memberId,
    display_name: name, avatar_url: avatar, role,
    updated_at: new Date(Number.isFinite(updatedMs) && updatedMs > 0 ? updatedMs : Date.now()).toISOString(),
  };
}

// Deplao often has a member without a name in the group list but knows the person as a friend or contact of the
// same nick: use that name (and avatar) instead.
const nameFallback = (owner, member) => `coalesce(
    (select nullif(f.display_name, '') from friends f where f.owner_zalo_id = ${owner} and f.user_id = ${member}),
    (select nullif(c.display_name, '') from contacts c where c.owner_zalo_id = ${owner} and c.contact_id = ${member}))`;
const avatarFallback = (owner, member) => `coalesce(
    (select nullif(f.avatar, '') from friends f where f.owner_zalo_id = ${owner} and f.user_id = ${member}),
    (select nullif(c.avatar_url, '') from contacts c where c.owner_zalo_id = ${owner} and c.contact_id = ${member}))`;

/** Rows changed after the account's cursor {at: Deplao updated_at in ms, id: row id}, oldest first. */
export function selectChangedMembers(database, accountZaloId, cursor, limit = 2000) {
  return database.prepare(`select m.id, m.group_id, m.member_id,
      coalesce(nullif(m.display_name, ''), ${nameFallback("m.owner_zalo_id", "m.member_id")}, '') display_name,
      coalesce(nullif(m.avatar, ''), ${avatarFallback("m.owner_zalo_id", "m.member_id")}, '') avatar, m.role, m.updated_at
    from page_group_member m
    where m.owner_zalo_id = ? and (m.updated_at > ? or (m.updated_at = ? and m.id > ?)) order by m.updated_at, m.id limit ?`)
    .all(accountZaloId, cursor.at, cursor.at, cursor.id, limit);
}

/**
 * People who wrote in a group recently but are missing from Deplao's member list, named from the nick's friends or
 * contacts. Small (a few hundred rows), so it is read in full on every run.
 */
export function selectRecentSendersOutsideList(database, accountZaloId, sinceMs) {
  return database.prepare(`select s.t group_id, s.u member_id, ${nameFallback("s.o", "s.u")} display_name,
      coalesce(${avatarFallback("s.o", "s.u")}, '') avatar, 0 role, s.at updated_at
    from (select owner_zalo_id o, thread_id t, sender_id u, max(timestamp) at from messages
      where channel = 'zalo' and thread_type = 1 and is_sent = 0 and owner_zalo_id = ? and sender_id glob '[0-9]*' and timestamp > ?
      group by owner_zalo_id, thread_id, sender_id) s
    where not exists (select 1 from page_group_member m where m.owner_zalo_id = s.o and m.group_id = s.t and m.member_id = s.u)
      and ${nameFallback("s.o", "s.u")} is not null`).all(accountZaloId, sinceMs);
}
