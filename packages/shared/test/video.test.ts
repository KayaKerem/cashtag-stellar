import { describe, expect, it } from "vitest";
import { parseVideoLink } from "../src";

const ID = "dQw4w9WgXcQ";

describe("youtube", () => {
  const ok = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}?autoplay=1`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  www.youtube.com/watch?v=${ID}  `,
    "https://youtube.com/shorts/a-B_c123456",
  ];
  for (const input of ok) {
    it(`accepts ${input.trim()}`, () => {
      const r = parseVideoLink("youtube", input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.id).toHaveLength(11);
    });
  }

  const bad = [
    "",
    "dQw4w9WgXc", // 10 chars
    "https://www.youtube.com/watch?v=dQw4w9WgXc!",
    "https://vimeo.com/123456789",
    "https://www.youtube.com/channel/UC123",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
  ];
  for (const input of bad) {
    it(`rejects "${input}"`, () => {
      const r = parseVideoLink("youtube", input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    });
  }

  it("extracts the exact id", () => {
    expect(parseVideoLink("youtube", `https://youtu.be/${ID}?t=1`)).toEqual({ ok: true, id: ID });
  });
});

describe("demo", () => {
  it("accepts valid ids and demo URLs", () => {
    expect(parseVideoLink("demo", "launch-1")).toEqual({ ok: true, id: "launch-1" });
    expect(parseVideoLink("demo", "http://localhost:8787/demo/videos/clip-7")).toEqual({ ok: true, id: "clip-7" });
  });
  it("rejects invalid ids", () => {
    expect(parseVideoLink("demo", "Launch").ok).toBe(false);
    expect(parseVideoLink("demo", "a".repeat(33)).ok).toBe(false);
    expect(parseVideoLink("demo", "a_b").ok).toBe(false);
  });
  it("rejects unknown platforms", () => {
    expect(parseVideoLink("tiktok", "x").ok).toBe(false);
  });
});
