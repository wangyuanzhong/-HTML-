import { expect, test, type Page } from "@playwright/test";

async function enterMatrixEdit(page: Page) {
  await page.locator('[data-slide-dot="0"]').click();
  await expect(page.locator('[data-slide-index="0"]')).toBeVisible();
  await page.locator("#deck-chrome-hover-target").hover();
  await page.waitForTimeout(60);
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body.deck--editing")).toBeVisible();
}

test("参数行筛选标签随左侧行标题改名而更新", async ({ page }) => {
  await page.goto("/template-tech.html");
  await enterMatrixEdit(page);
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();

  const rowHead = page
    .locator("#comparison-table tbody tr")
    .first()
    .locator(".matrix-row-head");
  const chipSpan = page.locator("#filter-rows label.filter-chip").first().locator("span");

  const uniq = `行名_${Date.now().toString(36)}`;
  await rowHead.evaluate((el, text) => {
    el.textContent = String(text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, uniq);

  await expect(chipSpan).toHaveText(uniq);
});
