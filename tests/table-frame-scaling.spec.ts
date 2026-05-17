import { expect, test, type Page } from "@playwright/test";

/** 与 deck-stage-fit 一致：顶栏收起时需先悬停感应带再点「进入编辑模式」 */
async function revealDeckChrome(page: Page) {
  await page.locator("#deck-chrome-hover-target").hover();
  await page.waitForTimeout(60);
}

type FrameMetric = {
  slideWidth: number;
  width: number;
  height: number;
  leftDelta: number;
  rightDelta: number;
  footerInside: boolean;
  slideOverflowing: boolean;
};

async function readFrameMetric(page: Page): Promise<FrameMetric> {
  return page.locator('[data-slide-index="2"] .slide-inner').evaluate((slide) => {
    const table = slide.querySelector(".table-scroll");
    const footer = slide.querySelector(".matrix-slide-footer");
    if (!(table instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
      throw new Error("matrix structure missing");
    }
    const slideRect = slide.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      slideWidth: slideRect.width,
      width: tableRect.width,
      height: tableRect.height,
      leftDelta: Math.abs(tableRect.left - slideRect.left),
      rightDelta: Math.abs(tableRect.right - slideRect.right),
      footerInside: footerRect.bottom <= slideRect.bottom + 1,
      slideOverflowing: slide.scrollHeight > slide.clientHeight + 1,
    };
  });
}

test("matrix table aligns with page controls and footer stays in-frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 900 });
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();

  const large = await readFrameMetric(page);
  await page.setViewportSize({ width: 1240, height: 760 });
  const medium = await readFrameMetric(page);
  await page.setViewportSize({ width: 980, height: 620 });
  const small = await readFrameMetric(page);
  await page.setViewportSize({ width: 860, height: 540 });
  const tiny = await readFrameMetric(page);

  expect(large.leftDelta).toBeLessThan(1.5);
  expect(medium.leftDelta).toBeLessThan(1.5);
  expect(small.leftDelta).toBeLessThan(1.5);
  expect(large.rightDelta).toBeLessThan(1.5);
  expect(medium.rightDelta).toBeLessThan(1.5);
  expect(small.rightDelta).toBeLessThan(1.5);

  expect(large.footerInside).toBeTruthy();
  expect(medium.footerInside).toBeTruthy();
  expect(small.footerInside).toBeTruthy();
  expect(tiny.footerInside).toBeTruthy();
  expect(large.slideOverflowing).toBeFalsy();
  expect(medium.slideOverflowing).toBeFalsy();
  expect(small.slideOverflowing).toBeFalsy();
  expect(tiny.slideOverflowing).toBeFalsy();

  expect(large.slideWidth).toBeGreaterThanOrEqual(medium.slideWidth);
  expect(medium.slideWidth).toBeGreaterThanOrEqual(small.slideWidth);
  expect(small.slideWidth).toBeGreaterThanOrEqual(tiny.slideWidth);
  expect(large.slideWidth).toBeGreaterThan(small.slideWidth);
  expect(large.width).toBeGreaterThanOrEqual(medium.width);
  expect(medium.width).toBeGreaterThanOrEqual(small.width);
  expect(small.width).toBeGreaterThanOrEqual(tiny.width);
  expect(large.width).toBeGreaterThan(small.width);
  expect(large.height).toBeGreaterThan(medium.height);
  expect(medium.height).toBeGreaterThan(small.height);
});

async function openMatrixSlide(page: Page) {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();
}

async function enterMatrixEdit(page: Page) {
  await revealDeckChrome(page);
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body.deck--editing")).toBeVisible();
}

test("matrix uses scroll mode when data rows exceed 7", async ({ page }) => {
  await openMatrixSlide(page);
  await enterMatrixEdit(page);
  const addRow = page.locator('[data-matrix-action="add-row"]').first();
  for (let i = 0; i < 5; i += 1) {
    await addRow.click();
  }
  const scroll = page.locator('[data-slide-index="2"] .table-scroll--overflow');
  await expect(scroll).toBeVisible({ timeout: 5000 });
  await expect(
    page.locator('[data-slide-index="2"] #comparison-table.comparison-table--scroll-mode')
  ).toBeVisible();
  await expect
    .poll(async () =>
      scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 2)
    )
    .toBeTruthy();
  await expect
    .poll(async () =>
      page.locator('[data-slide-index="2"] #comparison-table tbody tr').first().evaluate((tr) => {
        const h = tr.getBoundingClientRect().height;
        return h > 20;
      })
    )
    .toBeTruthy();
});

test("matrix uses scroll mode when product columns exceed 5", async ({ page }) => {
  await openMatrixSlide(page);
  await enterMatrixEdit(page);
  const addCol = page.locator('[data-matrix-action="add-col"]').first();
  for (let i = 0; i < 3; i += 1) {
    await addCol.click();
  }
  const scroll = page.locator('[data-slide-index="2"] .table-scroll--overflow');
  await expect(scroll).toBeVisible({ timeout: 5000 });
  await expect(
    page.locator('[data-slide-index="2"] #comparison-table.comparison-table--scroll-cols')
  ).toBeVisible();
  await expect
    .poll(async () =>
      scroll.evaluate((el) => el.scrollWidth > el.clientWidth + 2)
    )
    .toBeTruthy();
});

test("row overflow keeps table viewport width stable", async ({ page }) => {
  await openMatrixSlide(page);
  const scroll = page.locator('[data-slide-index="2"] .table-scroll');
  const widthBefore = await scroll.evaluate((el) => el.clientWidth);
  await enterMatrixEdit(page);
  const addRow = page.locator('[data-matrix-action="add-row"]').first();
  for (let i = 0; i < 5; i += 1) {
    await addRow.click();
  }
  await expect(
    page.locator('[data-slide-index="2"] .comparison-table--scroll-rows')
  ).toBeVisible({ timeout: 5000 });
  // 与 deck-stage-fit 一致：内层纵向滚动条出现时 clientWidth 可能减少 ~ scrollbar 宽度
  await expect
    .poll(async () =>
      scroll.evaluate(
        (el, w) => Math.abs(el.clientWidth - Number(w)) <= 17,
        widthBefore
      )
    )
    .toBeTruthy();
});

test("matrix stays in fit mode within 7 rows and 5 columns", async ({ page }) => {
  await openMatrixSlide(page);
  await expect(
    page.locator('[data-slide-index="2"] .table-scroll--overflow')
  ).toHaveCount(0);
});

test("minimal theme table appears on background without framed underlay", async ({
  page,
}) => {
  await page.goto("/template-minimal.html");
  await page.locator('[data-slide-dot="2"]').click();
  await expect(page.locator('[data-slide-index="2"]')).toBeVisible();
  const style = await page.locator('[data-slide-index="2"] .table-scroll').evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow,
    };
  });
  expect(style.borderTopWidth).toBe("0px");
  expect(style.borderTopStyle).toBe("none");
  expect(style.borderRadius).toBe("0px");
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(style.boxShadow).toBe("none");
});
