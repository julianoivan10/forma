import type { AccountStats, PositionView } from "./types";
import { PositionStatus } from "./types";

export type MilestoneId =
  | "first-stake"
  | "seven-day-streak"
  | "thirty-day-conviction"
  | "first-compound"
  | "hundred-earned"
  | "position-matured"
  | "liquid-position";

export interface Milestone {
  id: MilestoneId;
  label: string;
  description: string;
  achieved: boolean;
  /** Where the fact comes from. "counter" = stored on-chain; "live" = derived from current on-chain holdings. */
  source: "counter" | "live";
}

const DAY = 86_400n;
const HUNDRED_FORGE = 100n * 10n ** 18n;

/**
 * Protocol reputation, derived only from on-chain state (FormaStaking.accountStats, owned positions and the
 * stFORGE balance). Nothing is awarded client-side. See docs/PROTOCOL.md §11.
 */
export function deriveMilestones(
  stats: AccountStats,
  positions: readonly PositionView[],
  stBalance: bigint,
  nowSeconds: bigint,
): Milestone[] {
  const hasSevenDayPosition = positions.some(
    (v) => v.position.status === PositionStatus.Active && nowSeconds - v.position.startTime >= 7n * DAY,
  );
  return [
    {
      id: "first-stake",
      label: "FIRST STAKE",
      description: "Opened a position.",
      achieved: stats.positionsOpened > 0,
      source: "counter",
    },
    {
      id: "seven-day-streak",
      label: "7 DAY STREAK",
      description: "Holds an active position that is at least 7 days old.",
      achieved: hasSevenDayPosition,
      source: "live",
    },
    {
      id: "thirty-day-conviction",
      label: "30 DAY CONVICTION",
      description: "Committed to a lock of 30 days or more.",
      achieved: stats.longestLock >= 30n * DAY,
      source: "counter",
    },
    {
      id: "first-compound",
      label: "FIRST COMPOUND",
      description: "Compounded rewards back into a position.",
      achieved: stats.compounds > 0,
      source: "counter",
    },
    {
      id: "hundred-earned",
      label: "100 FORGE EARNED",
      description: "Realised 100 test FORGE in rewards (claimed, compounded or redirected).",
      achieved: stats.rewardsEarned >= HUNDRED_FORGE,
      source: "counter",
    },
    {
      id: "position-matured",
      label: "POSITION MATURED",
      description: "Held a locked position to maturity and withdrew it.",
      achieved: stats.positionsMatured > 0,
      source: "counter",
    },
    {
      id: "liquid-position",
      label: "LIQUID POSITION CREATED",
      description: "Holds stFORGE from the liquid staking vault.",
      achieved: stBalance > 0n,
      source: "live",
    },
  ];
}
