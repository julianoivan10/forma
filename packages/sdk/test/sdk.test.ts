import { BaseError, ContractFunctionRevertedError, encodeErrorResult, UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";

import {
  aprBpsToApyBps,
  deriveMilestones,
  describeError,
  formaStakingAbi,
  formatBpsPercent,
  formatCountdown,
  formatDateUTC,
  formatLockDuration,
  formatMultiplier,
  formatToken,
  formatTokenCompact,
  glyphModel,
  lockProgress,
  parseTokenInput,
  positionPhase,
  summarizePositions,
  type AccountStats,
  type PositionView,
} from "../src";

const E18 = 10n ** 18n;
const DAY = 86_400n;

function view(overrides: Partial<PositionView["position"]> & { pending?: bigint; id?: bigint } = {}): PositionView {
  const { pending = 0n, id = 1n, ...p } = overrides;
  return {
    id,
    owner: "0x0000000000000000000000000000000000000001",
    pendingRewards: pending,
    locked: false,
    boostExpirable: false,
    rewardPerSecond: 0n,
    effectiveRouting: {
      mode: 0,
      recipient: "0x0000000000000000000000000000000000000000",
      maxKeeperFeeBps: 0,
      configuredBy: "0x0000000000000000000000000000000000000000",
    },
    position: {
      principal: 1000n * E18,
      weight: 1000n * E18,
      startTime: 1_000n,
      unlockTime: 1_000n,
      poolId: 0,
      multiplierBps: 10_000,
      activeMultiplierBps: 10_000,
      earlyExitPenaltyBps: 0,
      status: 1,
      lastThirdPartyCompound: 0n,
      compoundCount: 0,
      rewardPerWeightPaid: 0n,
      rewardsAccrued: 0n,
      lifetimeRewards: 0n,
      ...p,
    },
  };
}

describe("format", () => {
  it("floors token amounts and groups thousands", () => {
    expect(formatToken(1_234_567_899_999_999_999_999n)).toBe("1,234.56");
    expect(formatToken(0n)).toBe("0.00");
    expect(formatToken(E18 / 3n, { maxDecimals: 4, minDecimals: 0 })).toBe("0.3333");
    expect(formatToken(5n * E18, { maxDecimals: 4, minDecimals: 0 })).toBe("5");
  });

  it("formats compact amounts without rounding up", () => {
    expect(formatTokenCompact(1_259_000n * E18)).toBe("1.2M");
    expect(formatTokenCompact(84_210n * E18)).toBe("84.2K");
    expect(formatTokenCompact(12n * E18)).toBe("12.00");
  });

  it("formats multipliers, bps and durations", () => {
    expect(formatMultiplier(17_500)).toBe("1.75×");
    expect(formatMultiplier(10_000)).toBe("1.00×");
    expect(formatMultiplier(25_000n)).toBe("2.50×");
    expect(formatBpsPercent(1000)).toBe("10%");
    expect(formatBpsPercent(250)).toBe("2.5%");
    expect(formatLockDuration(90n * DAY)).toBe("90 days");
    expect(formatLockDuration(3600)).toBe("1 hour");
    expect(formatLockDuration(0)).toBe("No lock");
    expect(formatCountdown(42 * 86_400 + 3 * 3600)).toBe("42d 3h");
    expect(formatCountdown(59)).toBe("59s");
    expect(formatDateUTC(1_798_156_800n)).toBe("DEC 25, 2026");
  });

  it("parses user input strictly", () => {
    expect(parseTokenInput("1,000.5")).toEqual({ ok: true, value: 1000n * E18 + E18 / 2n });
    expect(parseTokenInput("")).toMatchObject({ ok: false });
    expect(parseTokenInput("0")).toMatchObject({ ok: false });
    expect(parseTokenInput("-1")).toMatchObject({ ok: false });
    expect(parseTokenInput("1e18")).toMatchObject({ ok: false });
    expect(parseTokenInput("0.0000000000000000001")).toMatchObject({ ok: false });
  });
});

describe("rates", () => {
  it("converts on-chain APR to APY with daily compounding", () => {
    // 10% APR → ~10.515% APY
    expect(aprBpsToApyBps(1000n)).toBe(1051n);
    expect(aprBpsToApyBps(0n)).toBeNull();
  });
});

describe("position", () => {
  it("derives the lifecycle phase", () => {
    const now = 10_000n;
    expect(positionPhase(view(), now)).toBe("open");
    expect(positionPhase(view({ unlockTime: 20_000n, activeMultiplierBps: 17_500 }), now)).toBe("locked");
    expect(positionPhase(view({ unlockTime: 5_000n, activeMultiplierBps: 17_500 }), now)).toBe("boost-expirable");
    expect(positionPhase(view({ unlockTime: 5_000n }), now)).toBe("unlocked");
    expect(positionPhase(view({ status: 2 }), now)).toBe("closed");
    expect(positionPhase(view({ status: 3 }), now)).toBe("emergency-closed");
  });

  it("computes lock progress", () => {
    expect(lockProgress(0n, 100n, 25n)).toBe(0.25);
    expect(lockProgress(0n, 100n, 150n)).toBe(1);
    expect(lockProgress(50n, 50n, 10n)).toBe(1);
  });

  it("summarises a portfolio from on-chain views", () => {
    const now = 10_000n;
    const s = summarizePositions(
      [
        view({ principal: 1000n * E18, weight: 1750n * E18, unlockTime: 50_000n, pending: 84n * E18 }),
        view({ principal: 250n * E18, weight: 250n * E18, pending: 12n * E18 }),
        view({ status: 2, principal: 0n, weight: 0n }),
      ],
      now,
    );
    expect(s.activeCount).toBe(2);
    expect(s.totalPrincipal).toBe(1250n * E18);
    expect(s.totalPending).toBe(96n * E18);
    expect(s.lockedPrincipal).toBe(1000n * E18);
    expect(s.nextUnlock).toBe(50_000n);
    expect(s.weightedMultiplierBps).toBe(16_000n); // (1750+250)/1250
  });
});

describe("milestones", () => {
  const stats: AccountStats = {
    firstStakeAt: 1n,
    positionsOpened: 2,
    positionsMatured: 0,
    compounds: 1,
    longestLock: 90n * DAY,
    rewardsEarned: 99n * E18,
  };

  it("derives achievements only from supplied on-chain data", () => {
    const m = deriveMilestones(stats, [view({ startTime: 0n })], 0n, 8n * DAY);
    const get = (id: string) => m.find((x) => x.id === id)?.achieved;
    expect(get("first-stake")).toBe(true);
    expect(get("seven-day-streak")).toBe(true);
    expect(get("thirty-day-conviction")).toBe(true);
    expect(get("first-compound")).toBe(true);
    expect(get("hundred-earned")).toBe(false);
    expect(get("position-matured")).toBe(false);
    expect(get("liquid-position")).toBe(false);
  });
});

describe("glyph", () => {
  it("mirrors the on-chain renderer formulas", () => {
    const g = glyphModel({
      id: 184n,
      principal: 1234n * E18,
      startTime: 0n,
      unlockTime: 90n * DAY,
      activeMultiplierBps: 17_500,
      nowSeconds: 45n * DAY,
    });
    expect(g.tier).toBe(3);
    expect(g.tickCount).toBe(24);
    expect(g.progress).toBe(500);
    expect(g.strokeWidth).toBe(8); // 6 + 7500*12/40000 = 8.25 → 8
    expect(g.rotation).toBe((184 * 137) % 360);
    expect(g.hue).toBe("orange");
  });
});

describe("errors", () => {
  it("explains wallet rejections", () => {
    const err = new BaseError("rejected", { cause: new UserRejectedRequestError(new Error("User rejected")) });
    expect(describeError(err)).toMatchObject({ kind: "rejected", title: "Request declined" });
  });

  it("decodes protocol custom errors with arguments", () => {
    const data = encodeErrorResult({ abi: formaStakingAbi, errorName: "PositionLocked", args: [1_798_156_800n] });
    const revert = new ContractFunctionRevertedError({ abi: formaStakingAbi, data, functionName: "withdraw" });
    const d = describeError(new BaseError("wrapped", { cause: revert }));
    expect(d.kind).toBe("reverted");
    expect(d.title).toBe("Still locked");
    expect(d.detail).toContain("DEC 25, 2026");
  });

  it("detects missing gas funds", () => {
    const d = describeError(new BaseError("insufficient funds for gas * price + value"));
    expect(d.kind).toBe("insufficient-gas");
  });

  it("never produces a generic message for unknown errors", () => {
    const d = describeError(new Error("boom"));
    expect(d.detail).toBe("boom");
    expect(d.title).not.toMatch(/something went wrong/i);
  });
});
