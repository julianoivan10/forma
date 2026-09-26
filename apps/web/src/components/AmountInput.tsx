"use client";

import { formatToken } from "@forma/sdk";
import { formatUnits } from "viem";

export function AmountInput({
  id,
  label,
  value,
  onChange,
  balance,
  balanceLabel = "Balance",
  symbol,
  decimals = 18,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  balance?: bigint;
  balanceLabel?: string;
  symbol: string;
  decimals?: number;
  error?: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2">
        <label htmlFor={id} className="label text-ink">
          {label}
        </label>
        {balance !== undefined && (
          <span className="mono text-xs text-ink-2">
            {balanceLabel}: {formatToken(balance, { maxDecimals: 4, tokenDecimals: decimals })} {symbol}
          </span>
        )}
      </div>
      <div className="flex">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          className="field text-2xl"
          value={value}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="mono flex items-center border border-l-0 border-rule-strong bg-bone px-3 text-xs font-semibold tracking-widest">
          {symbol}
        </span>
        {balance !== undefined && (
          <button
            type="button"
            className="btn btn-ghost border-l-0"
            disabled={disabled || balance === 0n}
            onClick={() => onChange(formatUnits(balance, decimals))}
          >
            Max
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
