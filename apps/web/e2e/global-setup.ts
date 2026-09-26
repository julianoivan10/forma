import { client, deployment } from "./chain";

/** Fails fast with instructions if the local chain or deployment is missing. Never fakes a chain. */
export default async function globalSetup() {
  if (!deployment) throw new Error("No Anvil deployment manifest. Run `pnpm deploy:local` then rebuild the web app.");
  let code: string | undefined;
  try {
    code = await client.getCode({ address: deployment.contracts.FormaStaking });
  } catch {
    throw new Error("Anvil is not reachable at http://127.0.0.1:8545. Start it with `pnpm anvil`.");
  }
  if (!code || code === "0x") {
    throw new Error(
      "FormaStaking is not deployed at the manifest address on this Anvil instance. Restart Anvil and run `pnpm deploy:local`.",
    );
  }
}
