import type { ContractFunctionName, ContractFunctionReturnType } from "viem";

import type { formaStakingAbi } from "./generated/abis";

type ViewFn = ContractFunctionName<typeof formaStakingAbi, "view">;
type Ret<F extends ViewFn> = ContractFunctionReturnType<typeof formaStakingAbi, "view", F>;

/** Types derived from the generated ABI — they cannot drift from the contracts. */
export type PositionView = Ret<"getPositionView">;
export type Position = PositionView["position"];
export type Routing = PositionView["effectiveRouting"];
export type Pool = Ret<"getPool">;
export type StakePreview = Ret<"previewStake">;
export type EmergencyPreview = Ret<"previewEmergencyWithdraw">;
export type RewardState = Ret<"rewardState">;
export type AccountStats = Ret<"accountStats">;
export type CompoundConfig = Ret<"compoundConfig">;

/** Mirrors `IFormaTypes.PositionStatus`. */
export const PositionStatus = { None: 0, Active: 1, Closed: 2, EmergencyClosed: 3 } as const;
/** Mirrors `IFormaTypes.RoutingMode`. */
export const RoutingMode = { Keep: 0, Compound: 1, Redirect: 2 } as const;
export type RoutingModeValue = (typeof RoutingMode)[keyof typeof RoutingMode];

export const BPS = 10_000n;
export const TOKEN_DECIMALS = 18;
export const SECONDS_PER_DAY = 86_400n;
export const SECONDS_PER_YEAR = 365n * SECONDS_PER_DAY;
