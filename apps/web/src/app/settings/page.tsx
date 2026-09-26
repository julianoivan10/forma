"use client";

import { BASE_SEPOLIA_CHAIN_ID, NETWORK_LABEL } from "@forma/config";
import { formatCountdown, formatDateTimeUTC, formatToken } from "@forma/sdk";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";

import { ActionGate } from "@/components/NetworkGuard";
import { TestnetDisclosure } from "@/components/TestnetDisclosure";
import { TxStatus } from "@/components/TxStatus";
import { AddressLink, Empty, Loading, Row, SectionHeader, TxLink } from "@/components/ui";
import { ANVIL_ENABLED, env } from "@/lib/env";
import { useForma } from "@/lib/forma";
import { useActivity } from "@/lib/logs";
import { useForgeAccount } from "@/lib/reads";
import { useNow } from "@/lib/time";
import { WALLETCONNECT_ENABLED } from "@/lib/wagmi";
import { useFormaTx } from "@/lib/write";

export default function SettingsPage() {
  const { address, connector, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { chains, switchChain, isPending } = useSwitchChain();
  const { state, readChainId, deployment, walletChainId } = useForma();

  return (
    <div className="pt-10">
      <p className="label">Settings</p>
      <h1 className="display mt-3 text-[clamp(2rem,6vw,5rem)]">Wallet &amp; network</h1>
      <div className="mt-8 max-w-3xl">
        <TestnetDisclosure id="disclosure" />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <section>
          <SectionHeader index="01" title="Wallet" />
          {address ? (
            <dl className="pt-2">
              <Row k="Address" v={<AddressLink chainId={readChainId} address={address} label={address} />} />
              <Row k="Connector" v={connector?.name ?? "—"} />
              <Row k="Wallet network" v={chain ? `${chain.name} (${chain.id})` : `Unsupported (${walletChainId})`} />
              <Row k="Status" v={{ ready: "Ready to transact", disconnected: "—", mainnet: "MAINNET — blocked", "wrong-network": "Unsupported network", "not-deployed": "Not deployed here" }[state]} />
            </dl>
          ) : (
            <div className="pt-6">
              <ActionGate action="manage your wallet">{null}</ActionGate>
            </div>
          )}
          {address && (
            <button type="button" className="btn btn-ghost mt-4" onClick={() => disconnect()}>
              Disconnect
            </button>
          )}
        </section>

        <section>
          <SectionHeader index="02" title="Network" aside={NETWORK_LABEL[readChainId]} />
          <dl className="pt-2">
            <Row k="Reading from" v={NETWORK_LABEL[readChainId]} />
            <Row k="Chain id" v={String(readChainId)} />
            <Row k="Deployment" v={deployment ? `v${deployment.version} · ${formatDateTimeUTC(deployment.deployedAt)}` : "Not deployed"} />
            <Row k="Environment" v={env.NEXT_PUBLIC_APP_ENV} />
            <Row k="Local Anvil" v={ANVIL_ENABLED ? "Enabled (development)" : "Disabled"} />
            <Row k="WalletConnect" v={WALLETCONNECT_ENABLED ? "Enabled" : "Disabled — no project id; browser wallets only"} />
          </dl>
          {address && (
            <div className="mt-4 flex flex-wrap gap-2">
              {chains.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`btn ${c.id === walletChainId ? "" : "btn-ghost"}`}
                  disabled={isPending || c.id === walletChainId}
                  onClick={() => switchChain({ chainId: c.id })}
                >
                  {c.id === walletChainId ? `On ${c.name}` : `Switch to ${c.name}`}
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-ink-2">
            Base Sepolia · chain id {BASE_SEPOLIA_CHAIN_ID} · explorer sepolia.basescan.org. Gas is paid in Base Sepolia
            ETH from a public faucet. Mainnet is not supported and never will be by this build.
          </p>
        </section>
      </div>

      <Faucet />

      <section className="mt-14" id="contracts">
        <SectionHeader index="04" title="Contracts" aside={deployment ? deployment.network : undefined} />
        {deployment ? (
          <dl className="pt-2">
            {Object.entries(deployment.contracts).map(([name, addr]) => (
              <Row
                key={name}
                k={name}
                v={
                  <span className="inline-flex flex-wrap justify-end gap-3">
                    <AddressLink chainId={readChainId} address={addr} label={addr} />
                    {deployment.transactions[name as keyof typeof deployment.transactions] && (
                      <TxLink chainId={readChainId} hash={deployment.transactions[name as keyof typeof deployment.transactions]!} />
                    )}
                  </span>
                }
              />
            ))}
            {Object.entries(deployment.roles).map(([role, addr]) => (
              <Row key={role} k={`Role · ${role}`} v={<AddressLink chainId={readChainId} address={addr} label={addr} />} />
            ))}
          </dl>
        ) : (
          <div className="pt-6">
            <Empty title="No deployment manifest for this network">
              Deploy with <code className="mono">pnpm deploy:base-sepolia</code> (see docs/DEPLOYMENT.md). The app never
              substitutes placeholder addresses.
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}

function Faucet() {
  const now = useNow();
  const { address } = useForma();
  const forge = useForgeAccount();
  const { send, targets, isActive, chainId } = useFormaTx();
  const history = useActivity(address);
  const claims = (history.data?.items ?? []).filter((i) => i.event === "FaucetClaimed");
  const next = forge.nextFaucetAt ?? 0n;
  const cooling = next > now;

  return (
    <section className="mt-14" id="faucet">
      <SectionHeader index="03" title="FORGE faucet · testnet only" aside="ForgeToken.faucet" />
      <div className="grid gap-10 pt-6 lg:grid-cols-2">
        <div>
          <p className="numeral text-5xl">1,000 FORGE</p>
          <p className="mt-3 max-w-prose text-sm text-ink-2">
            FORGE is a <strong>test token with no monetary value</strong>. Each address can request 1,000 FORGE once per
            24 hours; the whole faucet is capped at 1,000,000 FORGE per UTC day; total supply is capped at 1B. There is no
            mainnet equivalent.
          </p>
          <dl className="mt-4">
            <Row k="Your FORGE" v={forge.balance !== undefined ? formatToken(forge.balance) : address ? "…" : "—"} />
            <Row k="Next request" v={!address ? "—" : cooling ? `${formatCountdown(next - now)} (${formatDateTimeUTC(next)})` : "Available now"} />
            <Row k="Faucet left today" v={forge.faucetRemainingToday !== undefined ? `${formatToken(forge.faucetRemainingToday, { maxDecimals: 0, minDecimals: 0 })} FORGE` : "—"} />
          </dl>
          <div className="mt-4">
            <ActionGate action="use the faucet">
              <button
                type="button"
                className="btn"
                disabled={cooling || isActive("faucet") || forge.faucetRemainingToday === 0n}
                onClick={() => targets && send(targets.forge, "faucet", [], { key: "faucet", label: "Faucet · 1,000 test FORGE", amountLabel: "1,000 FORGE" })}
              >
                {isActive("faucet") ? "Requesting…" : cooling ? "Cooling down" : "Request 1,000 test FORGE"}
              </button>
              <TxStatus txKey="faucet" />
            </ActionGate>
          </div>
        </div>
        <div>
          <p className="label mb-2 text-ink">Your faucet history · indexed</p>
          {!address ? (
            <p className="text-sm text-ink-2">Connect a wallet to see your faucet requests.</p>
          ) : history.isLoading ? (
            <Loading label="Scanning FaucetClaimed logs" />
          ) : claims.length === 0 ? (
            <p className="text-sm text-ink-2">No faucet requests in the last scanned blocks.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Block</th>
                  <th scope="col">Amount</th>
                  <th scope="col" className="text-right">Tx</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.key}>
                    <td className="mono text-xs">{c.blockNumber.toString()}</td>
                    <td className="mono text-sm">{formatToken(c.args.amount as bigint)} FORGE</td>
                    <td className="text-right">
                      <TxLink chainId={chainId} hash={c.hash} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
