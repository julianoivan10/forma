import type { FormaState } from "@/lib/forma";
import { assessAprEstimate } from "@forma/sdk";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AprEstimate } from "@/components/AprEstimate";
import { NetworkStatus } from "@/components/NetworkStatus";
import { PositionPreviewCard } from "@/components/PositionPreviewCard";

const E18 = 10n ** 18n;

const forma = vi.hoisted(() => ({
  value: { networkLabel: "BASE SEPOLIA · TESTNET", state: "disconnected" as FormaState, connected: false },
}));
vi.mock("@/lib/forma", () => ({ useForma: () => forma.value }));

const conviction = {
  name: "Conviction",
  lockDuration: 90n * 86_400n,
  multiplierBps: 17_500,
  earlyExitPenaltyBps: 1000,
  active: true,
  minStake: E18,
  maxTotalPrincipal: 0n,
  totalPrincipal: 0n,
  totalWeight: 0n,
  openPositions: 0,
};

describe("AprEstimate", () => {
  it("replaces liquidity-dominated estimates with 'Not meaningful yet' and the note", () => {
    render(<AprEstimate assessment={assessAprEstimate(202_777_777n, 1000n * E18, 0n)} withNote />);
    expect(screen.getByText("Not meaningful yet")).toBeInTheDocument();
    expect(screen.getByText("Testnet emission estimate is highly sensitive to current pool liquidity.")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("labels a displayed estimate as testnet", () => {
    render(<AprEstimate assessment={assessAprEstimate(1_234n, 1000n * E18, 50_000n * E18)} />);
    expect(screen.getByText("12.34%")).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(screen.getByText(/APY .* est\./)).toBeInTheDocument();
  });

  it("says when there is no stream", () => {
    render(<AprEstimate assessment={{ kind: "no-stream" }} />);
    expect(screen.getByText("No active stream")).toBeInTheDocument();
  });
});

describe("PositionPreviewCard", () => {
  const now = 1_800_000_000n;

  it("awaits terms before a pool is chosen", () => {
    render(<PositionPreviewCard pool={undefined} expectedId={7n} amount={undefined} now={now} rewardState="—" />);
    expect(screen.getByText("Awaiting terms")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the selected pool's real terms in the renderer layout", () => {
    render(
      <PositionPreviewCard pool={conviction} expectedId={7n} amount={250n * E18} now={now} rewardState="Not meaningful yet" />,
    );
    const card = screen.getByRole("img", { name: /Preview of position #7 in Conviction: 90 days lock, 1\.75× multiplier/ });
    expect(card).toHaveTextContent("FORMA / POSITION");
    expect(card).toHaveTextContent("#7");
    expect(card).toHaveTextContent("CONVICTION");
    expect(card).toHaveTextContent("DAY 0 / 90");
    expect(card).toHaveTextContent("250.00 FORGE");
    expect(card).toHaveTextContent("LOCKED");
    expect(card).toHaveTextContent("BASE SEPOLIA · TESTNET · NO MONETARY VALUE");
    expect(screen.getByText("Not minted")).toBeInTheDocument();
    expect(screen.getByText("#7 expected · final id assigned on-chain")).toBeInTheDocument();
    expect(screen.getByText("1.75× while locked")).toBeInTheDocument();
  });

  it("shows an open, unlocked preview for a no-lock pool", () => {
    render(
      <PositionPreviewCard
        pool={{ ...conviction, name: "Genesis", lockDuration: 0n, multiplierBps: 10_000, earlyExitPenaltyBps: 0 }}
        expectedId={undefined}
        amount={undefined}
        now={now}
        rewardState="Enter an amount"
      />,
    );
    const card = screen.getByRole("img");
    expect(card).toHaveTextContent("NO LOCK");
    expect(card).toHaveTextContent("OPEN");
    expect(card).toHaveTextContent("— FORGE");
  });
});

describe("NetworkStatus", () => {
  beforeEach(() => {
    forma.value = { networkLabel: "BASE SEPOLIA · TESTNET", state: "disconnected", connected: false };
  });

  it("shows the network and wallet state as text", () => {
    render(<NetworkStatus layout="strip" />);
    const status = screen.getByRole("status", { name: "Network and wallet status" });
    expect(status).toHaveTextContent("BASE SEPOLIA · TESTNET");
    expect(status).toHaveTextContent("Wallet · Not connected");
  });

  it("flags a wrong network in words, not only colour", () => {
    forma.value = { networkLabel: "BASE SEPOLIA · TESTNET", state: "wrong-network", connected: true };
    render(<NetworkStatus layout="strip" />);
    expect(screen.getByRole("status")).toHaveTextContent("Wallet · Wrong network");
  });

  it("reports a ready wallet", () => {
    forma.value = { networkLabel: "BASE SEPOLIA · TESTNET", state: "ready", connected: true };
    render(<NetworkStatus layout="inline" />);
    expect(screen.getByRole("status")).toHaveTextContent("Wallet · Connected");
  });
});
