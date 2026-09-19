"use client";

import { createTryRamp, defaultTryAnchorHomeDomain, type TryRamp } from "@cliprail/client";
import { useMemo, useRef } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { API_MODE } from "./config";

/** TL ⇄ USDC anchor'ının home domain'i (env yoksa etkinliğin TR mock anchor'ı) */
export const ANCHOR_HOME_DOMAIN = defaultTryAnchorHomeDomain();

/**
 * TL yatır / TL'ye çek işlemleri (SEP-6 + SEP-10 + SEP-12 + SEP-38). Chain modda cüzdan imzalar,
 * mock modda anında ve çevrimdışı tamamlanır.
 */
export function useTryRamp(): TryRamp {
  const wallet = useWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  return useMemo(
    () =>
      createTryRamp(API_MODE, {
        homeDomain: ANCHOR_HOME_DOMAIN,
        signer: { signTransaction: (xdr, opts) => walletRef.current.signTransaction(xdr, opts) },
        // mock: adımlar okunabilsin diye küçük gecikme
        stepDelayMs: API_MODE === "mock" ? 500 : 0,
      }),
    [],
  );
}
