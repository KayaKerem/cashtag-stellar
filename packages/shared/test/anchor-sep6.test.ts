import { describe, expect, it } from "vitest";
import {
  ANCHOR_ERROR_MESSAGES,
  ANCHOR_RAMP_STEP_LABELS,
  SEP6_STATUS_LABELS,
  anchorErrorMessage,
  formatTry,
  formatTryRate,
  isSep6Final,
  sep12StatusLabel,
  sep6StatusLabel,
} from "../src";

describe("SEP-6 labels", () => {
  it("uses direction-specific wording and falls back to generic labels", () => {
    expect(sep6StatusLabel("pending_user_transfer_start", "deposit")).toBe("Waiting for the bank transfer");
    expect(sep6StatusLabel("pending_user_transfer_start", "withdrawal")).toBe("Waiting for your USDC payment");
    expect(sep6StatusLabel("completed", "deposit-exchange")).toBe("USDC arrived in your account");
    expect(sep6StatusLabel("pending_customer_info_update", "deposit")).toBe(SEP6_STATUS_LABELS.pending_customer_info_update);
    expect(sep6StatusLabel("on_hold")).toBe(SEP6_STATUS_LABELS.on_hold);
    expect(sep6StatusLabel("weird", "deposit")).toBe("weird");
    expect(isSep6Final("completed")).toBe(true);
    expect(isSep6Final("pending_trust")).toBe(false);
  });

  it("labels KYC, steps and new error codes", () => {
    expect(sep12StatusLabel("ACCEPTED")).toBe("Identity verified");
    expect(sep12StatusLabel("X")).toBe("X");
    expect(Object.keys(ANCHOR_RAMP_STEP_LABELS)).toContain("bank_transfer");
    expect(anchorErrorMessage("anchor_quote_failed")).toBe(ANCHOR_ERROR_MESSAGES.anchor_quote_failed);
    expect(ANCHOR_ERROR_MESSAGES.anchor_sep6_unsupported).toMatch(/SEP-6/);
  });

  it("formats TRY amounts and rates", () => {
    expect(formatTry("5000")).toBe("5,000.00 TRY");
    expect(formatTry(242.7, { symbol: false })).toBe("242.70");
    expect(formatTryRate("49.0279570")).toBe("1 USDC = 49.028 TRY");
    expect(formatTry("abc")).toBe("abc");
  });
});
