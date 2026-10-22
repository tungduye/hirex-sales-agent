import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFilterQuery, suggestFilterName } from "../src/modules/inbox/core/saved-filters.ts";

test("keeps only list filters", () => {
  assert.equal(cleanFilterQuery("?channel=ZALO&page=3&account=a,b&foo=1&tagMode=all"), "channel=ZALO&account=a%2Cb");
  assert.equal(cleanFilterQuery("tag=t1&tagMode=any"), "tag=t1&tagMode=any");
});

test("suggests a readable name", () => {
  assert.equal(suggestFilterName({ scope: "TEAM", view: "waiting", query: "channel=ZALO&account=a%2Cb" }), "Team · Zalo · Chưa trả lời · 2 tài khoản");
  assert.equal(suggestFilterName({ scope: null, view: "all", query: "" }), "Bộ lọc của tôi");
  assert.equal(suggestFilterName({ scope: "MINE", view: null, query: "account=a", accountName: "Dương Linh" }), "Cá nhân · Dương Linh");
});
