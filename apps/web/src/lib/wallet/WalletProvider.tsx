"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;

export interface WalletState {
  /** Kit yüklendi ve kayıtlı oturum okundu */
  ready: boolean;
  address: string | null;
  connected: boolean;
  /** Cüzdanın bildirdiği ağ; bilinmiyorsa null */
  networkPassphrase: string | null;
  isTestnet: boolean;
  connect(): Promise<string | null>;
  disconnect(): Promise<void>;
  /** @cliprail/client Signer ile aynı imza */
  signTransaction(xdr: string, opts: { networkPassphrase: string; address?: string }): Promise<{ signedTxXdr: string }>;
  getAddress(): Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

async function loadKit(): Promise<Kit> {
  const [{ StellarWalletsKit, Networks }, { defaultModules }] = await Promise.all([
    import("@creit.tech/stellar-wallets-kit"),
    import("@creit.tech/stellar-wallets-kit/modules/utils"),
  ]);
  StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET });
  return StellarWalletsKit;
}

let kitPromise: Promise<Kit> | null = null;
const getKit = () => (kitPromise ??= loadKit());

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null);
  const kitRef = useRef<Kit | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const kit = await getKit();
      if (cancelled) return;
      kitRef.current = kit;
      const { KitEventType } = await import("@creit.tech/stellar-wallets-kit/types");
      // STATE_UPDATED açılışta da tetiklenir: kayıtlı adres ve ağ buradan gelir
      off = kit.on(KitEventType.STATE_UPDATED, (e) => {
        setAddress(e.payload.address ?? null);
        setNetworkPassphrase(e.payload.networkPassphrase ?? null);
      });
      try {
        const { address: a } = await kit.getAddress();
        if (!cancelled && a) setAddress(a);
      } catch {
        // bağlı cüzdan yok
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const connect = useCallback(async () => {
    const kit = await getKit();
    try {
      const { address: a } = await kit.authModal();
      setAddress(a);
      try {
        const net = await kit.getNetwork();
        setNetworkPassphrase(net.networkPassphrase);
      } catch {
        // bazı cüzdanlar ağ bilgisini vermiyor
      }
      return a;
    } catch (e) {
      // code -1: kullanıcı modalı kapattı; diğerleri gerçek cüzdan hatası
      if ((e as { code?: number })?.code !== -1) console.warn("Cüzdan bağlanamadı", e);
      return null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const kit = await getKit();
    await kit.disconnect();
    setAddress(null);
    setNetworkPassphrase(null);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string, opts: { networkPassphrase: string; address?: string }) => {
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, opts);
      return { signedTxXdr };
    },
    [],
  );

  const getAddress = useCallback(async () => {
    const kit = await getKit();
    const { address: a } = await kit.getAddress();
    if (!a) throw new Error("Cüzdan bağlı değil");
    return a;
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      ready,
      address,
      connected: !!address,
      networkPassphrase,
      isTestnet: networkPassphrase === null || networkPassphrase === TESTNET_PASSPHRASE,
      connect,
      disconnect,
      signTransaction,
      getAddress,
    }),
    [ready, address, networkPassphrase, connect, disconnect, signTransaction, getAddress],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet, WalletProvider içinde kullanılmalı");
  return ctx;
}
