/**
 * Deterministic visual model for a position: the TypeScript twin of PositionRenderer.sol `_visual`.
 * Both implementations must use the same formulas (see docs/ARCHITECTURE.md, "Position glyph").
 */
export type GlyphHue = "lime" | "sky" | "orange" | "violet";

export interface GlyphModel {
  /** 1..6: decades of whole FORGE principal. Drives tick density (tier × 8 ticks). */
  tier: number;
  tickCount: number;
  /** 0..1000: lock progress; full ring once unlocked or when there is no lock. */
  progress: number;
  /** 6..18: stroke weight from the ACTIVE multiplier. */
  strokeWidth: number;
  /** 0..359: identity rotation from the position id. */
  rotation: number;
  hue: GlyphHue;
}

export const GLYPH_HEX: Record<GlyphHue, string> = {
  lime: "#B8F229",
  sky: "#2E9BFF",
  orange: "#FF5F1F",
  violet: "#6C4CFF",
};

const DAY = 86_400n;

export function amountTier(principalWei: bigint): number {
  const whole = principalWei / 10n ** 18n;
  if (whole < 100n) return 1;
  if (whole < 1_000n) return 2;
  if (whole < 10_000n) return 3;
  if (whole < 100_000n) return 4;
  if (whole < 1_000_000n) return 5;
  return 6;
}

export function lockHue(lockSeconds: bigint): GlyphHue {
  if (lockSeconds === 0n) return "lime";
  if (lockSeconds <= 30n * DAY) return "sky";
  if (lockSeconds <= 90n * DAY) return "orange";
  return "violet";
}

export function glyphModel(input: {
  id: bigint;
  principal: bigint;
  startTime: bigint;
  unlockTime: bigint;
  activeMultiplierBps: number;
  nowSeconds: bigint;
}): GlyphModel {
  const lock = input.unlockTime - input.startTime;
  const tier = amountTier(input.principal);
  const progress =
    lock === 0n || input.nowSeconds >= input.unlockTime
      ? 1000
      : Number(((input.nowSeconds - input.startTime) * 1000n) / lock);
  return {
    tier,
    tickCount: tier * 8,
    progress: Math.max(0, progress),
    strokeWidth: 6 + Math.floor(((input.activeMultiplierBps - 10_000) * 12) / 40_000),
    rotation: Number((input.id * 137n) % 360n),
    hue: lockHue(lock),
  };
}
