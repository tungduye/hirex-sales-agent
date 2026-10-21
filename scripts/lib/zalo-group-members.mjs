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

/**
 * Group writers this nick cannot name, named through another of our nicks in the same group. Zalo shows each
 * nick a different id for the same person, but a message keeps one msg_id for everyone: the same message seen by
 * another nick tells who wrote it - one of our own nicks (it is that nick's sent message) or a person that nick
 * knows. This is how a nick learns the names of the other nicks in its groups.
 */
export function selectCrossNickSenders(database, accountZaloId, sinceMs) {
  return database.prepare(`select s.t group_id, s.u member_id, max(s.at) updated_at, 0 role,
      coalesce(max(case when o.is_sent = 1 then nullif(a.full_name, '') end), max(nullif(pm.display_name, '')),
        max(nullif(f.display_name, '')), max(nullif(ct.display_name, ''))) display_name,
      coalesce(max(case when o.is_sent = 1 then nullif(a.avatar_url, '') end), max(nullif(pm.avatar, '')),
        max(nullif(f.avatar, '')), max(nullif(ct.avatar_url, '')), '') avatar
    from (select owner_zalo_id ow, thread_id t, sender_id u, msg_id, timestamp at from messages
      where owner_zalo_id = ? and channel = 'zalo' and thread_type = 1 and is_sent = 0 and sender_id glob '[0-9]*'
        and coalesce(msg_id, '') <> '' and timestamp > ?) s
    join messages o on o.msg_id = s.msg_id and o.owner_zalo_id <> s.ow
    left join accounts a on a.zalo_id = o.owner_zalo_id
    left join page_group_member pm on pm.owner_zalo_id = o.owner_zalo_id and pm.group_id = o.thread_id and pm.member_id = o.sender_id
    left join friends f on f.owner_zalo_id = o.owner_zalo_id and f.user_id = o.sender_id
    left join contacts ct on ct.owner_zalo_id = o.owner_zalo_id and ct.contact_id = o.sender_id
    where not exists (select 1 from page_group_member m where m.owner_zalo_id = s.ow and m.group_id = s.t and m.member_id = s.u and m.display_name <> '')
    group by s.t, s.u`).all(accountZaloId, sinceMs).filter((row) => row.display_name);
}

/**
 * Group chats of this nick with a usable name. Deplao often knows a group only by its id for some nicks; then the
 * name comes from another of our nicks in the same group (same message id = same group). Recent groups only.
 */
// A name made only of digits is an id, not a name; a real name may start with a digit ("30/09 - BRISASOFT - BrSE HN").
export function selectGroupNames(database, accountZaloId, sinceMs) {
  const named = (alias) => `nullif(nullif(trim(${alias}.display_name), ''), ${alias}.contact_id)`;
  return database.prepare(`select g.t thread_id,
      coalesce((select ${named("c")} from contacts c where c.owner_zalo_id = ? and c.contact_id = g.t and ${named("c")} glob '*[^0-9]*'),
        (select ${named("oc")} from messages m join messages o on o.msg_id = m.msg_id and o.owner_zalo_id <> m.owner_zalo_id
           join contacts oc on oc.owner_zalo_id = o.owner_zalo_id and oc.contact_id = o.thread_id
         where m.owner_zalo_id = ? and m.thread_id = g.t and coalesce(m.msg_id, '') <> '' and ${named("oc")} glob '*[^0-9]*'
         order by m.timestamp desc limit 1)) name
    from (select distinct thread_id t from messages where owner_zalo_id = ? and channel = 'zalo' and thread_type = 1 and timestamp > ?) g`)
    .all(accountZaloId, accountZaloId, accountZaloId, sinceMs)
    .filter((row) => typeof row.name === "string" && row.name.trim() && /^[0-9]{1,40}$/u.test(String(row.thread_id)))
    .map((row) => ({ threadId: String(row.thread_id), name: row.name.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 255) }));
}

/**
 * Which nicks' group chats are one and the same Zalo group: a message keeps one msg_id for every nick, so two
 * group threads holding the same message are the same group (whatever each nick calls it, even after a rename).
 * Returns "owner:thread" -> key, the key being the smallest "owner:thread" of the group (only groups seen by 2+ nicks).
 */
export function selectGroupIdentities(database, sinceMs) {
  // One plain scan; grouping by message id happens here (a self-join on msg_id is far slower in SQLite).
  const rows = database.prepare(`select msg_id, owner_zalo_id owner, thread_id thread from messages
    where thread_type = 1 and channel = 'zalo' and timestamp > ? and coalesce(msg_id, '') <> ''`).all(sinceMs);
  const byMessage = new Map();
  for (const row of rows) {
    const node = `${row.owner}:${row.thread}`;
    if (!/^[0-9]{1,40}:[0-9]{1,40}$/u.test(node)) continue;
    const list = byMessage.get(row.msg_id);
    if (list) { if (!list.includes(node)) list.push(node); } else byMessage.set(row.msg_id, [node]);
  }
  const links = [];
  for (const nodes of byMessage.values()) for (let index = 1; index < nodes.length; index++) links.push([nodes[0], nodes[index]]);
  const parent = new Map();
  const find = (node) => { let root = node; while (parent.get(root) !== root) root = parent.get(root); let next = node; while (next !== root) { const up = parent.get(next); parent.set(next, root); next = up; } return root; };
  const add = (node) => { if (!parent.has(node)) parent.set(node, node); };
  for (const [a, b] of links) {
    if (a.split(":")[0] === b.split(":")[0]) continue;
    add(a); add(b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) { if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); }
  }
  const keys = new Map();
  for (const node of parent.keys()) keys.set(node, find(node));
  return keys;
}
