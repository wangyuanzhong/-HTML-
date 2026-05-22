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

  test("IndexedDB snapshot without mindmap still gets mindmap slide after reload", async ({
    page,
  }) => {
    await page.goto("/template-tech.html");
    await page.waitForSelector("#deck-stage");

    await page.evaluate(async () => {
      const dbName = "matrix-cell-detail-uploads";
      const store = "deckPatch";
      const key = "deck-pages-v1";
      const snap = {
        v: 2,
        theme: "tech",
        pages: [
          {
            id: "snap_cover",
            type: "cover",
            data: { eyebrow: "测试", title: "快照封面", subtitle: "" },
          },
          {
            id: "snap_overview",
            type: "overview",
            data: { title: "概述", sections: [] },
          },
          {
            id: "snap_table",
            type: "table",
            data: {
              title: "矩阵",
              matrix: { cornerLabel: "", rows: [], columns: [], cells: {} },
            },
          },
          {
            id: "snap_ending",
            type: "ending",
            data: { eyebrow: "", title: "结束", bodyHtml: "<p>完</p>" },
          },
        ],
      };
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, 2);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(snap, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.reload();
    await page.locator('[data-slide-dot="2"]').click();
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    await expect(slide).toBeVisible({ timeout: 8000 });
    await expect(slide.locator("[data-mindmap-enter-edit]")).toBeVisible();
  });

  test("zoom controls change stage scale without edit mode", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    const stage = slide.locator("[data-mindmap-stage]");
    const before = await stage.evaluate((el) => (el as HTMLElement).style.transform);
    await slide.locator('[data-mindmap-action="zoom-in"]').click();
    await expect
      .poll(async () => stage.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(before);
    const zoomVal = await slide.locator("[data-mindmap-zoom-range]").inputValue();
    expect(Number(zoomVal)).toBeGreaterThan(100);
  });
});
