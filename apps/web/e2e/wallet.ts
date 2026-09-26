import { expect, type Page } from "@playwright/test";
import type { Address } from "viem";

import { RPC_URL } from "./chain";

/**
 * Injects an EIP-1193 wallet that forwards to Anvil. Transactions are really sent and mined.
 * `window.__formaRejectNext = true` makes the next signature request fail with code 4001 (user rejection).
 */
export async function injectWallet(page: Page, account: Address) {
  await page.addInitScript(
    ({ rpcUrl, account }) => {
      const chainId = "0x7a69";
      let id = 0;
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const w = window as unknown as Record<string, unknown>;
      const rpc = async (method: string, params: unknown[] = []) => {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        const json = await res.json();
        if (json.error) {
          const e = new Error(json.error.message) as Error & { code?: number; data?: unknown };
          e.code = json.error.code;
          e.data = json.error.data;
          throw e;
        }
        return json.result;
      };
      const provider = {
        isFormaTestWallet: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [account];
            case "eth_chainId":
              return chainId;
            case "net_version":
              return "31337";
            case "wallet_switchEthereumChain": {
              const target = (params?.[0] as { chainId?: string } | undefined)?.chainId?.toLowerCase();
              if (target === chainId) return null;
              const e = new Error("Unrecognized chain") as Error & { code?: number };
              e.code = 4902;
              throw e;
            }
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_revokePermissions":
              return null;
            case "eth_sendTransaction": {
              if (w.__formaRejectNext) {
                w.__formaRejectNext = false;
                const e = new Error("User rejected the request.") as Error & { code?: number };
                e.code = 4001;
                throw e;
              }
              const tx = { ...(params?.[0] as object), from: account };
              return rpc("eth_sendTransaction", [tx]);
            }
            default:
              return rpc(method, params ?? []);
          }
        },
        on(event: string, fn: (...a: unknown[]) => void) {
          (listeners[event] ??= []).push(fn);
          return provider;
        },
        removeListener(event: string, fn: (...a: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          return provider;
        },
      };
      w.ethereum = provider;
    },
    { rpcUrl: RPC_URL, account },
  );
}

/**
 * Connects through the RainbowKit modal. An already-authorised injected wallet (eth_accounts returns the
 * account, like a previously approved MetaMask) is auto-reconnected by wagmi, in which case nothing is clicked.
 */
export async function connect(page: Page) {
  const connectButton = page.getByRole("button", { name: "Connect wallet" }).first();
  const ready = page.getByText("Ready to transact");
  await expect(connectButton.or(ready)).toBeVisible();
  if (await ready.isVisible()) return;
  await connectButton.click();
  await page.getByRole("dialog").getByRole("button", { name: /browser wallet|injected/i }).first().click();
}
