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
