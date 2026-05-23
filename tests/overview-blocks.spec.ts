import { expect, test, type Page } from "@playwright/test";

async function revealDeckChrome(page: Page) {
  await page.locator("#deck-chrome-hover-target").hover();
  await page.waitForTimeout(60);
}

async function enterEdit(page: Page) {
  await revealDeckChrome(page);
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body.deck--editing")).toBeVisible();
}

async function goOverview(page: Page) {
  await page.locator('[data-slide-dot="1"]').click();
  await expect(page.locator('[data-slide-index="1"]')).toBeVisible();
  await expect(page.locator("#overview-sections")).toBeVisible();
}

test("legacy overview title+sections migrate to blocks on load", async ({ page }) => {
  await page.goto("/template-tech.html");
  await goOverview(page);

  const blocks = await page.evaluate(() => window.__matrixOverviewBlocks?.());
  expect(blocks).not.toBeNull();
  expect(blocks!.length).toBeGreaterThanOrEqual(3);
  expect(blocks!.some((b) => b.type === "h1" && /概述标题/.test(b.html))).toBeTruthy();
  expect(blocks!.filter((b) => b.type === "h3").length).toBe(2);
  expect(blocks!.filter((b) => b.type === "body").length).toBe(2);
});

test("overview edit toolbar inserts and removes blocks", async ({ page }) => {
  await page.goto("/template-tech.html");
  await goOverview(page);
  await enterEdit(page);

  const section = page.locator('[data-slide-index="1"]');
  await expect(section.locator(".overview-toolbar")).toBeVisible();

  const beforeCount = await section.locator(".overview-block").count();
  await section.locator('[data-overview-action="add-h2"]').click();
  await expect(section.locator(".overview-block")).toHaveCount(beforeCount + 1);
  await expect(section.locator('.overview-block[data-overview-block-type="h2"]').last()).toContainText(
    "二级标题"
  );

  await section.locator('[data-overview-action="add-body"]').click();
  await expect(section.locator('.overview-block[data-overview-block-type="body"]').last()).toContainText(
    "正文段落"
  );

  const h2 = section.locator('.overview-block[data-overview-block-type="h2"]').last();
  await h2.click();
  await section.locator('[data-overview-action="remove-block"]').click();
  await expect(section.locator(".overview-block")).toHaveCount(beforeCount + 1);
});

test("overview blocks persist after save and reload", async ({ page }) => {
  await page.goto("/template-tech.html");
  await goOverview(page);
  await enterEdit(page);

  const section = page.locator('[data-slide-index="1"]');
  await section.locator('[data-overview-action="add-h1"]').click();
  const lastH1 = section
    .locator('.overview-block[data-overview-block-type="h1"]')
    .last()
    .locator('[data-field="block-content"]');
  await lastH1.click();
  await lastH1.evaluate((el) => {
    el.textContent = "额外页标题";
  });

  await page.locator("#deck-edit-save").click();
  await page.waitForTimeout(500);
  const afterSave = await page.evaluate(() => window.__matrixOverviewBlocks?.());
  expect((afterSave || []).some((b) => b.type === "h1" && /额外页标题/.test(b.html))).toBeTruthy();

  await page.reload();
  await page.waitForTimeout(300);
  await goOverview(page);

  const blocks = await page.evaluate(() => window.__matrixOverviewBlocks?.());
  const h1Blocks = (blocks || []).filter((b) => b.type === "h1");
  expect(h1Blocks.some((b) => /额外页标题/.test(b.html))).toBeTruthy();
});

test("overview body blocks use rich contenteditable in edit mode", async ({ page }) => {
  await page.goto("/template-tech.html");
  await goOverview(page);
  await enterEdit(page);

  const body = page
    .locator('[data-slide-index="1"] .overview-block[data-overview-block-type="body"]')
    .first()
    .locator('[data-field="block-content"]');
  await expect(body).toHaveAttribute("contenteditable", "true");
});
