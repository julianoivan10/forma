import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Address } from "viem";

import { advanceTime, client, deployment, forgeBalance, freshWallet, positionsOf } from "./chain";
import { connect, injectWallet } from "./wallet";

/**
 * The acceptance-criteria flow, run locally with two wallets and real mined transactions:
 * faucet → approve → stake (A and B) → claim → compound → withdraw after unlock → emergency withdraw on a
 * separate locked position → liquid deposit → liquid redeem. Every outcome is checked against chain state,
 * independently of what the UI displays.
 */
test.describe.configure({ mode: "serial" });

const E18 = 10n ** 18n;
const CONFIRMED = "Confirmed on-chain.";

async function openWallet(browser: Browser): Promise<{ page: Page; address: Address }> {
  const address = await freshWallet();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await injectWallet(page, address);
  await page.goto("/settings");
  await connect(page);
  await expect(page.getByText("Ready to transact")).toBeVisible();
  (page as Page & { __errors?: string[] }).__errors = errors;
  return { page, address };
}

async function useFaucet(page: Page) {
  await page.goto("/settings#faucet");
  await page.getByRole("button", { name: "Request 1,000 test FORGE" }).click();
  await expect(page.locator("#faucet").getByText(CONFIRMED)).toBeVisible();
}

async function stake(page: Page, poolId: number, amount: string, locked: boolean): Promise<bigint> {
  await page.goto(`/stake?pool=${poolId}`);
  await page.getByLabel("Principal").fill(amount);
  if (locked) await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve FORGE" }).click();
  const stakeButton = page.getByRole("button", { name: /^Stake into / });
  await expect(stakeButton).toBeEnabled();
  await stakeButton.click();
  const created = page.getByText(/^POSITION #\d+$/);
  await expect(created).toBeVisible();
  const id = BigInt((await created.textContent())!.replace("POSITION #", ""));
  return id;
}

async function onchainPosition(address: Address, id: bigint) {
  const views = await positionsOf(address);
  return views.find((v) => v.id === id);
}

let A: { page: Page; address: Address };
let B: { page: Page; address: Address };
let positionA: bigint;

test("wallet A and wallet B receive test FORGE from the faucet", async ({ browser }) => {
  A = await openWallet(browser);
  B = await openWallet(browser);
  await useFaucet(A.page);
  await useFaucet(B.page);
  expect(await forgeBalance(A.address)).toBe(1000n * E18);
  expect(await forgeBalance(B.address)).toBe(1000n * E18);
});

test("both wallets stake and receive position NFTs", async () => {
  positionA = await stake(A.page, 0, "300", false);
  const positionB = await stake(B.page, 0, "200", false);

  const a = await onchainPosition(A.address, positionA);
  const b = await onchainPosition(B.address, positionB);
  expect(a?.position.principal).toBe(300n * E18);
  expect(b?.position.principal).toBe(200n * E18);
  expect(await forgeBalance(A.address)).toBe(700n * E18);
});

test("a rejected wallet request is explained and sends nothing", async () => {
  await A.page.goto(`/positions/${positionA}`);
  await advanceTime(3600);
  const claim = A.page.getByRole("button", { name: "Claim rewards" });
  await expect(claim).toBeEnabled();
  await A.page.evaluate(() => ((window as unknown as Record<string, unknown>).__formaRejectNext = true));
  await claim.click();
  await expect(A.page.getByText("Request declined").first()).toBeVisible();
  await expect(A.page.getByText("You declined the request in your wallet. Nothing was sent.").first()).toBeVisible();
});

test("claim pays real rewards", async () => {
  await advanceTime(86_400);
  await A.page.goto(`/positions/${positionA}`);
  const before = await forgeBalance(A.address);
  const claim = A.page.getByRole("button", { name: "Claim rewards" });
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(A.page.getByText(CONFIRMED).first()).toBeVisible();
  const after = await forgeBalance(A.address);
  expect(after).toBeGreaterThan(before);
  const p = await onchainPosition(A.address, positionA);
  expect(p?.position.lifetimeRewards).toBe(after - before);
});

test("compound moves rewards into principal", async () => {
  await advanceTime(86_400);
  await A.page.goto(`/positions/${positionA}`);
  const compound = A.page.getByRole("button", { name: "Compound", exact: true });
  await expect(compound).toBeEnabled();
  await compound.click();
  await expect(A.page.getByText(CONFIRMED).first()).toBeVisible();
  const p = await onchainPosition(A.address, positionA);
  expect(p?.position.principal).toBeGreaterThan(300n * E18);
  expect(p?.position.compoundCount).toBe(1);
});

test("withdraw after unlock closes the position and burns the NFT", async () => {
  await A.page.goto(`/positions/${positionA}`);
  const principal = (await onchainPosition(A.address, positionA))!.position.principal;
  const before = await forgeBalance(A.address);
  await A.page.getByRole("button", { name: "Max" }).click();
  const withdraw = A.page.getByRole("button", { name: "Withdraw all & close" });
  await expect(withdraw).toBeEnabled();
  await withdraw.click();
  await expect(A.page.getByText(CONFIRMED).first()).toBeVisible();
  expect(await forgeBalance(A.address)).toBeGreaterThanOrEqual(before + principal);
  expect(await onchainPosition(A.address, positionA)).toBeUndefined();
  await expect(A.page.getByText("NFT burned")).toBeVisible();
});

test("emergency withdraw on a separate locked position shows and applies the penalty", async () => {
  const id = await stake(A.page, 2, "100", true); // Conviction: 90 days, 10 % early-exit penalty
  await A.page.goto(`/positions/${id}`);
  await expect(A.page.getByText("Available from")).toBeVisible(); // normal withdraw is locked
  await A.page.getByRole("button", { name: "Review consequences" }).click();
  const dialog = A.page.getByRole("dialog");
  await expect(dialog.getByText("Estimated amount returned")).toBeVisible();
  await expect(dialog.getByText(/10% of principal/)).toBeVisible();
  await expect(dialog.getByText("THIS ACTION CANNOT BE UNDONE", { exact: false })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Emergency withdraw" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  const before = await forgeBalance(A.address);
  await confirm.click();
  await expect(A.page.getByText(CONFIRMED).first()).toBeVisible();
  expect(await forgeBalance(A.address)).toBe(before + 90n * E18);

  const logs = await client.getContractEvents({
    address: deployment!.contracts.FormaStaking,
    abi: (await import("@forma/sdk")).formaStakingAbi,
    eventName: "EmergencyWithdraw",
    args: { positionId: id },
    fromBlock: 0n,
  });
  expect(logs[0]?.args.penalty).toBe(10n * E18);
});

test("liquid staking: deposit mints stFORGE, redeem returns FORGE", async () => {
  const vault = deployment!.contracts.LiquidStakingVault;
  const { liquidStakingVaultAbi } = await import("@forma/sdk");
  const shares = () =>
    client.readContract({ address: vault, abi: liquidStakingVaultAbi, functionName: "balanceOf", args: [B.address] });

  await B.page.goto("/liquid");
  await B.page.getByRole("textbox", { name: "Deposit" }).fill("100");
  await B.page.getByRole("button", { name: "1 · Approve FORGE" }).click();
  const deposit = B.page.getByRole("button", { name: "Deposit", exact: true });
  await expect(deposit).toBeEnabled();
  await deposit.click();
  // Two confirmations on this page: the approval and the deposit.
  await expect(B.page.getByText(CONFIRMED)).toHaveCount(2);
  expect(await shares()).toBeGreaterThan(0n);

  await advanceTime(86_400);
  const before = await forgeBalance(B.address);
  await B.page.reload();
  await B.page.getByRole("tab", { name: "redeem" }).click();
  await B.page.getByRole("button", { name: "Max" }).click();
  const redeem = B.page.getByRole("button", { name: "Redeem", exact: true });
  await expect(redeem).toBeEnabled();
  await redeem.click();
  await expect(B.page.getByText(CONFIRMED).first()).toBeVisible();
  expect(await shares()).toBe(0n);
  // Principal back plus the vault's share of rewards accrued meanwhile.
  expect(await forgeBalance(B.address)).toBeGreaterThan(before + 100n * E18);
});

test("no uncaught page errors during the flow", async () => {
  for (const w of [A, B]) {
    expect((w.page as Page & { __errors?: string[] }).__errors ?? []).toEqual([]);
  }
});
