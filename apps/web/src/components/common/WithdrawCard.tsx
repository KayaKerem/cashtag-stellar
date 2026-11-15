"use client";

import { Amount } from "@/components/common/Amount";
import { TxButton } from "@/components/common/TxButton";
import { useApi } from "@/lib/api/ApiProvider";
import { useOwed, useWrite } from "@/lib/api/hooks";

/**
 * Dispute payouts waiting for the connected wallet: bonds won and arbiter fees.
 * The contract credits them instead of sending them (a recipient without a trustline must not
 * block settlement), so the owner pulls them with `withdraw`. Renders nothing when nothing is owed.
 */
export function WithdrawCard({ role, className = "" }: { role: "clipper" | "brand" | "arbiter"; className?: string }) {
  const { account } = useApi();
  const owed = useOwed(account);
  const withdraw = useWrite((a) => a.withdraw());
  const amount = owed.data ?? 0n;
  if (!account || amount <= 0n) return null;

  const what =
    role === "arbiter"
      ? "Arbiter fees from closed disputes (10% of each bond)."
      : role === "brand"
        ? "Challenge bonds returned to you from disputes you won, minus the 10% arbiter fee."
        : "Bonds from challenges against your clips that were ruled in your favour, minus the 10% arbiter fee.";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 ${className}`}>
      <div>
        <p className="text-sm font-medium">
          Ready to withdraw: <Amount value={amount} />
        </p>
        <p className="mt-0.5 text-xs text-muted">{what}</p>
      </div>
      <TxButton action={() => withdraw.mutateAsync(undefined)} successTitle="Withdrawn" successBody={(r) => <Amount value={r.amount} />}>
        Withdraw
      </TxButton>
    </div>
  );
}
