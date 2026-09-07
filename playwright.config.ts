import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir:"./tests/e2e",
  use:{baseURL:"http://localhost:3000",storageState:"playwright/.auth/hirex.json",acceptDownloads:true},
});
