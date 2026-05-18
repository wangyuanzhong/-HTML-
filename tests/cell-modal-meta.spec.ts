import { expect, test, type Page } from "@playwright/test";

async function enterMatrixEdit(page: Page) {
  await page.locator('[data-slide-dot="0"]').click();
  await expect(page.locator('[data-slide-index="0"]')).toBeVisible();
  await page.locator("#deck-chrome-hover-target").hover();
  await page.waitForTimeout(60);
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body.deck--editing")).toBeVisible();
}

test("cell detail modal title syncs from thead and persists axis edits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/template-tech.html");
  await enterMatrixEdit(page);
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();

  const cell = page.locator("#comparison-table tbody .matrix-cell").first();
  const colId = await cell.getAttribute("data-col-id");
  expect(colId).toBeTruthy();
  const colTh = page.locator(
    `#comparison-table thead th[data-col-id="${colId}"]`
  );
  const rowHead = page
    .locator("#comparison-table tbody tr")
    .first()
    .locator(".matrix-row-head");

  await cell.dblclick();
  const modal = page.locator("#cell-modal");
  await expect(modal).not.toHaveAttribute("hidden", "");

  const meta = page.locator("#modal-meta");
  await expect(meta).toHaveAttribute("contenteditable", /true|plaintext-only/);

  const uniq = `列_${Date.now().toString(36)}`;
  await colTh.evaluate((el, text) => {
    el.textContent = String(text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, uniq);
  await expect(meta).toContainText(uniq);

  await meta.click();
  await meta.fill("行A试 × " + uniq);

  await page.locator("#modal-close").click();
  await expect(modal).toHaveAttribute("hidden", "");

  await expect(rowHead).toContainText("行A试");
  await expect(colTh).toContainText(uniq);

  expect(errors, `pageerror: ${errors.join("; ")}`).toEqual([]);
});
