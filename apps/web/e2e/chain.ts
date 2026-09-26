import { getDeployment } from "@forma/config";
import { forgeTokenAbi, formaStakingAbi } from "@forma/sdk";
import { createPublicClient, http, numberToHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

export const RPC_URL = "http://127.0.0.1:8545";
export const deployment = getDeployment(anvil.id);
export const client = createPublicClient({ chain: anvil, transport: http(RPC_URL) });

let id = 0;
export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

/** A fresh, never-used address with gas money, impersonated on Anvil so the injected wallet can send from it. */
export async function freshWallet(): Promise<Address> {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  await rpc("anvil_impersonateAccount", [address]);
  await rpc("anvil_setBalance", [address, numberToHex(10n ** 19n)]);
  return address;
}

/** Advance chain time (local chain only) so rewards accrue and locks can expire. */
export async function advanceTime(seconds: number) {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
}

export async function forgeBalance(address: Address) {
  return client.readContract({
    address: deployment!.contracts.ForgeToken,
    abi: forgeTokenAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function positionsOf(address: Address) {
  return client.readContract({
    address: deployment!.contracts.FormaStaking,
    abi: formaStakingAbi,
    functionName: "positionsOf",
    args: [address, 0n, 100n],
  });
}
