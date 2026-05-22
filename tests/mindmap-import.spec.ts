import { test, expect } from "@playwright/test";

/** roots 写在 page 顶层（无 page.data）——旧版/手写 JSON 常见 */
const IMPORT_JSON_ROOTS_ON_PAGE = {
  theme: "tech",
  pages: [
    {
      id: "p_cover",
      type: "cover",
      data: { eyebrow: "T", title: "封面", subtitle: "" },
    },
    {
      id: "p_overview",
      type: "overview",
      data: { title: "概述", sections: [] },
    },
    {
      id: "p_mind",
      type: "mindmap",
      title: "导入的思维导图",
      zoom: 1,
      roots: [
        {
          id: "hub_import",
          label: "导入中心",
          fx: null,
          fy: null,
          children: [
            { id: "br_a", label: "分支A", fx: null, fy: null, children: [] },
            { id: "br_b", label: "分支B", fx: null, fy: null, children: [] },
          ],
        },
      ],
      smallNodes: [],
      links: [],
    },
    {
      id: "p_end",
      type: "ending",
      data: { eyebrow: "", title: "结束", bodyHtml: "<p>完</p>" },
    },
  ],
};

test.describe("mindmap JSON import", () => {
  test("roots on page level (not page.data) still render after import", async ({ page }) => {
    await page.goto("/template-tech.html");
    await page.evaluate((deckJson) => {
      const blob = new Blob([JSON.stringify(deckJson)], { type: "application/json" });
      const file = new File([blob], "import-test.json", { type: "application/json" });
      const input = document.getElementById(
        "deck-portable-import-file"
      ) as HTMLInputElement | null;
      if (!input) throw new Error("missing #deck-portable-import-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, IMPORT_JSON_ROOTS_ON_PAGE);

    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    await expect(slide).toBeVisible({ timeout: 10000 });
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(1, { timeout: 10000 });
    await expect(slide.locator(".mindmap-node__label", { hasText: "导入中心" })).toBeVisible();
    await expect(slide.locator(".mindmap-node__label", { hasText: "分支A" })).toBeVisible();
    await page.waitForTimeout(500);
    const nodeCount = await slide.locator(".mindmap-node").count();
    expect(nodeCount).toBeGreaterThanOrEqual(3);
    const transform = await slide
      .locator("[data-mindmap-stage]")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe("none");
  });
});
