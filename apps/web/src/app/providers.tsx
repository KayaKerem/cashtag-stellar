"use client";

import { NetworkWarning } from "@/components/wallet/NetworkWarning";
import { WalletProvider } from "@/lib/wallet/WalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <NetworkWarning />
      {children}
    </WalletProvider>
  );
}
