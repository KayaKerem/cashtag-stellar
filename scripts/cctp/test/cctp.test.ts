// The encoding here is the fund-loss surface of the whole bridge: a wrong byte in hookData or in
// the 32-byte mintRecipient strands USDC with no recovery path. These cases pin the exact layout
// Circle's reference builder produces.
import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  bytes32ToContractStrkey,
  buildCctpForwarderHookData,
  contractStrkeyToBytes32,
  fmt6,
  fmt7,
  isValidForwardRecipient,
  maxFeeFromBps,
  normalizeTxHash,
  parseCctpForwarderHookData,
  parseUsdc6,
  units6to7,
} from "../cctp.ts";
import { STELLAR } from "../config.ts";

const FORWARDER = STELLAR.cctpForwarder; // CA66Q2WF… (testnet)
const ACCOUNT = "GCSGHUFTYKX43X37ISY5BFETSRBGFYPZ4KTRFJSLOWNZK5DYEQNGFKCS";

describe("contractStrkeyToBytes32", () => {
  it("decodes a C… strkey to exactly 32 bytes", () => {
    const hex = contractStrkeyToBytes32(FORWARDER);
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Buffer.from(hex.slice(2), "hex")).toHaveLength(32);
  });

  it("round-trips back to the same strkey", () => {
    expect(bytes32ToContractStrkey(contractStrkeyToBytes32(FORWARDER))).toBe(FORWARDER);
  });

  it("matches StrKey.decodeContract byte for byte", () => {
    expect(contractStrkeyToBytes32(FORWARDER).slice(2)).toBe(Buffer.from(StrKey.decodeContract(FORWARDER)).toString("hex"));
  });

  it("refuses a G… account — a user account can never be a CCTP mintRecipient", () => {
    expect(() => contractStrkeyToBytes32(ACCOUNT)).toThrow(/not a contract strkey/);
  });
});

describe("buildCctpForwarderHookData", () => {
  it("lays out 24 zero magic bytes, version 0, length, then the strkey as UTF-8", () => {
    const hex = buildCctpForwarderHookData(ACCOUNT).slice(2);
    expect(hex.slice(0, 48)).toBe("0".repeat(48)); // bytes 0–23: magic
    expect(hex.slice(48, 56)).toBe("00000000"); // bytes 24–27: version, big-endian
    expect(hex.slice(56, 64)).toBe("00000038"); // bytes 28–31: length 56, big-endian
    expect(Buffer.from(hex.slice(64), "hex").toString("utf8")).toBe(ACCOUNT);
    expect(hex.length / 2).toBe(88); // 32 header + 56 strkey, no padding
  });

  it("is byte-identical to Circle's reference builder", () => {
    // Independent re-implementation of examples/stellar-utils.ts buildCctpForwarderHookData.
    const recipientBytes = Buffer.from(ACCOUNT, "utf8");
    const expected = Buffer.alloc(32 + recipientBytes.length);
    expected.writeUInt32BE(0, 24);
    expected.writeUInt32BE(recipientBytes.length, 28);
    recipientBytes.copy(expected, 32);
    expect(buildCctpForwarderHookData(ACCOUNT)).toBe(`0x${expected.toString("hex")}`);
  });

  it("accepts a C… contract recipient too", () => {
    const parsed = parseCctpForwarderHookData(buildCctpForwarderHookData(FORWARDER));
    expect(parsed.recipient).toBe(FORWARDER);
    expect(parsed.version).toBe(0);
  });

  it("rejects anything that is not a Stellar address", () => {
    for (const bad of ["", "0x1234", "GCSGHUFT", ACCOUNT.toLowerCase(), `${ACCOUNT}X`]) {
      expect(() => buildCctpForwarderHookData(bad)).toThrow(/invalid forward recipient/);
    }
  });

  it("round-trips through the parser with no trailing payload", () => {
    const parsed = parseCctpForwarderHookData(buildCctpForwarderHookData(ACCOUNT));
    expect(parsed).toMatchObject({ version: 0, recipient: ACCOUNT });
    expect(parsed.extra).toHaveLength(0);
  });

  it("refuses hook data whose magic is not the 24 zero bytes Stellar expects", () => {
    const hex = buildCctpForwarderHookData(ACCOUNT).slice(2);
    expect(() => parseCctpForwarderHookData(`0xff${hex.slice(2)}`)).toThrow(/magic/);
  });
});

describe("isValidForwardRecipient", () => {
  it("accepts G…, C… and M… addresses", () => {
    expect(isValidForwardRecipient(ACCOUNT)).toBe(true);
    expect(isValidForwardRecipient(FORWARDER)).toBe(true);
    expect(isValidForwardRecipient(StrKey.encodeMed25519PublicKey(Buffer.concat([StrKey.decodeEd25519PublicKey(ACCOUNT), Buffer.alloc(8)])))).toBe(true);
  });

  it("rejects an EVM address", () => {
    expect(isValidForwardRecipient("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA")).toBe(false);
  });
});

describe("amounts", () => {
  it("parses USDC as 6-decimal units without going through a float", () => {
    expect(parseUsdc6("1")).toBe(1_000_000n);
    expect(parseUsdc6("5")).toBe(5_000_000n);
    expect(parseUsdc6("0.000001")).toBe(1n);
    expect(parseUsdc6("20.123456")).toBe(20_123_456n);
    expect(parseUsdc6("0.1")).toBe(100_000n);
  });

  it("rejects more precision than USDC has off Stellar", () => {
    expect(() => parseUsdc6("1.1234567")).toThrow(/6 decimals/);
    expect(() => parseUsdc6("abc")).toThrow(/invalid USDC amount/);
    expect(() => parseUsdc6("-1")).toThrow(/invalid USDC amount/);
  });

  it("scales a 6-decimal message amount to the 7-decimal amount Stellar mints", () => {
    expect(units6to7(1_000_000n)).toBe(10_000_000n); // 1 USDC
    expect(units6to7(123_456n)).toBe(1_234_560n); // the doc's worked example
  });

  it("formats both precisions without trailing zeros", () => {
    expect(fmt6(1_000_000n)).toBe("1");
    expect(fmt6(123_456n)).toBe("0.123456");
    expect(fmt7(10_000_000n)).toBe("1");
    expect(fmt7(1_234_560n)).toBe("0.123456");
  });
});

describe("maxFeeFromBps", () => {
  it("is zero on a 0 bps route (Arc → Stellar)", () => {
    expect(maxFeeFromBps(1_000_000n, 0)).toBe(0n);
  });

  it("covers the quoted bps plus a cushion and always rounds up", () => {
    // Base Sepolia → Stellar fast is 1.3 bps; +1 bps cushion on 1 USDC.
    expect(maxFeeFromBps(1_000_000n, 1.3)).toBe(230n);
    expect(maxFeeFromBps(1n, 1.3)).toBe(1n);
    expect(maxFeeFromBps(5_000_000n, 1.3)).toBe(1_150n);
  });
});

describe("normalizeTxHash", () => {
  it("lowercases hex hashes", () => {
    expect(normalizeTxHash("0xAbCdEf01")).toBe("0xabcdef01");
  });

  it("leaves a base58 signature alone — lowercasing one 404s Iris forever", () => {
    const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    expect(normalizeTxHash(sig)).toBe(sig);
  });
});
