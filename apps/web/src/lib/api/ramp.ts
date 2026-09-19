"use client";

import { createTryRamp, defaultTryAnchorHomeDomain, type TryRamp } from "@cliprail/client";
import { useMemo, useRef } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { API_MODE } from "./config";

/** Home domain of the TRY <-> USDC anchor (falls back to the event TR mock anchor) */
export const ANCHOR_HOME_DOMAIN = defaultTryAnchorHomeDomain();

/**
 * Deposit TRY / withdraw to TRY (SEP-6 + SEP-10 + SEP-12 + SEP-38). In chain mode the wallet signs;
 * in mock mode it completes instantly and offline.
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
        // mock: a small delay so the steps stay readable
        stepDelayMs: API_MODE === "mock" ? 500 : 0,
      }),
    [],
  );
}
