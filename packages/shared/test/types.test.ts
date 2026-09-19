import { describe, expect, it } from "vitest";
import { normalizeClipView, normalizeDispute, normalizeEnum, normalizeOption } from "../src";

describe("normalize", () => {
  it("enum shapes", () => {
    expect(normalizeEnum({ tag: "Active", values: undefined })).toBe("Active");
    expect(normalizeEnum(["Excluded"])).toBe("Excluded");
    expect(normalizeEnum("Open", ["Open", "Responded"] as const)).toBe("Open");
    expect(() => normalizeEnum({ tag: "Nope" }, ["Open"] as const)).toThrow();
  });
  it("options", () => {
    expect(normalizeOption(undefined)).toBeNull();
    expect(normalizeOption({ tag: "None" })).toBeNull();
    expect(normalizeOption({ tag: "Some", values: [5] })).toBe(5);
  });
  it("binding-shaped ClipView and Dispute", () => {
    const cv = normalizeClipView({
      clip: { id: 1n, campaign_id: 1n, owner: "G", platform: "youtube", video_id: "x", baseline: 0n, hwm: 5n, registered_at: 9n, first_epoch: 0 },
      epochs: [
        { baseline: 0n, views: 5n, weight: 0n, status: { tag: "Challenged" }, claimed: false, alive: true, holdback_claimed: false },
        undefined,
      ],
    });
    expect(cv.epochs[0]?.status).toBe("Challenged");
    expect(cv.epochs[1]).toBeNull();
    const d = normalizeDispute({ id: 2, campaign_id: 1, clip_id: 1, epoch: 0, challenger: "G", evidence: "e", status: ["ClipperWon"], opened_at: 7 });
    expect(d).toMatchObject({ id: 2n, status: "ClipperWon", opened_at: 7n });
  });
});
