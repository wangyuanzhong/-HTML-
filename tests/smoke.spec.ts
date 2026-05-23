import { test, expect } from "@playwright/test";

const templates = [
  "template-tech.html",
  "template-macaron.html",
  "template-minimal.html",
] as const;

for (const file of templates) {
  test.describe(file, () => {
    test("deck shell and scripts mount", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`/${file}`);
      await expect(page.locator("#deck-stage")).toBeVisible();
      await expect(page.locator("#slide-nav")).toBeVisible();
      await expect(page.locator("#cover-title")).not.toBeEmpty();
      await expect(page).toHaveTitle(/.+/);

      expect(errors, `pageerror: ${errors.join("; ")}`).toEqual([]);
    });

    test("slide navigation: overview then objective matrix", async ({
      page,
    }) => {
      await page.goto(`/${file}`);
      await page.locator('[data-slide-index="0"] [data-slide-go="1"]').click();
      await expect(page.locator('[data-slide-index="1"]')).toBeVisible();
      await expect(page.locator("#overview-sections")).toBeVisible();

      // 索引 2 为自动插入的思维导图页，客观矩阵在索引 3
      await page.locator('[data-slide-dot="3"]').click();
      await expect(page.locator('[data-slide-index="3"]')).toBeVisible();
      await expect(page.locator("#filter-deck")).toBeVisible();
    });
  });
}

test("V0.2 ignores legacy saved snapshots", async ({ page }) => {
  await page.goto("/template-tech.html");
  await page.evaluate(async () => {
    const oldSnapshot = {
      v: 2,
      theme: "tech",
      pages: [
        {
          id: "old_cover",
          type: "cover",
          data: { eyebrow: "旧标签", title: "旧标题", subtitle: "<p>旧内容</p>" },
        },
        {
          id: "old_mind",
          type: "mindmap",
          data: {
            title: "旧思维导图",
            zoom: 1,
            roots: [{ id: "old_root", label: "旧总分支", fx: null, fy: null, children: [] }],
            smallNodes: [],
            links: [],
          },
        },
      ],
    };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("matrix-cell-detail-uploads", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("deckPatch")) db.createObjectStore("deckPatch");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("deckPatch", "readwrite");
        tx.objectStore("deckPatch").put(oldSnapshot, "deck-pages-v1");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.reload();
  await expect(page.locator('section[data-slide-index="0"] .cover-title')).toContainText("总标题");
  await page.locator('[data-slide-dot="2"]').click();
  const mindmap = page.locator('section[data-page-type="mindmap"]:not([hidden])');
  await expect(mindmap.locator(".mindmap-node__label", { hasText: "总分支" })).toBeVisible();
  await expect(mindmap.locator(".mindmap-node__label", { hasText: "旧总分支" })).toHaveCount(0);
});
