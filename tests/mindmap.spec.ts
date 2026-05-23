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

async function dragMindmapNodeBy(
  page: import("@playwright/test").Page,
  node: import("@playwright/test").Locator,
  dx: number,
  dy: number
) {
  await expect(node).toBeVisible();
  const before = await nodePosition(node);
  const grip = node.locator(".mindmap-node__grip");
  await expect(grip).toBeVisible();
  const box = (await grip.boundingBox()) || (await node.boundingBox());
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  if (JSON.stringify(await nodePosition(node)) === JSON.stringify(before)) {
    const nodeBox = await node.boundingBox();
    expect(nodeBox).not.toBeNull();
    await page.mouse.move(nodeBox!.x + 8, nodeBox!.y + nodeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(nodeBox!.x + 8 + dx, nodeBox!.y + nodeBox!.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  }
  await expect.poll(() => nodePosition(node)).not.toEqual(before);
}

async function nodePosition(node: import("@playwright/test").Locator) {
  return node.evaluate((el) => ({
    left: (el as HTMLElement).style.left,
    top: (el as HTMLElement).style.top,
  }));
}

async function selectedMindmapNode(page: import("@playwright/test").Page) {
  const id = await page
    .locator('section[data-page-type="mindmap"]:not([hidden])')
    .getAttribute("data-mindmap-selected");
  expect(id).toBeTruthy();
  return page.locator(`section[data-page-type="mindmap"]:not([hidden]) .mindmap-node[data-node-id="${id}"]`);
}

test.describe("mindmap slide", () => {
  test("canvas is much smaller than viewport; chrome stays put on zoom", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    const viewport = slide.locator("[data-mindmap-viewport]");
    const scaler = slide.locator("[data-mindmap-stage]");
    const actions = slide.locator(".slide-actions");

    const vpBox = await viewport.boundingBox();
    const scBox = await scaler.boundingBox();
    expect(vpBox).not.toBeNull();
    expect(scBox).not.toBeNull();
    expect(scBox!.width).toBeLessThan(vpBox!.width * 0.92);

    await enterDeckEdit(page);
    const actBoxBefore = await actions.boundingBox();
    expect(actBoxBefore).not.toBeNull();
    await slide.locator('[data-mindmap-action="zoom-in"]').click();
    await slide.locator('[data-mindmap-action="zoom-in"]').click();

    const actBoxAfter = await actions.boundingBox();
    expect(actBoxAfter!.y).toBeCloseTo(actBoxBefore!.y, 0);
    expect(actBoxAfter!.x).toBeCloseTo(actBoxBefore!.x, 0);
  });

  test("structure tools work in deck edit mode", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    const hubsBefore = await slide.locator(".mindmap-node--hub").count();
    await enterDeckEdit(page);
    await expect(slide.locator(".mindmap-toolbar")).toBeVisible();
    await slide.locator('[data-mindmap-action="add-hub"]').click();
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(hubsBefore + 1);
  });

  test("small node and arrow link", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);

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
    await slide.locator('[data-mindmap-action="remove-selection"]').click();
    await expect(small).toHaveCount(0);
  });

  test("unified delete removes added hub", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    const hubsBefore = await slide.locator(".mindmap-node--hub").count();
    await slide.locator('[data-mindmap-action="add-hub"]').click();
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(hubsBefore + 1);
    await slide.locator('[data-mindmap-action="remove-selection"]').click();
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(hubsBefore);
  });

  test("mindmap stays visible after save (nodes + viewport transform)", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    const hubsBefore = await slide.locator(".mindmap-node--hub").count();
    await slide.locator('[data-mindmap-action="add-hub"]').click();
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(hubsBefore + 1);
    await page.locator("#deck-edit-save").click();
    await page.waitForTimeout(450);
    await expect(slide.locator(".mindmap-node--hub")).toHaveCount(hubsBefore + 1);
    const scaler = slide.locator("[data-mindmap-stage]");
    await expect(scaler).toHaveCSS("transform", /matrix/);
  });

  test("mindmap visible after exit edit (presentation mode)", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    await expect(slide.locator(".mindmap-node--hub").first()).toBeVisible();
    await page.locator("#deck-edit-exit").click();
    await expect(page.locator("body")).not.toHaveClass(/deck--editing/);
    await page.waitForTimeout(300);
    await expect(slide.locator(".mindmap-node--hub").first()).toBeVisible();
    await expect(slide.locator("[data-mindmap-stage]")).toHaveCSS("transform", /matrix/);
  });

  test("saved mindmap edits remain after exiting edit mode", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    const branches = slide.locator(".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)");
    const smallNodes = slide.locator(".mindmap-node--small");
    const branchesBefore = await branches.count();
    const smallBefore = await smallNodes.count();

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-branch"]').click();
    await expect(branches).toHaveCount(branchesBefore + 1);

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-small"]').click();
    await expect(smallNodes).toHaveCount(smallBefore + 1);

    await page.locator("#deck-edit-save").click();
    await page.locator("#deck-edit-exit").click();

    await expect(page.locator("body")).not.toHaveClass(/deck--editing/);
    await expect(branches).toHaveCount(branchesBefore + 1);
    await expect(smallNodes).toHaveCount(smallBefore + 1);
    await expect(slide.locator(".mindmap-toolbar")).toBeHidden();

    await page.waitForTimeout(250);
    await page.reload();
    await page.locator('[data-slide-dot="2"]').click();
    const restoredSlide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    await expect(restoredSlide.locator(".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)")).toHaveCount(
      branchesBefore + 1
    );
    await expect(restoredSlide.locator(".mindmap-node--small")).toHaveCount(smallBefore + 1);
    await expect(restoredSlide.locator(".mindmap-node__label", { hasText: "新分支" })).toBeVisible();
    await expect(restoredSlide.locator(".mindmap-node--small .mindmap-node__label", { hasText: "小节点" })).toBeVisible();
  });

  test("dragged new mindmap nodes remain after save, exit, and reload", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    const branches = slide.locator(".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)");
    const smallNodes = slide.locator(".mindmap-node--small");
    const branchesBefore = await branches.count();
    const smallBefore = await smallNodes.count();

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-branch"]').click();
    const newBranch = slide.locator('.mindmap-node:has(.mindmap-node__label:text-is("新分支"))');
    await expect(newBranch).toHaveCount(1);
    await dragMindmapNodeBy(page, newBranch, -130, -90);
    const branchPosition = await nodePosition(newBranch);

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-small"]').click();
    const newSmall = slide.locator(".mindmap-node--small").last();
    await expect(smallNodes).toHaveCount(smallBefore + 1);
    await dragMindmapNodeBy(page, newSmall, -90, -60);
    const smallPosition = await nodePosition(newSmall);

    await page.locator("#deck-edit-save").click();
    await page.waitForTimeout(450);
    await expect(branches).toHaveCount(branchesBefore + 1);
    await expect(smallNodes).toHaveCount(smallBefore + 1);
    await expect.poll(() => nodePosition(newBranch)).toEqual(branchPosition);
    await expect.poll(() => nodePosition(newSmall)).toEqual(smallPosition);
    await page.locator("#deck-edit-exit").click();
    await expect(page.locator("body")).not.toHaveClass(/deck--editing/);
    await expect(branches).toHaveCount(branchesBefore + 1);
    await expect(smallNodes).toHaveCount(smallBefore + 1);

    await page.reload();
    await page.locator('[data-slide-dot="2"]').click();
    const restoredSlide = page.locator('section[data-page-type="mindmap"]:not([hidden])');
    await expect(restoredSlide.locator(".mindmap-node:not(.mindmap-node--hub):not(.mindmap-node--small)")).toHaveCount(
      branchesBefore + 1
    );
    await expect(restoredSlide.locator(".mindmap-node--small")).toHaveCount(smallBefore + 1);
    const restoredBranch = restoredSlide.locator('.mindmap-node:has(.mindmap-node__label:text-is("新分支"))');
    const restoredSmall = restoredSlide.locator(".mindmap-node--small").last();
    await expect(restoredBranch).toBeVisible();
    await expect(restoredSmall.locator(".mindmap-node__label", { hasText: "小节点" })).toBeVisible();
    await expect.poll(() => nodePosition(restoredBranch)).toEqual(branchPosition);
    await expect.poll(() => nodePosition(restoredSmall)).toEqual(smallPosition);
  });

  test("dragged center and small nodes keep exact position after save", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);
    const center = slide.locator(".mindmap-node--hub").first();
    await dragMindmapNodeBy(page, center, -120, -70);
    const centerPosition = await nodePosition(center);

    await center.click();
    await slide.locator('[data-mindmap-action="add-small"]').click();
    const small = slide.locator(".mindmap-node--small").last();
    await dragMindmapNodeBy(page, small, -90, -60);
    const smallPosition = await nodePosition(small);

    await page.locator("#deck-edit-save").click();
    await page.waitForTimeout(450);
    await expect.poll(() => nodePosition(center)).toEqual(centerPosition);
    await expect.poll(() => nodePosition(small)).toEqual(smallPosition);
  });

  test("linking to a dragged branch preserves the branch and renders the link", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-small"]').click();
    const small = slide.locator(".mindmap-node--small").last();

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-branch"]').click();
    const branch = slide.locator('.mindmap-node:has(.mindmap-node__label:text-is("新分支"))');
    await dragMindmapNodeBy(page, branch, -130, -90);
    const branchPosition = await nodePosition(branch);

    await page.evaluate(() => {
      const sec = document.querySelector('section[data-page-type="mindmap"]:not([hidden])');
      const branch = Array.from(sec?.querySelectorAll(".mindmap-node") || []).find(
        (el) => el.querySelector(".mindmap-node__label")?.textContent?.trim() === "新分支"
      );
      const MM = (window as Window & { MindmapDeck?: { setSelectedId: (s: Element, id: string) => void } }).MindmapDeck;
      if (sec && branch && MM) MM.setSelectedId(sec, branch.getAttribute("data-node-id") || "");
    });
    await slide.locator('[data-mindmap-action="add-link"]').click();
    await small.click();

    await expect(branch).toBeVisible();
    await expect(slide.locator("path.mindmap-edge--link")).toHaveCount(1);
    await expect.poll(() => nodePosition(branch)).toEqual(branchPosition);
  });

  test("dragged nested branches remain visible and keep positions after saving", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await enterDeckEdit(page);

    await slide.locator(".mindmap-node--hub").first().click();
    await slide.locator('[data-mindmap-action="add-branch"]').click();
    const parent = await selectedMindmapNode(page);
    await expect(parent).toBeVisible();

    await parent.click();
    await slide.locator('[data-mindmap-action="add-branch"]').click();
    const child = await selectedMindmapNode(page);
    await expect(child).toBeVisible();

    await dragMindmapNodeBy(page, child, -90, -55);
    const childPosition = await nodePosition(child);
    await page.locator("#deck-edit-save").click();
    await page.waitForTimeout(350);
    await expect(parent).toBeVisible();
    await expect(child).toBeVisible();
    await expect.poll(() => nodePosition(child)).toEqual(childPosition);

    await dragMindmapNodeBy(page, parent, -110, -70);
    const parentPosition = await nodePosition(parent);
    await page.locator("#deck-edit-save").click();
    await page.waitForTimeout(350);
    await expect(parent).toBeVisible();
    await expect(child).toBeVisible();
    await expect.poll(() => nodePosition(parent)).toEqual(parentPosition);
    await expect.poll(() => nodePosition(child)).toEqual(childPosition);
  });

  test("zoom in toolbar only in edit; hidden after exit", async ({ page }) => {
    const slide = await openMindmapSlide(page);
    await expect(slide.locator(".mindmap-toolbar")).toBeHidden();
    await enterDeckEdit(page);
    await expect(slide.locator(".mindmap-zoom")).toBeVisible();
    await page.locator("#deck-edit-exit").click();
    await expect(slide.locator(".mindmap-toolbar")).toBeHidden();
  });
});
