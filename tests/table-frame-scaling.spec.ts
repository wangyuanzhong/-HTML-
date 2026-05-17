import { expect, test, type Page } from "@playwright/test";

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

  expect(large.leftDelta).toBeLessThan(1.5);
  expect(medium.leftDelta).toBeLessThan(1.5);
  expect(small.leftDelta).toBeLessThan(1.5);
  expect(large.rightDelta).toBeLessThan(1.5);
  expect(medium.rightDelta).toBeLessThan(1.5);
  expect(small.rightDelta).toBeLessThan(1.5);

  expect(large.footerInside).toBeTruthy();
  expect(medium.footerInside).toBeTruthy();
  expect(small.footerInside).toBeTruthy();
  expect(large.slideOverflowing).toBeFalsy();
  expect(medium.slideOverflowing).toBeFalsy();
  expect(small.slideOverflowing).toBeFalsy();

  expect(large.slideWidth).toBeGreaterThan(medium.slideWidth);
  expect(medium.slideWidth).toBeGreaterThan(small.slideWidth);
  expect(large.width).toBeGreaterThan(medium.width);
  expect(medium.width).toBeGreaterThan(small.width);
  expect(large.height).toBeGreaterThan(medium.height);
  expect(medium.height).toBeGreaterThan(small.height);
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
