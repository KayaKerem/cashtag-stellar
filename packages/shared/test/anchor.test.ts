import { describe, expect, it } from "vitest";
import { ANCHOR_ERROR_MESSAGES, SEP24_STATUS_LABELS, anchorErrorMessage, isAnchorErrorCode, isSep24Final, sep24StatusLabel } from "../src";

describe("anchor messages", () => {
  it("has a Turkish message for every code", () => {
    for (const m of Object.values(ANCHOR_ERROR_MESSAGES)) expect(m.length).toBeGreaterThan(5);
    expect(isAnchorErrorCode("anchor_timeout")).toBe(true);
    expect(isAnchorErrorCode("nope")).toBe(false);
  });

  it("appends anchor detail", () => {
    expect(anchorErrorMessage("anchor_request_failed", "asset not supported")).toBe("The anchor rejected the request. (asset not supported)");
    expect(anchorErrorMessage("anchor_timeout")).toBe(ANCHOR_ERROR_MESSAGES.anchor_timeout);
  });

  it("labels statuses and final states", () => {
    expect(sep24StatusLabel("completed")).toBe(SEP24_STATUS_LABELS.completed);
    expect(sep24StatusLabel("weird")).toBe("weird");
    expect(isSep24Final("completed")).toBe(true);
    expect(isSep24Final("pending_anchor")).toBe(false);
  });
});
