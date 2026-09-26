import { parseUnits } from "viem";

import { BPS, TOKEN_DECIMALS } from "./types";

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Formats a token amount for display. Always floors (never shows more than the chain holds).
 * `maxDecimals` trims trailing precision; `minDecimals` pads.
 */
export function formatToken(
  wei: bigint,
  { maxDecimals = 2, minDecimals = 2, tokenDecimals = TOKEN_DECIMALS } = {},
): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const unit = 10n ** BigInt(tokenDecimals);
  const whole = abs / unit;
  let frac = (abs % unit).toString().padStart(tokenDecimals, "0").slice(0, maxDecimals);
  while (frac.length > minDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  const out = frac.length > 0 ? `${group(whole.toString())}.${frac}` : group(whole.toString());
  return negative ? `-${out}` : out;
}

/** Compact form for large figures: 1.25M, 84.2K. Floors. */
export function formatTokenCompact(wei: bigint, tokenDecimals = TOKEN_DECIMALS): string {
  const whole = wei / 10n ** BigInt(tokenDecimals);
  const units: [bigint, string][] = [
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ];
  for (const [size, suffix] of units) {
    if (whole >= size) {
      const tenths = (whole * 10n) / size;
      const int = tenths / 10n;
      const dec = tenths % 10n;
      return `${int}${dec === 0n ? "" : `.${dec}`}${suffix}`;
    }
  }
  return formatToken(wei);
}

/** 17_500 → "1.75×" */
export function formatMultiplier(bps: number | bigint): string {
  const v = BigInt(bps);
  const whole = v / BPS;
  const hundredths = (v % BPS) / 100n;
  return `${whole}.${hundredths.toString().padStart(2, "0")}×`;
}

/** 1_000 → "10%", 250 → "2.5%" */
export function formatBpsPercent(bps: number | bigint): string {
  const v = Number(bps);
  const pct = v / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "")}%`;
}

/** Human duration: 7_776_000 → "90 days", 3_600 → "1 hour", 0 → "No lock". */
export function formatLockDuration(seconds: number | bigint): string {
  const s = Number(seconds);
  if (s === 0) return "No lock";
  if (s % 86_400 === 0) {
    const d = s / 86_400;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (s % 3600 === 0) {
    const h = s / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return formatCountdown(s);
}

/** Remaining-time format: "42d 3h", "3h 12m", "45s". */
export function formatCountdown(seconds: number | bigint): string {
  let s = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Unix seconds → "DEC 25, 2026" (UTC, uppercase, deterministic across locales). */
export function formatDateUTC(unixSeconds: number | bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTimeUTC(unixSeconds: number | bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${formatDateUTC(unixSeconds)} · ${hh}:${mm} UTC`;
}

export function shortAddress(address: string, chars = 4): string {
  return address.length <= 2 + chars * 2 ? address : `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export const shortHash = shortAddress;

export type ParsedAmount = { ok: true; value: bigint } | { ok: false; reason: string };

/** Strict user-input parser for token amounts. Never throws. */
export function parseTokenInput(input: string, tokenDecimals = TOKEN_DECIMALS): ParsedAmount {
  const s = input.trim().replace(/,/g, "");
  if (s === "") return { ok: false, reason: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return { ok: false, reason: "Use digits and an optional decimal point." };
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > tokenDecimals) return { ok: false, reason: `At most ${tokenDecimals} decimal places.` };
  const value = parseUnits(s, tokenDecimals);
  if (value === 0n) return { ok: false, reason: "Amount must be greater than zero." };
  return { ok: true, value };
}
