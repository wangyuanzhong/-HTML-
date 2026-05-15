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

      await page.locator('[data-slide-index="1"] [data-slide-go="2"]').first().click();
      await expect(page.locator('[data-slide-index="2"]')).toBeVisible();
      await expect(page.locator("#filter-deck")).toBeVisible();
    });
  });
}
