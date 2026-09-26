"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";

import { useForma } from "./forma";

/**
 * "Now" in CHAIN time, in seconds: the latest block timestamp plus local seconds elapsed since it was read.
 * Lock countdowns and progress use this so they agree with the contracts even when the user's clock (or a
 * local devnet's time travel) differs. Eligibility itself is still decided on-chain (e.g. `PositionView.locked`).
 * Falls back to the wall clock until the first block is read.
 */
export function useNow(intervalMs = 1000): bigint {
  const { readChainId } = useForma();
  const client = usePublicClient({ chainId: readChainId });
  const anchor = useQuery({
    queryKey: ["chain-clock", readChainId],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async () => {
      const block = await client!.getBlock();
      return { chain: block.timestamp, localMs: Date.now() };
    },
  });
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  if (anchor.data) {
    const elapsed = Math.max(0, Math.floor((tick - anchor.data.localMs) / 1000));
    return anchor.data.chain + BigInt(elapsed);
  }
  return BigInt(Math.floor(tick / 1000));
}
