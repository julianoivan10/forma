import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import { freshWallet } from "./chain";
import { injectWallet } from "./wallet";

const PAGES = ["/", "/stake", "/positions", "/earn", "/liquid", "/activity", "/docs", "/settings", "/positions/1"];
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const slug = (path: string) => path.replaceAll("/", "_") || "_home";

for (const path of PAGES) {
  test(`renders ${path} with network status and no console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    // Persistent testnet status in the navbar (the full disclosure lives on Settings and Docs).
    const status = page.getByRole("status", { name: "Network and wallet status" }).locator("visible=true");
    await expect(status).toContainText(/TESTNET|LOCAL DEVNET/i);
    await expect(status).toContainText(/Wallet · Not connected/i);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `test-results/screens/desktop${slug(path)}.png`, fullPage: true });
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("the large top banner is gone but the full disclosure is on Settings and Docs", async ({ page }) => {
  await page.goto("/stake");
  await expect(page.getByRole("note", { name: "Testnet disclaimer" })).toHaveCount(0);
  for (const path of ["/settings", "/docs"]) {
    await page.goto(path);
    const note = page.getByRole("note", { name: "Testnet disclaimer" });
    await expect(note).toContainText("no intended monetary value");
    await expect(note).toContainText("not undergone an independent security audit");
    await expect(note).toContainText(/Do not deposit assets of value/i);
  }
});

for (const path of PAGES) {
  test(`no horizontal page scroll on ${path} at all widths`, async ({ page }) => {
    await page.goto(path);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) {
        await page.screenshot({ path: `test-results/screens/overflow-${width}${slug(path)}.png`, fullPage: true });
      }
      expect(overflow, `${path} overflows by ${overflow}px at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

test.describe("staking page", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("pool rows are visible in the first viewport", async ({ page }) => {
    await page.goto("/stake");
    const firstRow = page.getByRole("button", { name: "Choose Genesis" });
    await expect(firstRow).toBeInViewport();
    await page.screenshot({ path: "test-results/screens/stake-fold.png" });
  });

  test("NFT preview waits for terms, then follows the selected pool", async ({ page }) => {
    await page.goto("/stake");
    const aside = page.locator("aside");
    await expect(aside.getByText("Awaiting terms")).toBeVisible();

    await page.getByRole("button", { name: "Choose Conviction" }).click();
    const card = aside.getByRole("img", { name: /Preview of position/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText("CONVICTION");
    await expect(card).toContainText("DAY 0 / 90");
    await expect(card).toContainText("1.75×");
    await expect(card).toContainText("BASE SEPOLIA · TESTNET · NO MONETARY VALUE");
    await expect(aside).toContainText("90 days");
    await expect(aside).toContainText(/#\d+ expected/);
    await expect(aside.getByText("Not minted")).toBeVisible();

    await page.getByRole("button", { name: "Choose Long Forge" }).click();
    await expect(card).toContainText("LONG FORGE");
    await expect(card).toContainText("DAY 0 / 180");
    await expect(card).toContainText("2.50×");
    await page.screenshot({ path: "test-results/screens/stake-selected.png" });
  });

  test("thin liquidity shows 'Not meaningful yet' instead of an extreme APR", async ({ page }) => {
    await page.goto("/stake");
    await expect(page.getByText("Not meaningful yet").first()).toBeVisible();
    await expect(page.getByText(/highly sensitive to current pool liquidity/).first()).toBeVisible();
    // No six-digit-plus percentages anywhere on the page.
    expect(await page.locator("main").innerText()).not.toMatch(/\d{1,3}(,\d{3})+(\.\d+)?%/);
  });
});

test("wrong network shows an actionable warning", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await injectWallet(page, await freshWallet(), "0xaa36a7"); // Ethereum Sepolia: supported by nobody here
  await page.goto("/settings");
  const alert = page.getByRole("alert").filter({ hasText: "Wrong network" });
  await expect(alert).toContainText("wallet on chain 11155111");
  await expect(page.getByRole("status", { name: "Network and wallet status" }).locator("visible=true")).toContainText(
    "Wallet · Wrong network",
  );
  await alert.getByRole("button", { name: "Switch to Base Sepolia" }).click();
  // The test wallet cannot add chains, so the app must explain the manual fallback.
  await expect(alert).toContainText("Add Base Sepolia manually: chain id 84532");
  await expect(alert).toContainText("Nothing changed");
  expect(errors.filter((e) => !/Unrecognized chain|4902/.test(e))).toEqual([]);
});

test("keyboard: skip link reaches main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("keyboard: a lock tier can be chosen without a pointer", async ({ page }) => {
  await page.goto("/stake");
  const choose = page.getByRole("button", { name: "Choose Builder" });
  await choose.focus();
  await expect(choose).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Selected Builder" })).toHaveAttribute("aria-pressed", "true");
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
