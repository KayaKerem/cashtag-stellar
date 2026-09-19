import type { CliprailApi } from "@cliprail/shared";
import { createChainApi, type ChainApiOptions } from "./chain";
import { createMockApi, type MockApiOptions } from "./mock";

export * from "./chain";
export * from "./mock";
export * from "./errors";
export * from "./proof";
export * from "./token";
export * from "./anchor";
export * from "./humanity-zk";
export * from "./swap";
export { runWrite, isRetryable, simulatedResult, unwrapResult, mapLimit, type TxLike, type WriteResult } from "./tx";
export type { CliprailApi } from "@cliprail/shared";

export function createApi(mode: "mock", opts?: MockApiOptions): CliprailApi;
export function createApi(mode: "chain", opts: ChainApiOptions): CliprailApi;
export function createApi(mode: "mock" | "chain", opts?: MockApiOptions | ChainApiOptions): CliprailApi {
  if (mode === "chain") return createChainApi(opts as ChainApiOptions);
  return createMockApi(opts as MockApiOptions | undefined);
}
