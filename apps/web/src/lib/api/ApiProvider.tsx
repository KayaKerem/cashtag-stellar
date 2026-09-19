"use client";

import { MOCK_ACCOUNTS, createApi } from "@cliprail/client";
import type { CliprailApi } from "@cliprail/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { API_MODE, CHAIN_CONFIG, type ApiMode } from "./config";

export type MockRole = keyof typeof MOCK_ACCOUNTS;
export const MOCK_ROLES = Object.keys(MOCK_ACCOUNTS) as MockRole[];
const ROLE_KEY = "cliprail.mockRole";

interface ApiContextValue {
  api: CliprailApi;
  mode: ApiMode;
  /** İşlemleri imzalayan hesap: chain'de bağlı cüzdan, mock'ta cüzdan ya da seçili rol */
  account: string | null;
  mockRole: MockRole;
  setMockRole(role: MockRole): void;
}

const ApiContext = createContext<ApiContextValue | null>(null);

// Query key'lerinde bigint var; varsayılan hash JSON.stringify ile bigint'te patlar
function hashKey(key: readonly unknown[]): string {
  return JSON.stringify(key, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [mockRole, setMockRoleState] = useState<MockRole>("clipper1");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROLE_KEY) as MockRole | null;
      if (saved && saved in MOCK_ACCOUNTS) setMockRoleState(saved);
    } catch {}
  }, []);

  const account =
    API_MODE === "chain" ? wallet.address : (wallet.address ?? MOCK_ACCOUNTS[mockRole]);

  // Mock API'nin "bağlı hesap"ı her çağrıda buradan okunur; API'yi yeniden kurmaya gerek yok
  const accountRef = useRef(account);
  accountRef.current = account;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const api = useMemo<CliprailApi>(() => {
    if (API_MODE === "chain") {
      return createApi("chain", {
        ...CHAIN_CONFIG,
        signer: {
          getAddress: () => walletRef.current.getAddress(),
          signTransaction: (xdr, opts) => walletRef.current.signTransaction(xdr, opts),
        },
      });
    }
    return createApi("mock", { address: () => accountRef.current ?? MOCK_ACCOUNTS.clipper1 });
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { queryKeyHashFn: hashKey, staleTime: 3_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  // Hesap değişince hesaba bağlı sorgular (katılım, insanlık) yenilensin
  useEffect(() => {
    queryClient.invalidateQueries();
  }, [account, queryClient]);

  const value = useMemo<ApiContextValue>(
    () => ({
      api,
      mode: API_MODE,
      account,
      mockRole,
      setMockRole(role) {
        setMockRoleState(role);
        try {
          localStorage.setItem(ROLE_KEY, role);
        } catch {}
      },
    }),
    [api, account, mockRole],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi, ApiProvider içinde kullanılmalı");
  return ctx;
}
