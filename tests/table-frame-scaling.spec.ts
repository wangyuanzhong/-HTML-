import { expect, test, type Page } from "@playwright/test";

type FrameMetric = {
  width: number;
  height: number;
  ratio: number;
  overflowX: string;
  overflowY: string;
};

async function readFrameMetric(page: Page): Promise<FrameMetric> {
  return page.locator('[data-slide-index="2"] .table-scroll').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      width: rect.width,
      height: rect.height,
      ratio: rect.width / Math.max(rect.height, 1),
      overflowX: style.overflowX,
      overflowY: style.overflowY,
    };
  });
}

test("objective table frame keeps fixed ratio while viewport shrinks", async ({
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

  expect(large.width).toBeGreaterThan(medium.width);
  expect(medium.width).toBeGreaterThan(small.width);
  expect(large.height).toBeGreaterThan(medium.height);
  expect(medium.height).toBeGreaterThan(small.height);

  const maxRatioDelta = Math.max(
    Math.abs(large.ratio - medium.ratio),
    Math.abs(medium.ratio - small.ratio),
    Math.abs(large.ratio - small.ratio)
  );
  expect(maxRatioDelta).toBeLessThan(0.08);

  expect(["auto", "scroll"]).toContain(large.overflowX);
  expect(["auto", "scroll"]).toContain(large.overflowY);
});
