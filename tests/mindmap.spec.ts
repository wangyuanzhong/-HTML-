import { test, expect } from "@playwright/test";

async function openMindmapSlide(page: import("@playwright/test").Page) {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
  await expect(slide).toBeVisible({ timeout: 8000 });
  return slide;
}

async function enterMindmapEdit(page: import("@playwright/test").Page, slide: import("@playwright/test").Locator) {
  await slide.locator("[data-mindmap-enter-edit]").click();
  await expect(page.locator("body")).toHaveClass(/deck--editing/);
}

async function clickNodeCenter(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test.describe("mindmap slide", () => {
  test("canvas is much smaller than viewport; chrome stays put on zoom", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    const viewport = slide.locator("[data-mindmap-viewport]");
    const scaler = slide.locator("[data-mindmap-scaler]");
    const actions = slide.locator(".slide-actions");

    const vpBox = await viewport.boundingBox();
    const scBox = await scaler.boundingBox();
    expect(vpBox).not.toBeNull();
    expect(scBox).not.toBeNull();
    expect(scBox!.width).toBeLessThan(vpBox!.width * 0.55);

    await enterMindmapEdit(page, slide);
    const actBoxBefore = await actions.boundingBox();
    expect(actBoxBefore).not.toBeNull();
    await slide.locator('[data-mindmap-action="zoom-in"]').click({ force: true });
    await slide.locator('[data-mindmap-action="zoom-in"]').click({ force: true });

    const actBoxAfter = await actions.boundingBox();
    expect(actBoxAfter!.y).toBeCloseTo(actBoxBefore!.y, 0);
    expect(actBoxAfter!.x).toBeCloseTo(actBoxBefore!.x, 0);
  });

  test("small node and arrow link", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterMindmapEdit(page, slide);

    const hub = slide.locator(".mindmap-node--hub").first();
    const branch = slide.locator(".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)").first();
    await expect(branch).toBeVisible();

    await page.evaluate(() => {
      const sec = document.querySelector('section[data-page-type="mindmap"]');
      const hub = document.querySelector(".mindmap-node--hub .mindmap-node__label") as HTMLElement | null;
      const br = document.querySelector(
        ".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small) .mindmap-node__label"
      ) as HTMLElement | null;
      if (hub) hub.click();
      const MM = (window as Window & { MindmapDeck?: { setLinkPickFrom: (s: Element, id: string) => void } })
        .MindmapDeck;
      if (sec && hub && MM) {
        MM.setLinkPickFrom(sec, hub.closest("[data-node-id]")!.getAttribute("data-node-id") || "");
      }
      if (br) br.click();
    });
    await expect(slide.locator("path.mindmap-edge--link")).toHaveCount(1);

    await page.evaluate(() => {
      const sec = document.querySelector('section[data-page-type="mindmap"]');
      const hub = document.querySelector(".mindmap-node--hub");
      const MM = (window as Window & { MindmapDeck?: { setSelectedId: (s: Element, id: string) => void } })
        .MindmapDeck;
      if (sec && hub && MM) MM.setSelectedId(sec, hub.getAttribute("data-node-id") || "");
    });
    await slide.locator('[data-mindmap-action="add-small"]').click();
    const small = slide.locator(".mindmap-node--small");
    await expect(small).toHaveCount(1);
    await page.evaluate(() => {
      const sm = document.querySelector(
        'section[data-page-type="mindmap"] .mindmap-node--small .mindmap-node__label'
      ) as HTMLElement | null;
      if (sm) sm.click();
    });
    await slide.locator('[data-mindmap-action="remove-small"]').click();
    await expect(small).toHaveCount(0);
  });

  test("zoom only in edit; hidden after exit", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await expect(slide.locator(".mindmap-zoom")).toBeHidden();
    await enterMindmapEdit(page, slide);
    await expect(slide.locator(".mindmap-zoom")).toBeVisible();
    await page.locator("#deck-edit-exit").click();
    await expect(slide.locator(".mindmap-zoom")).toBeHidden();
  });
});
