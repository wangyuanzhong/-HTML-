import { expect, test, type Page } from "@playwright/test";

async function enterEdit(page: Page) {
  await page.locator("#deck-chrome-hover-target").hover();
  await page.waitForTimeout(60);
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body.deck--editing")).toBeVisible();
}

test("详细对比按钮在矩阵页可见", async ({ page }) => {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  const btn = page.locator("#compare-launch-btn");
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box && box.height).toBeGreaterThan(8);
});

test("详细对比按钮在复制矩阵页重新渲染后仍存在", async ({ page }) => {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  await enterEdit(page);
  await page.locator('[data-page-action="duplicate"]').click();
  await page.locator('[data-slide-dot="2"]').click();
  const btn = page.locator("#compare-launch-btn");
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box && box.height).toBeGreaterThan(8);
});
