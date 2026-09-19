import { describe, expect, it } from "vitest";
import { explorerAddressUrl, explorerTxUrl, formatUsdc, parseUsdc, shortAddress } from "../src";

describe("usdc", () => {
  it("formats", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(10_000_000n)).toBe("1.00");
    expect(formatUsdc(48_000_000n)).toBe("4.80");
    expect(formatUsdc(1n)).toBe("0.0000001");
    expect(formatUsdc(1n, { maxDecimals: 2 })).toBe("0.00");
    expect(formatUsdc(-15_000_000n)).toBe("-1.50");
    expect(formatUsdc(12_345_678_900_000n, { group: ",", minDecimals: 0 })).toBe("1,234,567.89");
    expect(formatUsdc(10_000_000n, { minDecimals: 0 })).toBe("1");
  });

  it("parses", () => {
    expect(parseUsdc("1")).toBe(10_000_000n);
    expect(parseUsdc("4.8")).toBe(48_000_000n);
    expect(parseUsdc("4,8")).toBe(48_000_000n);
    expect(parseUsdc(".5")).toBe(5_000_000n);
    expect(parseUsdc(" 1 000.25 ")).toBe(10_002_500_000n);
    expect(parseUsdc("0.0000001")).toBe(1n);
    expect(() => parseUsdc("0.00000001")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
    expect(() => parseUsdc("")).toThrow();
    expect(() => parseUsdc("1.2.3")).toThrow();
  });

  it("round-trips", () => {
    for (const v of [0n, 1n, 9_999_999n, 10_000_000n, 123_456_789_012n, -7n, 10n ** 20n + 3n]) {
      expect(parseUsdc(formatUsdc(v))).toBe(v);
    }
  });
});

describe("addresses", () => {
  it("shortens and links", () => {
    const g = "GCSGHUFTYKX43X37ISY5BFETSRBGFYPZ4KTRFJSLOWNZK5DYEQNGFKCS";
    expect(shortAddress(g)).toBe("GCSG…FKCS");
    expect(shortAddress("abc")).toBe("abc");
    expect(explorerTxUrl("ab12")).toBe("https://stellar.expert/explorer/testnet/tx/ab12");
    expect(explorerAddressUrl(g)).toBe(`https://stellar.expert/explorer/testnet/account/${g}`);
    expect(explorerAddressUrl("CCRC")).toBe("https://stellar.expert/explorer/testnet/contract/CCRC");
  });
});
