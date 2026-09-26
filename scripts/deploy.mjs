#!/usr/bin/env node
// Deployment wrapper with an explicit network allow-list (mainnet guard) and post-processing that adds
// deployment transaction hashes from Foundry's broadcast log to deployments/<network>.json.
//
//   node scripts/deploy.mjs anvil          # local, uses Anvil's unlocked account #0
//   node scripts/deploy.mjs base-sepolia   # requires .env (see .env.example) and a keystore account
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "packages/contracts");

// The ONLY networks this project can deploy to. There is intentionally no mainnet entry: adding one must be
// a deliberate code change reviewed alongside the contracts' own chain-id guards.
const NETWORKS = {
  anvil: { chainId: 31337, rpc: "http://127.0.0.1:8545", verify: false },
  "base-sepolia": { chainId: 84532, rpcEnv: "BASE_SEPOLIA_RPC_URL", verify: true },
};

const network = process.argv[2];
if (!NETWORKS[network]) {
  console.error(`Refusing to deploy to "${network ?? "(none)"}". Allowed: ${Object.keys(NETWORKS).join(", ")}.`);
  process.exit(1);
}
const cfg = NETWORKS[network];

// Minimal .env loader (no dependency); real environment variables take precedence.
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

if (process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) {
  console.error("Raw private keys in the environment are not supported. Use `cast wallet import` + DEPLOYER_ACCOUNT.");
  process.exit(1);
}

const rpc = cfg.rpc ?? process.env[cfg.rpcEnv];
if (!rpc) {
  console.error(`Missing ${cfg.rpcEnv}.`);
  process.exit(1);
}

// Double-check the RPC really is the chain we think it is before signing anything.
const chainIdRes = spawnSync("cast", ["chain-id", "--rpc-url", rpc], { encoding: "utf8", shell: false });
const liveChainId = Number(chainIdRes.stdout?.trim());
if (liveChainId !== cfg.chainId) {
  console.error(`RPC chain id ${liveChainId || "(unreachable)"} does not match ${network} (${cfg.chainId}). Aborting.`);
  process.exit(1);
}

const args = ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--slow"];
if (network === "anvil") {
  args.push("--unlocked", "--sender", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
} else {
  const account = process.env.DEPLOYER_ACCOUNT;
  if (!account) {
    console.error("Set DEPLOYER_ACCOUNT to a Foundry keystore account name (cast wallet import <name> --interactive).");
    process.exit(1);
  }
  args.push("--account", account);
  if (cfg.verify) {
    if (!process.env.ETHERSCAN_API_KEY) {
      console.error("Set ETHERSCAN_API_KEY (Etherscan V2 key, works for Basescan) to verify sources.");
      process.exit(1);
    }
    args.push("--verify", "--etherscan-api-key", process.env.ETHERSCAN_API_KEY, "--chain", String(cfg.chainId));
  }
}

console.log(`Deploying Forma to ${network} (chain ${cfg.chainId})…`);
const res = spawnSync("forge", args, { cwd: contractsDir, stdio: "inherit", env: process.env });
if (res.status !== 0) process.exit(res.status ?? 1);

// ─── attach transaction hashes from the broadcast log ──────────────────────
const broadcast = join(contractsDir, "broadcast", "Deploy.s.sol", String(cfg.chainId), "run-latest.json");
const manifestPath = join(root, "deployments", `${network}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const run = JSON.parse(readFileSync(broadcast, "utf8"));
const byAddress = Object.fromEntries(
  Object.entries(manifest.contracts).map(([name, addr]) => [addr.toLowerCase(), name]),
);
manifest.transactions = {};
for (const tx of run.transactions) {
  if (tx.transactionType === "CREATE" && tx.contractAddress) {
    const name = byAddress[tx.contractAddress.toLowerCase()];
    if (name) manifest.transactions[name] = tx.hash;
  }
}
const firstReceipt = run.receipts?.[0];
if (firstReceipt?.blockNumber) manifest.startBlock = Number(BigInt(firstReceipt.blockNumber));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Manifest updated with ${Object.keys(manifest.transactions).length} deployment tx hashes: ${manifestPath}`);

spawnSync("node", [join(root, "scripts/export-abis.mjs")], { stdio: "inherit" });
