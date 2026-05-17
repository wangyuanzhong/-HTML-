import { expect, test, type Page } from "@playwright/test";

async function gotoSlide(page: Page, idx: 2 | 3) {
  await page.locator(`[data-slide-dot="${idx}"]`).click();
  await expect(page.locator(`[data-slide-index="${idx}"]`)).toBeVisible();
}

async function setEditMode(page: Page, enabled: boolean) {
  const isEditing = await page.evaluate(() =>
    document.body.classList.contains("deck--editing")
  );
  if (enabled && !isEditing) {
    await page.locator('[data-slide-dot="0"]').click();
    await expect(page.locator('[data-slide-index="0"]')).toBeVisible();
    await page.locator("#deck-chrome-hover-target").hover();
    await page.waitForTimeout(60);
    await page.locator("#deck-edit-enter").click();
  } else if (!enabled && isEditing) {
    await page.locator('[data-slide-dot="0"]').click();
    await expect(page.locator('[data-slide-index="0"]')).toBeVisible();
    await page.locator("#deck-edit-exit").click();
  }
}

async function runCompareFlowScenario(
  page: Page,
  opts: {
    slide: 2 | 3;
    editMode: boolean;
    scrollTop: number;
    rowClickY: number;
  }
) {
  const tableId = opts.slide === 2 ? "#comparison-table" : "#comparison-table-sub";
  const slideRoot = `[data-slide-index="${opts.slide}"]`;
  await setEditMode(page, opts.editMode);
  await gotoSlide(page, opts.slide);

  await page.locator("#compare-launch-btn").click();
  await expect(page.locator("#compare-launch-btn")).toHaveText("生成对比报告");

  await page.locator(`${slideRoot} .table-scroll`).evaluate((el, top) => {
    el.scrollTop = Number(top) || 0;
  }, opts.scrollTop);

  const row = page.locator(`${tableId} tbody th.matrix-row-head`).first();
  const col = page.locator(`${tableId} thead th[data-col-id]`).first();

  await row.click({ position: { x: 20, y: opts.rowClickY }, force: true });
  await expect(row).toHaveClass(/is-cp-selected/);

  await col.click({ position: { x: 20, y: 14 }, force: true });
  await expect(col).toHaveClass(/is-cp-selected/);
  await expect(page.locator("#compare-launch-btn")).toHaveClass(
    /compare-fab__main--armed/
  );

  await page.locator("#compare-launch-btn").click();
  await expect(page.locator("#compare-report-modal")).not.toHaveAttribute(
    "hidden",
    ""
  );
  await page.locator("#compare-report-close").click();
  await expect(page.locator("#compare-report-modal")).toHaveAttribute("hidden", "");
}

test("detail compare remains stable across mode toggles and rerenders", async ({
  page,
}) => {
  await page.goto("/template-tech.html");

  const scenarios: Array<{
    slide: 2 | 3;
    editMode: boolean;
    scrollTop: number;
    rowClickY: number;
  }> = [
    { slide: 2, editMode: false, scrollTop: 0, rowClickY: 14 },
    { slide: 2, editMode: true, scrollTop: 0, rowClickY: 14 },
    { slide: 2, editMode: false, scrollTop: 0, rowClickY: 14 },
    { slide: 2, editMode: false, scrollTop: 110, rowClickY: 2 },
    { slide: 2, editMode: true, scrollTop: 110, rowClickY: 2 },
    { slide: 3, editMode: false, scrollTop: 0, rowClickY: 14 },
    { slide: 3, editMode: true, scrollTop: 0, rowClickY: 14 },
  ];

  for (const scenario of scenarios) {
    await runCompareFlowScenario(page, scenario);
  }
});
