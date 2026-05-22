import { test, expect } from "@playwright/test";

/** 演示稿已自动插入思维导图页（概述后，索引 2） */
async function openMindmapSlide(page: import("@playwright/test").Page) {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
  await expect(slide).toBeVisible({ timeout: 8000 });
  await expect(slide.locator(".mindmap-node--hub").first()).toBeVisible();
  return slide;
}

async function enterMindmapEdit(page: import("@playwright/test").Page, slide: import("@playwright/test").Locator) {
  await slide.locator("[data-mindmap-enter-edit]").click();
  await expect(page.locator("body")).toHaveClass(/deck--editing/);
}

test.describe("mindmap slide", () => {
  test("viewport has no boxed chrome — graph floats on slide", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    const viewport = slide.locator("[data-mindmap-viewport]");
    const bg = await viewport.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderWidth: s.borderWidth, backgroundColor: s.backgroundColor };
    });
    expect(bg.borderWidth).toBe("0px");
    expect(bg.backgroundColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  });

  test("+ 总节点 adds a second hub", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterMindmapEdit(page, slide);
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(1);
    await slide.locator('[data-mindmap-action="add-hub"]').click();
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(2);
  });

  test("drag moves node after entering edit mode", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterMindmapEdit(page, slide);
    const hub = slide.locator(".mindmap-node--hub").first();
    const grip = hub.locator(".mindmap-node__grip");
    const before = await hub.evaluate((el) => ({
      left: parseFloat((el as HTMLElement).style.left) || 0,
      top: parseFloat((el as HTMLElement).style.top) || 0,
    }));
    const box = await grip.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 80, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const after = await hub.evaluate((el) => ({
          left: parseFloat((el as HTMLElement).style.left) || 0,
          top: parseFloat((el as HTMLElement).style.top) || 0,
        }));
        return after.left - before.left + (after.top - before.top);
      })
      .toBeGreaterThan(50);
  });

  test("callout: add, line, delete; zoom only in edit and persists", async ({ page }) => {
    const slide = await openMindmapSlide(page);

    await expect(slide.locator(".mindmap-zoom")).toBeHidden();
    const stage = slide.locator("[data-mindmap-stage]");
    const transformBefore = await stage.evaluate((el) => (el as HTMLElement).style.transform);

    await enterMindmapEdit(page, slide);
    await expect(slide.locator(".mindmap-zoom")).toBeVisible();

    await slide.locator('[data-mindmap-action="zoom-in"]').click();
    await expect
      .poll(async () => stage.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(transformBefore);

    const branch = slide.locator(".mindmap-node").filter({ hasNot: slide.locator(".mindmap-node--hub") }).first();
    await branch.click();
    await slide.locator('[data-mindmap-action="add-callout"]').click();
    const callout = slide.locator(".mindmap-callout").first();
    await expect(callout).toBeVisible();
    await expect(slide.locator(".mindmap-edge--callout")).toHaveCount(1);

    await callout.click();
    await slide.locator('[data-mindmap-action="remove-callout"]').click();
    await expect(slide.locator(".mindmap-callout")).toHaveCount(0);

    const userZoomZoomed = await stage.evaluate(
      (el) => Number((el as HTMLElement).dataset.userZoom) || 1
    );
    expect(userZoomZoomed).toBeGreaterThan(1);

    await page.locator("#deck-edit-exit").click();
    await expect(page.locator("body")).not.toHaveClass(/deck--editing/);
    await expect(slide.locator(".mindmap-zoom")).toBeHidden();

    await expect(stage).toHaveAttribute("style", /transform/);
    const userZoomAfterExit = await stage.evaluate(
      (el) => Number((el as HTMLElement).dataset.userZoom) || 1
    );
    expect(userZoomAfterExit).toBe(userZoomZoomed);

    await expect(slide.locator("[data-mindmap-zoom-range]")).toBeHidden();
    const userZoomStill = await stage.evaluate(
      (el) => Number((el as HTMLElement).dataset.userZoom) || 1
    );
    expect(userZoomStill).toBe(userZoomZoomed);
  });
});
