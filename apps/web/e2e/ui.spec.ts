import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const PAGES = ["/", "/stake", "/positions", "/earn", "/liquid", "/activity", "/docs", "/settings", "/positions/1"];

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

for (const path of PAGES) {
  test(`renders ${path} with testnet disclosure and no console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole("note", { name: "Testnet disclaimer" })).toContainText("Do not deposit assets of value");
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `test-results/screens/desktop${path.replaceAll("/", "_") || "_home"}.png`, fullPage: true });
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test.describe("mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const path of PAGES) {
    test(`no horizontal page scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `test-results/screens/mobile${path.replaceAll("/", "_") || "_home"}.png`, fullPage: true });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("keyboard: skip link reaches main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("reduced motion is respected", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  const duration = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-rise";
    document.body.appendChild(el);
    return getComputedStyle(el).animationDuration;
  });
  // globals.css forces animation-duration to 0.001ms under prefers-reduced-motion.
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await ctx.close();
});
