import { describe, expect, it } from "vitest";
import {
  CLIPRAIL_ERRORS,
  TOKEN_ERROR_MESSAGES,
  errorMessage,
  insufficientBalanceMessage,
  parseContractError,
  tokenErrorCode,
  userMessage,
} from "../src";

describe("errors", () => {
  it("covers codes 1..35", () => {
    for (let i = 1; i <= 35; i++) expect(CLIPRAIL_ERRORS[i]?.message).toBeTruthy();
    expect(CLIPRAIL_ERRORS[19]!.name).toBe("ProofReused");
    expect(CLIPRAIL_ERRORS[35]!.name).toBe("ProofTooLarge");
  });

  it("parses host error strings", () => {
    const msg = 'HostError: Error(Contract, #19)\n\nEvent log (newest first):\n 0: [Diagnostic Event] ...';
    expect(parseContractError(msg)).toMatchObject({ source: "cliprail", code: 19, name: "ProofReused" });
    expect(parseContractError(new Error("simulation failed: Error(Contract, #8)"))?.name).toBe("WrongPhase");
  });

  it("parses verifier bodies", () => {
    expect(parseContractError({ error: "contract error #19 ProofReused", code: "contract_19" })?.code).toBe(19);
    expect(parseContractError({ code: "humanity_2" })).toMatchObject({ source: "humanity", name: "NullifierUsed" });
    expect(parseContractError({ code: "contract_3" }, "humanity")?.name).toBe("WalletRegistered");
    expect(parseContractError({ error: "not found", code: "chain_error" })).toBeNull();
  });

  it("parses nested causes and plain numbers", () => {
    expect(parseContractError({ cause: { message: "Error(Contract, #24)" } })?.name).toBe("OpenDisputes");
    expect(parseContractError(7)?.name).toBe("NotHuman");
  });

  it("user messages", () => {
    expect(userMessage("Error(Contract, #26)")).toBe("Alınacak ödeme yok.");
    expect(userMessage(new Error("User declined access"))).toBe("İşlem cüzdanda reddedildi.");
    expect(userMessage(42)).toMatch(/Beklenmeyen/);
    expect(errorMessage(99)).toMatch(/#99/);
  });

  it("token (USDC) error messages", () => {
    expect(insufficientBalanceMessage(100_000_000n, 25_000_000n)).toBe("USDC bakiyesi yetersiz: gereken 10.00, mevcut 2.50");
    expect(userMessage("no_trustline")).toBe("Hesabın USDC trustline'ı yok");
    expect(userMessage({ code: "insufficient_balance", message: "USDC bakiyesi yetersiz: gereken 1.00, mevcut 0.00" })).toMatch(/gereken 1\.00/);
    expect(userMessage({ code: "token_error" })).toBe(TOKEN_ERROR_MESSAGES.token_error);
    expect(tokenErrorCode(10)).toBe("insufficient_balance");
    expect(tokenErrorCode(13)).toBe("no_trustline");
    expect(tokenErrorCode(9)).toBe("token_error");
  });
});
