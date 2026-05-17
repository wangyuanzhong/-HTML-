import { expect, test, type Page } from "@playwright/test";
import { revealDeckChrome } from "./deck-chrome";

/**
 * 回归这次重构的三条核心要求（用户反馈）：
 *
 *  1) 浏览器窗口变化时，整页内的所有尺寸 / 位置关系严格等比缩放（虚拟舞台 1440×900）。
 *  2) 矩阵表格的「外框」恒等于剩余空间，不随行数变长（不再无限撑高 / 把底栏挤出视口）。
 *  3) 表格内字号 / padding 根据可见行 × 列数动态变化，行少 → 字号大；行多 → 字号小且不出滚动条。
 */

async function gotoMatrix(page: Page) {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();
}

async function readStage(page: Page) {
  return page.evaluate(() => {
    const stage = document.getElementById("deck-stage")!;
    const rect = stage.getBoundingClientRect();
    const cs = getComputedStyle(stage);
    return {
      // CSS computed pixel width/height of the (unscaled) stage canvas
      cssW: parseFloat(cs.width),
      cssH: parseFloat(cs.height),
      // Rendered (transformed) bounding rect
      renderW: rect.width,
      renderH: rect.height,
      transform: cs.transform,
    };
  });
}

async function readTable(page: Page, sel = "#comparison-table") {
  return page.locator(sel).evaluate((t) => {
    const table = t as HTMLTableElement;
    const scroll = table.parentElement as HTMLElement;
    const cs = getComputedStyle(table);
    return {
      fontPx: parseFloat(cs.fontSize),
      scrollerW: scroll.clientWidth,
      scrollerH: scroll.clientHeight,
      tableW: table.getBoundingClientRect().width,
      tableH: table.getBoundingClientRect().height,
      tableScrollH: table.scrollHeight,
      tableScrollW: table.scrollWidth,
      tableClientH: table.clientHeight,
      tableClientW: table.clientWidth,
    };
  });
}

test("整页等比缩放：所有内部尺寸位置关系恒定 (浏览器尺寸变化只改 transform: scale)", async ({
  page,
}) => {
  await gotoMatrix(page);

  // 设计画布尺寸应当固定 (1440×900)，与窗口无关
  const sizes = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1100, height: 800 },
    { width: 1280, height: 540 },
    { width: 720, height: 1280 },
  ];

  const samples: { v: { width: number; height: number }; s: Awaited<ReturnType<typeof readStage>> }[] = [];
  for (const v of sizes) {
    await page.setViewportSize(v);
    await page.waitForTimeout(80);
    const s = await readStage(page);
    samples.push({ v, s });
  }

  for (const { s } of samples) {
    expect(s.cssW).toBe(1440);
    expect(s.cssH).toBe(900);
  }

  for (const { v, s } of samples) {
    const expected = Math.min(v.width / 1440, v.height / 900);
    const actualScaleW = s.renderW / 1440;
    const actualScaleH = s.renderH / 900;
    expect(actualScaleW).toBeCloseTo(expected, 2);
    expect(actualScaleH).toBeCloseTo(expected, 2);
    expect(s.renderW / s.renderH).toBeCloseTo(1440 / 900, 2);
  }
});

test("矩阵表外框：行/列再多也不会顶穿底栏；表外框尺寸不随内容变长", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/template-tech.html");

  // 进入编辑模式 → 跳到客观矩阵
  await revealDeckChrome(page);
  await page.locator("#deck-edit-enter").click();
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();

  const t0 = await readTable(page);

  // 加 25 行
  const addBtn = page.locator(
    'button[data-matrix-action="add-row"][data-matrix-structure="obj"]'
  );
  for (let i = 0; i < 25; i++) await addBtn.click();
  await page.waitForTimeout(200);

  const t1 = await readTable(page);

  // 表外框（scroller）的宽高基本不变（容差 1px，filter chip 换行可能微动）
  expect(Math.abs(t1.scrollerW - t0.scrollerW)).toBeLessThanOrEqual(1);

  // 没有内部滚动条：表格本身高度恰好等于 scroller，scrollH ≤ clientH+1
  expect(t1.tableScrollH).toBeLessThanOrEqual(t1.tableClientH + 1);
  expect(t1.tableScrollW).toBeLessThanOrEqual(t1.tableClientW + 1);

  // 底栏仍然贴在 stage 底部，没有被顶出视口
  const footerInside = await page
    .locator('[data-slide-index="2"] .matrix-slide-footer')
    .evaluate((f) => {
      const fr = f.getBoundingClientRect();
      return fr.bottom <= window.innerHeight + 1;
    });
  expect(footerInside).toBe(true);
});

test("表格内字号随可见行/列数动态变化：行少字大，行多字小", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/template-tech.html");

  // 初始（4 行 + 1 表头，4 列）
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();
  await page.waitForTimeout(150);
  const tInitial = await readTable(page);
  expect(tInitial.fontPx).toBeGreaterThan(20);

  // 隐藏两行 → 字号应当更大（或等于上限）
  await page.locator('#filter-deck label.filter-chip:has-text("端侧 AI")').click();
  await page.locator('#filter-deck label.filter-chip:has-text("生态联动")').click();
  await page.waitForTimeout(200);
  const tFewer = await readTable(page);
  expect(tFewer.fontPx).toBeGreaterThanOrEqual(tInitial.fontPx);

  // 恢复 + 进入编辑模式加 20 行 → 字号必须显著变小
  await page.locator('#filter-deck label.filter-chip:has-text("端侧 AI")').click();
  await page.locator('#filter-deck label.filter-chip:has-text("生态联动")').click();
  await page.locator('[data-slide-dot="0"]').click();
  await revealDeckChrome(page);
  await page.locator("#deck-edit-enter").click();
  await page.locator('[data-slide-dot="2"]').click();
  await page.waitForTimeout(120);

  const addBtn = page.locator(
    'button[data-matrix-action="add-row"][data-matrix-structure="obj"]'
  );
  for (let i = 0; i < 20; i++) await addBtn.click();
  await page.waitForTimeout(250);
  const tDense = await readTable(page);
  expect(tDense.fontPx).toBeLessThan(tInitial.fontPx);
  expect(tDense.fontPx).toBeGreaterThanOrEqual(8); // 下限
});

test("浏览器缩放不应该改变表格内字号（字号只对 rows×cols 响应）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  await page.waitForTimeout(150);
  const a = await readTable(page);

  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(150);
  const b = await readTable(page);

  // CSS 字号是 unscaled 设计像素，整页 transform: scale 不会改变 fontPx 计算
  expect(b.fontPx).toBeCloseTo(a.fontPx, 1);

  // 表格内部布局（unscaled 尺寸）也保持不变
  expect(b.tableClientW).toBeCloseTo(a.tableClientW, 0);
});
