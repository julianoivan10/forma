import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmergencyDialog } from "@/components/EmergencyDialog";
import { LockTimeline } from "@/components/LockTimeline";
import { PositionGlyph } from "@/components/PositionGlyph";
import { RoutingForm } from "@/components/RoutingForm";
import { TxSteps } from "@/components/TxStatus";
import type { TxRecord } from "@/lib/tx";

// jsdom lacks <dialog> modal methods.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

const E18 = 10n ** 18n;
const OWNER = "0x1111111111111111111111111111111111111111" as const;

function record(overrides: Partial<TxRecord>): TxRecord {
  return {
    id: 1,
    key: "claim:1",
    label: "Claim rewards · #1",
    contractName: "FormaStaking",
    contractAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    chainId: 84532,
    phase: "preparing",
    startedAt: 0,
    ...overrides,
  };
}

describe("TxSteps", () => {
  it("never shows success before confirmation", () => {
    render(<TxSteps record={record({ phase: "confirming", hash: `0x${"ab".repeat(32)}` })} />);
    expect(screen.queryByText("Confirmed on-chain.")).not.toBeInTheDocument();
    expect(screen.getByText(/do not resubmit/i)).toBeInTheDocument();
  });

  it("shows the hash, explorer link, contract and amount", () => {
    const hash = `0x${"cd".repeat(32)}` as const;
    render(<TxSteps record={record({ phase: "confirmed", hash, blockNumber: 42n, amountLabel: "12.5 FORGE" })} />);
    expect(screen.getByText("Confirmed on-chain.")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${hash}`);
    expect(screen.getByText("12.5 FORGE")).toBeInTheDocument();
    expect(screen.getByText(/FormaStaking/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("explains failures with a specific reason", () => {
    render(
      <TxSteps
        record={record({
          phase: "failed",
          failedAt: "wallet",
          error: { kind: "rejected", title: "Request declined", detail: "You declined the request in your wallet." },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Request declined");
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});

describe("EmergencyDialog", () => {
  const preview = { principal: 1000n * E18, pendingForfeited: 84n * E18, penalty: 50n * E18, amountOut: 950n * E18 };

  it("shows every consequence and requires acknowledgement", async () => {
    const onConfirm = vi.fn();
    render(
      <EmergencyDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        preview={preview}
        penaltyBps={500}
        paused={false}
        locked
        busy={false}
        positionId={184n}
      />,
    );
    expect(screen.getByText("Principal")).toBeInTheDocument();
    expect(screen.getByText("Rewards forfeited")).toBeInTheDocument();
    expect(screen.getByText(/5% of principal/)).toBeInTheDocument();
    expect(screen.getByText("950.00 FORGE")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Emergency withdraw" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("states that the penalty is waived while paused", () => {
    render(
      <EmergencyDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        preview={{ ...preview, penalty: 0n, amountOut: 1000n * E18 }}
        penaltyBps={500}
        paused
        locked
        busy={false}
        positionId={1n}
      />,
    );
    expect(screen.getByText(/Waived: protocol is paused/)).toBeInTheDocument();
  });
});

describe("RoutingForm", () => {
  it("validates redirect recipients before submitting", async () => {
    const onSubmit = vi.fn();
    render(<RoutingForm current={undefined} owner={OWNER} protocolKeeperFeeBps={100} busy={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("radio", { name: /Redirect/ }));
    const input = screen.getByLabelText("Recipient wallet");
    await userEvent.type(input, "0x123");
    expect(screen.getByText("Enter a valid 0x address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save routing" })).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, OWNER);
    expect(screen.getByText(/same as Keep/)).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "0x2222222222222222222222222222222222222222");
    await userEvent.click(screen.getByRole("button", { name: "Save routing" }));
    expect(onSubmit).toHaveBeenCalledWith(2, "0x2222222222222222222222222222222222222222", 0);
  });

  it("caps the keeper fee at 5%", async () => {
    const onSubmit = vi.fn();
    render(<RoutingForm current={undefined} owner={OWNER} protocolKeeperFeeBps={100} busy={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("radio", { name: /Compound/ }));
    const fee = screen.getByLabelText(/Max keeper fee/);
    await userEvent.clear(fee);
    await userEvent.type(fee, "6");
    expect(screen.getByText(/between 0% and 5%/)).toBeInTheDocument();
    await userEvent.clear(fee);
    await userEvent.type(fee, "2.5");
    await userEvent.click(screen.getByRole("button", { name: "Save routing" }));
    expect(onSubmit).toHaveBeenCalledWith(1, "0x0000000000000000000000000000000000000000", 250);
  });
});

describe("PositionGlyph", () => {
  it("encodes the position deterministically", () => {
    const input = { id: 184n, principal: 1234n * E18, startTime: 0n, unlockTime: 90n * 86_400n, activeMultiplierBps: 17_500 };
    const { container, rerender } = render(<PositionGlyph input={input} now={45n * 86_400n} animate={false} />);
    const first = container.innerHTML;
    expect(container.querySelectorAll("line")).toHaveLength(24); // tier 3 × 8 ticks
    expect(container.querySelector("[stroke-dasharray]")).toHaveAttribute("stroke-dasharray", "500 1000");
    expect(screen.getByRole("img")).toHaveAccessibleName(/50% complete, 1\.75× active multiplier/);
    rerender(<PositionGlyph input={input} now={45n * 86_400n} animate={false} />);
    expect(container.innerHTML).toBe(first);
  });
});

describe("LockTimeline", () => {
  it("reports progress accessibly", () => {
    render(<LockTimeline startTime={0n} unlockTime={100n} now={25n} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("says plainly when there is no lock", () => {
    render(<LockTimeline startTime={5n} unlockTime={5n} now={10n} />);
    expect(screen.getByText(/No lock · withdraw any time/)).toBeInTheDocument();
  });
});
