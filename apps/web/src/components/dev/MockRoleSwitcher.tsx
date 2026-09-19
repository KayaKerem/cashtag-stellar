"use client";

import { MOCK_ACCOUNTS } from "@cliprail/client";
import { shortAddress } from "@cliprail/shared";
import { MOCK_ROLES, useApi, type MockRole } from "@/lib/api/ApiProvider";
import { useWallet } from "@/lib/wallet/WalletProvider";

const LABELS: Record<MockRole, string> = {
  brand: "Brand",
  arbiter: "Arbiter",
  clipper1: "Clipper 1",
  clipper2: "Clipper 2",
  clipper3: "Clipper 3",
};

/** Mock mode only: picks which role you browse as while no wallet is connected. */
export function MockRoleSwitcher() {
  const { mode, mockRole, setMockRole } = useApi();
  const { connected } = useWallet();
  if (mode !== "mock" || connected) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border-strong bg-surface py-1 pl-3 pr-1 text-xs shadow-float">
      <span className="label-mono text-[10px] text-muted">Mock</span>
      <select
        value={mockRole}
        onChange={(e) => setMockRole(e.target.value as MockRole)}
        aria-label="Mock role"
        className="h-8 rounded-full bg-surface-2 px-2.5 text-xs outline-none"
      >
        {MOCK_ROLES.map((r) => (
          <option key={r} value={r}>
            {LABELS[r]} · {shortAddress(MOCK_ACCOUNTS[r])}
          </option>
        ))}
      </select>
    </div>
  );
}
