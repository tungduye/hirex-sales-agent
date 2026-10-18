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

/** Rows changed after the account's cursor {at: Deplao updated_at in ms, id: row id}, oldest first. */
export function selectChangedMembers(database, accountZaloId, cursor, limit = 2000) {
  return database.prepare(`select id, group_id, member_id, display_name, avatar, role, updated_at from page_group_member
    where owner_zalo_id = ? and (updated_at > ? or (updated_at = ? and id > ?)) order by updated_at, id limit ?`)
    .all(accountZaloId, cursor.at, cursor.at, cursor.id, limit);
}
