import type { Page } from "@playwright/test";

/**
 * 顶栏默认 translateY 收起，仅顶部约 6px 可接收悬停。
 * 用视口坐标移动鼠标，避免 Playwright 在「被 transform 卷起的盒子」上做 hover 时被整页层拦截。
 */
export async function revealDeckChrome(page: Page) {
  const vp = page.viewportSize();
  const x = Math.min(120, Math.max(40, (vp?.width ?? 1280) / 2));
  await page.mouse.move(x, 2);
  await page.waitForTimeout(180);
}
