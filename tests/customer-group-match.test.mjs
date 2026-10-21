import assert from "node:assert/strict";
import test from "node:test";
import { companyAliases, matchGroup } from "../src/modules/customers/core/group-match.ts";

const companies = [
  { id: 1, name: "BRISASOFT", website: "https://brisasoft.com" },
  { id: 2, name: "VNEXT SOFTWARE", website: null },
  { id: 3, name: "KSS Japan", website: null },
  { id: 4, name: "Shift Asia", website: "shiftasia.com" },
  { id: 5, name: "DTS Software", website: null },
  { id: 6, name: "Capgemini", website: "www.capgemini.com" },
];

test("tên ngắn của công ty", () => {
  assert.deepEqual(companyAliases("VNEXT SOFTWARE", null), ["vnext software", "vnext"]);
  assert.deepEqual(companyAliases("Công ty TNHH Yopaz", null), ["cong ty tnhh yopaz", "yopaz"]);
});

test("ghép nhóm Zalo với công ty theo tên nhóm", () => {
  assert.deepEqual(matchGroup("30/09 - BRISASOFT - BrSE HN - Mai", companies).map((item) => item.id), [1]);
  assert.deepEqual(matchGroup("X 1- Vnext-Mai-Se/Brse T", companies).map((item) => item.id), [2]);
  assert.deepEqual(matchGroup("KSS-Trí-Dev Full Stack H", companies).map((item) => item.id), [3]);
  assert.deepEqual(matchGroup("Shift Asia - Tùng - Sales J", companies).map((item) => item.id), [4]);
  assert.deepEqual(matchGroup("Dts Software-Mai-Sale IT", companies).map((item) => item.id), [5]);
  assert.deepEqual(matchGroup("Capgemini-Tùng-SE/BrS", companies).map((item) => item.id), [6]);
  assert.deepEqual(matchGroup("R&D - Lõi bộ phận", companies), []);
});
