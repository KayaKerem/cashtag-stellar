"use client";

import { useWallet } from "@/lib/wallet/WalletProvider";

/** Shows a banner at the top of the page when the connected wallet is not on testnet. */
export function NetworkWarning() {
  const { connected, isTestnet } = useWallet();
  if (!connected || isTestnet) return null;
  return (
    <div role="alert" className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-center text-sm text-warning">
      Your wallet is connected to a network other than testnet. ClipRail only runs on <strong>Stellar testnet</strong>;
      switch the network to Testnet in your wallet settings.
    </div>
  );
}
