import {expect,test} from "@playwright/test";

test("campaign controls remain isolated from row navigation",async({page})=>{
  const expectPathname=async(pathname:string)=>expect(new URL(page.url()).pathname).toBe(pathname);
  await page.goto("/campaigns");
  await expect(page).toHaveURL(/\/campaigns(?:\?.*)?$/);

  const search=page.getByPlaceholder("Search campaigns");
  await search.click();
  await search.fill("TEST");
  await expect(page).toHaveURL(/\/campaigns$/);

  await page.locator('select[name="status"]').selectOption("DRAFT");
  await expect(page).toHaveURL(/\/campaigns$/);

  await page.getByRole("link",{name:"New Campaign"}).click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  await page.goto("/campaigns");

  const campaignLinks=page.locator('tbody a[href^="/campaigns/"]');
  expect(await campaignLinks.count()).toBeGreaterThanOrEqual(2);
  const firstHref=await campaignLinks.nth(0).getAttribute("href");
  const secondHref=await campaignLinks.nth(1).getAttribute("href");
  expect(firstHref).toMatch(/^\/campaigns\/[0-9a-f-]+$/);
  expect(secondHref).toMatch(/^\/campaigns\/[0-9a-f-]+$/);
  expect(firstHref).not.toBe(secondHref);

  await campaignLinks.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`${firstHref}$`));
  await page.goto("/campaigns");
  await page.locator('tbody a[href^="/campaigns/"]').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`${secondHref}$`));

  for(const section of ["Overview","Audience","Sequence","Senders","Activity","Reports"]){
    await page.getByRole("link",{name:section,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`${secondHref}#${section.toLowerCase()}$`));
  }

  await page.getByPlaceholder("Search email, name, company, position").click();
  await expectPathname(secondHref!);
  await page.locator('select[name="audienceStatus"]').selectOption("ALL");
  await expectPathname(secondHref!);

  for(const format of ["CSV","XLSX"]){
    const downloadPromise=page.waitForEvent("download");
    await page.getByRole("link",{name:format,exact:true}).click();
    const download=await downloadPromise;
    expect(download.suggestedFilename()).toBe(`campaign-report.${format.toLowerCase()}`);
    await expectPathname(secondHref!);
  }
});
