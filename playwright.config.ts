import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir:"./tests/e2e",
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL??"http://localhost:3000",storageState:process.env.PLAYWRIGHT_STORAGE_STATE??"playwright/.auth/hirex.json",acceptDownloads:true},
});
