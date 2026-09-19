"use client";

import { useWallet } from "@/lib/wallet/WalletProvider";

/** Bağlı cüzdan testnet dışındaysa sayfanın üstünde uyarı gösterir. */
export function NetworkWarning() {
  const { connected, isTestnet } = useWallet();
  if (!connected || isTestnet) return null;
  return (
    <div role="alert" className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-center text-sm text-warning">
      Cüzdanın testnet dışında bir ağa bağlı. ClipRail yalnızca <strong>Stellar testnet</strong> üzerinde çalışır;
      cüzdan ayarlarından ağı Testnet olarak değiştir.
    </div>
  );
}
