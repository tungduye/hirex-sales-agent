import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phân loại: several tags mean conversations that have every picked tag", () => {
  const menu = read("src/modules/inbox/components/inbox-tag-menu.tsx");
  assert.match(menu, /query\.set\("tagMode", "all"\)/u);
  assert.doesNotMatch(menu, /query\.set\("tagMode", "any"\)/u);
});

test("changing a Suối Nguồn filter rewrites the address only (no server render of the page)", () => {
  for (const file of ["inbox-tag-menu.tsx", "infinite-conversation-list.tsx"]) {
    const source = read(`src/modules/inbox/components/${file}`);
    assert.match(source, /replaceInboxQuery\(pathname, query\)/u, file);
    assert.doesNotMatch(source, /router\.replace\(/u, file);
  }
  assert.match(read("src/modules/inbox/components/inbox-shell.tsx"), /loadViewCounts\(countKeyOf\(/u);
});

test("the tag filter in the database starts from the tagged conversations and checks access once per nick", () => {
  const sql = read("supabase/migrations/144_inbox_filter_speed.sql");
  assert.match(sql, /count\(distinct l\.tag_id\) >= \(select count\(distinct x\) from unnest\(p_tag_ids\) x\)/u);
  assert.match(sql, /where public\.can_access_channel_account\(a\.id\)/u);
  assert.match(sql, /c\.workspace_id = \$1/u);
});
