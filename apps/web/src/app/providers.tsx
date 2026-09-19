"use client";

import { ToastProvider } from "@/components/common/Toast";
import { MockRoleSwitcher } from "@/components/dev/MockRoleSwitcher";
import { NetworkWarning } from "@/components/wallet/NetworkWarning";
import { ApiProvider } from "@/lib/api/ApiProvider";
import { WalletProvider } from "@/lib/wallet/WalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ApiProvider>
        <ToastProvider>
          <NetworkWarning />
          {children}
          <MockRoleSwitcher />
        </ToastProvider>
      </ApiProvider>
    </WalletProvider>
  );
}
