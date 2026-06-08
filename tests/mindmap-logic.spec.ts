import { test, expect } from "@playwright/test";

async function openMindmapSlide(page: import("@playwright/test").Page) {
  await page.goto("/template-tech.html");
  await page.locator('[data-slide-dot="2"]').click();
  const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
  await expect(slide).toBeVisible({ timeout: 8000 });
  return slide;
}

async function enterDeckEdit(page: import("@playwright/test").Page) {
  await page.locator("#deck-edit-enter").click();
  await expect(page.locator("body")).toHaveClass(/deck--editing/);
}

type MindmapCounts = {
  hub: number;
  branch: number;
  small: number;
  link: number;
  childCount: number;
};

async function countMindmapNodes(page: import("@playwright/test").Page): Promise<MindmapCounts> {
  return page.evaluate(() => {
    const sec = document.querySelector('section[data-page-type="mindmap"]');
    const pid = sec?.getAttribute("data-page-id") || "";
    const api = (window as Window & {
      __matrixMindmapCounts?: (id: string) => MindmapCounts | null;
    }).__matrixMindmapCounts;
    const data = api ? api(pid) : null;
    const dom = {
      hub: document.querySelectorAll('section[data-page-type="mindmap"] .mindmap-node--hub').length,
      branch: document.querySelectorAll(
        'section[data-page-type="mindmap"] .mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)'
      ).length,
      small: document.querySelectorAll('section[data-page-type="mindmap"] .mindmap-node--small').length,
      link: document.querySelectorAll('section[data-page-type="mindmap"] path.mindmap-edge--link').length,
    };
    if (!data) {
      return { ...dom, childCount: 0 };
    }
    return {
      hub: data.hub,
      branch: data.branch,
      small: data.small,
      link: data.link,
      childCount: data.hubChildren,
    };
  });
}

async function clickBranch(page: import("@playwright/test").Page, index: number) {
  const node = page.locator(
    'section[data-page-type="mindmap"] .mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)'
  );
  await node.nth(index).click();
  await expect(node.nth(index)).toHaveClass(/is-selected/);
}

async function clickHub(page: import("@playwright/test").Page) {
  const hub = page.locator('section[data-page-type="mindmap"] .mindmap-node--hub').first();
  await hub.click();
  await expect(hub).toHaveClass(/is-selected/);
}

test.describe("mindmap logic (selection, add, delete)", () => {
  test.beforeEach(async ({ page }) => {
    await openMindmapSlide(page);
    await enterDeckEdit(page);
  });

  test("add branch on child keeps siblings and increases branch count", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    const before = await countMindmapNodes(page);
    expect(before.branch).toBeGreaterThanOrEqual(2);

    await clickBranch(page, 0);
    const hubChildrenBefore = (await countMindmapNodes(page)).childCount;
    await slide.locator('[data-mindmap-action="add-branch"]').click();

    const after = await countMindmapNodes(page);
    expect(after.branch).toBe(before.branch + 1);
    expect(after.hub).toBe(before.hub);
    expect(after.childCount).toBe(hubChildrenBefore);

    await expect(
      page.locator('section[data-page-type="mindmap"] .mindmap-node__label:text-is("新分支")')
    ).toHaveCount(1);
  });

  test("add small node does not remove tree branches", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    const before = await countMindmapNodes(page);

    await clickHub(page);
    await slide.locator('[data-mindmap-action="add-small"]').click();

    const withSmall = await countMindmapNodes(page);
    expect(withSmall.small).toBe(before.small + 1);
    expect(withSmall.branch).toBe(before.branch);
    expect(withSmall.hub).toBe(before.hub);
    expect(withSmall.childCount).toBe(before.childCount);
  });

  test("delete one of two small nodes leaves exactly one", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');

    await clickHub(page);
    await slide.locator('[data-mindmap-action="add-small"]').click();
    await clickHub(page);
    await slide.locator('[data-mindmap-action="add-small"]').click();

    const two = await countMindmapNodes(page);
    expect(two.small).toBe(2);

    await page.locator('section[data-page-type="mindmap"] .mindmap-node--small').nth(1).click();
    await slide.locator('[data-mindmap-action="remove-selection"]').click();

    const one = await countMindmapNodes(page);
    expect(one.small).toBe(1);
    expect(one.branch).toBe(two.branch);
    expect(one.hub).toBe(two.hub);
  });

  test("delete branch removes only selected node", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');

    await clickBranch(page, 0);
    await slide.locator('[data-mindmap-action="add-branch"]').click();

    const before = await countMindmapNodes(page);
    const newBranch = page.locator(
      'section[data-page-type="mindmap"] .mindmap-node:has(.mindmap-node__label:text-is("新分支"))'
    );
    await expect(newBranch).toHaveCount(1);
    await newBranch.click();
    await slide.locator('[data-mindmap-action="remove-selection"]').click();

    const after = await countMindmapNodes(page);
    expect(after.branch).toBe(before.branch - 1);
    expect(after.hub).toBe(before.hub);
    await expect(newBranch).toHaveCount(0);
  });

  test("delete small with link only removes small and link", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');

    await clickHub(page);
    await slide.locator('[data-mindmap-action="add-small"]').click();

    await slide.locator('[data-mindmap-action="add-link"]').click();
    await page.locator(".mindmap-node--hub .mindmap-node__label").click();
    await page.locator(".mindmap-node--small .mindmap-node__label").click();
    await page.locator('section[data-page-type="mindmap"] .mindmap-node--small').click();

    const linked = await countMindmapNodes(page);
    expect(linked.small).toBe(1);
    expect(linked.link).toBeGreaterThanOrEqual(0);

    await slide.locator('[data-mindmap-action="remove-selection"]').click();

    const after = await countMindmapNodes(page);
    expect(after.small).toBe(0);
    expect(after.branch).toBe(linked.branch);
    expect(after.hub).toBe(linked.hub);
    expect(after.link).toBe(0);
  });

  test("removeChild with wrong id must not pop sibling (core API)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const MM = (window as Window & {
        MindmapDeck?: {
          defaultPageData: () => { roots: { id: string; children: { id: string }[] }[] };
          removeChild: (d: unknown, pid: string, cid: string) => boolean;
        };
      }).MindmapDeck;
      if (!MM) return { ok: false, reason: "no MM" };
      const data = MM.defaultPageData();
      const hub = data.roots[0];
      const childA = hub.children[0];
      const childB = hub.children[1];
      const before = hub.children.length;
      const bad = MM.removeChild(data, hub.id, "__no_such_child__");
      const after = hub.children.length;
      const ids = hub.children.map((c) => c.id);
      return {
        ok: !bad && after === before && ids.includes(childA.id) && ids.includes(childB.id),
        bad,
        before,
        after,
      };
    });
    expect(result.ok).toBe(true);
  });

  test("add branch on hub adds direct child under hub", async ({ page }) => {
    const slide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    const before = await countMindmapNodes(page);

    await clickHub(page);
    await slide.locator('[data-mindmap-action="add-branch"]').click();

    const after = await countMindmapNodes(page);
    expect(after.branch).toBe(before.branch + 1);
    expect(after.childCount).toBe(before.childCount + 1);
  });
});
