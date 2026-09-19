import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { createApp, parseDemoRegisterReq, parseId, parseProofReq, parseSubmitReq } from "../src/app.js";
import { DemoStore } from "../src/demo.js";
import { ProofService, proofUrl, secretOptions } from "../src/zkfetch.js";
import { toProofJson } from "../src/proof.js";
import { ProofCache } from "../src/cache.js";
import { makeProof, TEST_ATTESTOR } from "./helpers.js";

const tmp = mkdtempSync(join(tmpdir(), "verifier-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const baseCfg = {
  ...config,
  reclaimAppId: "",
  reclaimAppSecret: "",
  ytApiKey: "",
  relayerSecret: "",
  cliprailId: "CCLIPRAIL",
  humanityId: "CHUMANITY",
  demoPublicBase: "https://verifier.example",
  demoMode: false,
  dataDir: join(tmp, "data"),
  proofFixtureDir: "",
};

function mk(cfgOver: Partial<typeof baseCfg> = {}) {
  const cfg = { ...baseCfg, ...cfgOver };
  const demo = new DemoStore(join(tmp, `demo-${Math.random()}.json`));
  const proofs = new ProofService(cfg);
  const ops = {
    submitClose: vi.fn(async () => ({ txHash: "ab".repeat(32), views: "10" })),
    demoRegister: vi.fn(async () => ({ txHash: "cd".repeat(32) })),
  };
  return { app: createApp({ cfg, demo, proofs, ops }), ops, demo };
}
const post = (app: any, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("health", () => {
  it("returns ids", async () => {
    const r = await mk().app.request("/health");
    expect(await r.json()).toEqual({ ok: true, network: "testnet", cliprailId: "CCLIPRAIL", humanityId: "CHUMANITY" });
  });
});

describe("demo endpoints", () => {
  it("unknown video -> empty items", async () => {
    const r = await mk().app.request("/demo/videos/nope");
    expect(r.status).toBe(200);
    expect((await r.json()).items).toEqual([]);
  });

  it("bump + YouTube videos.list shape", async () => {
    const { app } = mk();
    let r = await post(app, "/demo/videos/vid1/bump", { views: 100, desc: 'my clip CR-ABC123 "q"' });
    expect(await r.json()).toEqual({ id: "vid1", views: 100, desc: 'my clip CR-ABC123 "q"' });
    r = await post(app, "/demo/videos/vid1/bump", { delta: 25 });
    expect((await r.json()).views).toBe(125);
    r = await app.request("/demo/videos/vid1");
    const j = await r.json();
    expect(j.items).toEqual([{ kind: "youtube#video", id: "vid1", snippet: { description: 'my clip CR-ABC123 "q"' }, statistics: { viewCount: "125" } }]);
    // regexes from providers.json must match our body
    const text = JSON.stringify(j);
    expect(text).toMatch(new RegExp('"viewCount":\\s*"(?<views>\\d+)"'));
    const m = new RegExp('"description":\\s*"(?<desc>(?:[^"\\\\]|\\\\.)*)"').exec(text);
    expect(m?.groups?.desc).toBe('my clip CR-ABC123 \\"q\\"');
  });

  it("views + delta in one call: set then add", async () => {
    const { app } = mk();
    const r = await post(app, "/demo/videos/v2/bump", { views: 10, delta: 5 });
    expect((await r.json()).views).toBe(15);
  });

  it("rejects bad input", async () => {
    const { app } = mk();
    expect((await post(app, "/demo/videos/v3/bump", { views: -1 })).status).toBe(400);
    expect((await post(app, "/demo/videos/v3/bump", { views: 1.5 })).status).toBe(400);
    expect((await post(app, "/demo/videos/v3/bump", { delta: -5 })).status).toBe(400); // would go negative
    expect((await post(app, "/demo/videos/BAD_ID/bump", { views: 1 })).status).toBe(400);
    expect((await app.request("/demo/videos/BAD_ID")).status).toBe(400);
  });

  it("persists state to disk", () => {
    const path = join(tmp, "persist.json");
    new DemoStore(path).bump("pv", { views: 7, desc: "x" });
    expect(new DemoStore(path).youtubeShape("pv").items[0].statistics.viewCount).toBe("7");
  });
});

describe("/proof", () => {
  it("503 when reclaim credentials are missing", async () => {
    const r = await post(mk().app, "/proof", { platform: "demo", videoId: "vid1" });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "reclaim credentials missing", code: "no_credentials" });
  });

  it("400 on bad request", async () => {
    const { app } = mk();
    expect((await post(app, "/proof", { platform: "tiktok", videoId: "x" })).status).toBe(400);
    expect((await post(app, "/proof", { platform: "youtube", videoId: "short" })).status).toBe(400);
    expect((await app.request("/proof", { method: "POST", body: "{nope" })).status).toBe(400);
  });

  it("replays from PROOF_FIXTURE_DIR", async () => {
    const dir = join(tmp, "fixtures");
    const raw = makeProof({ views: "555" });
    new ProofCache(dir).save("demo", "vid1", raw);
    const r = await post(mk({ proofFixtureDir: dir }).app, "/proof", { platform: "demo", videoId: "vid1" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ proof: toProofJson(raw), extracted: { views: "555", desc: raw.extractedParameterValues!.desc }, cached: true });
  });

  it("?cached=1 returns the newest cached proof", async () => {
    const cfg = { ...baseCfg, dataDir: join(tmp, "data2") };
    const cache = new ProofCache(join(cfg.dataDir, "cache"));
    cache.save("demo", "vc", makeProof({ views: "1", timestampS: 100 }));
    cache.save("demo", "vc", makeProof({ views: "2", timestampS: 200 }));
    const r = await post(mk(cfg).app, "/proof?cached=1", { platform: "demo", videoId: "vc" });
    expect((await r.json()).extracted.views).toBe("2");
  });
});

describe("/proof/submit", () => {
  it("calls submitClose with parsed ids", async () => {
    const { app, ops } = mk();
    const r = await post(app, "/proof/submit", { campaignId: "1", clipId: 2, epoch: 0, kind: "close" });
    expect(r.status).toBe(200);
    expect(ops.submitClose).toHaveBeenCalledWith(1n, 2n, 0);
    expect(await r.json()).toEqual({ txHash: "ab".repeat(32), views: "10" });
  });
  it("rejects kind alive and bad epoch", async () => {
    const { app } = mk();
    expect((await post(app, "/proof/submit", { campaignId: 1, clipId: 1, epoch: 0, kind: "alive" })).status).toBe(400);
    expect((await post(app, "/proof/submit", { campaignId: 1, clipId: 1, epoch: -1 })).status).toBe(400);
  });
});

describe("/humanity/demo-register", () => {
  it("403 unless DEMO_MODE=1", async () => {
    expect((await post(mk().app, "/humanity/demo-register", { campaignId: 1, wallet: "G..." })).status).toBe(403);
  });
  it("works in demo mode", async () => {
    const { app, ops } = mk({ demoMode: true });
    const r = await post(app, "/humanity/demo-register", { campaignId: 3, wallet: "GABC" });
    expect(r.status).toBe(200);
    expect(ops.demoRegister).toHaveBeenCalledWith(3n, "GABC");
  });
});

describe("validators", () => {
  it("parseId", () => {
    expect(parseId(5, "x")).toBe(5n);
    expect(parseId("18446744073709551615", "x")).toBe(18446744073709551615n);
    expect(() => parseId(-1, "x")).toThrow();
    expect(() => parseId("1e3", "x")).toThrow();
  });
  it("parsers", () => {
    expect(parseProofReq({ platform: "demo", videoId: "a" })).toEqual({ platform: "demo", videoId: "a" });
    expect(() => parseProofReq(null)).toThrow();
    expect(() => parseSubmitReq({ campaignId: 1, clipId: 1 })).toThrow();
    expect(() => parseDemoRegisterReq({ campaignId: 1 })).toThrow();
  });
});

describe("zkFetch request building", () => {
  it("demo url uses DEMO_PUBLIC_BASE", () => {
    expect(proofUrl("demo", "vid1", baseCfg)).toBe("https://verifier.example/demo/videos/vid1");
  });
  it("youtube url + secret header, redactions mirror matches", () => {
    expect(proofUrl("youtube", "dQw4w9WgXcQ", baseCfg)).toBe(
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ",
    );
    const s = secretOptions("youtube", { ...baseCfg, ytApiKey: "KEY" });
    expect(s.headers).toEqual({ "x-goog-api-key": "KEY" });
    expect(s.responseMatches.every((m) => Object.keys(m).sort().join() === "type,value")).toBe(true);
    expect(s.responseRedactions).toEqual(s.responseMatches.map((m) => ({ regex: m.value })));
    expect(() => secretOptions("youtube", baseCfg)).toThrow(/YT_API_KEY/);
  });
});

import { chainError } from "../src/chain.js";
describe("chainError", () => {
  it("maps contract error codes", () => {
    const e = chainError("HostError: Error(Contract, #8)", { names: { 8: "WrongPhase" }, prefix: "contract" });
    expect([e.status, e.code, e.message]).toEqual([409, "contract_8", "contract error #8 WrongPhase"]);
    expect(chainError("x Error(Contract, #2)", { names: {}, prefix: "humanity" }).code).toBe("humanity_2");
    expect(chainError("boom").code).toBe("chain_error");
  });
});

describe("abuse protection", () => {
  it("WRITE_TOKEN guards write endpoints", async () => {
    const { app } = mk({ writeToken: "s3cret", demoMode: true });
    expect((await post(app, "/demo/videos/a/bump", { views: 1 })).status).toBe(401);
    expect((await post(app, "/proof/submit", { campaignId: 1, clipId: 1, epoch: 0 })).status).toBe(401);
    expect((await post(app, "/humanity/demo-register", { campaignId: 1, wallet: "G" })).status).toBe(401);
    const ok = await app.request("/demo/videos/a/bump", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ views: 1 }),
    });
    expect(ok.status).toBe(200);
    expect((await app.request("/demo/videos/a")).status).toBe(200); // reads stay public
  });

  it("/proof is rate limited per IP (5/min)", async () => {
    const { app } = mk();
    const req = (ip: string) =>
      app.request("/proof", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ platform: "demo", videoId: "v" }),
      });
    for (let i = 0; i < 5; i++) expect((await req("1.1.1.1")).status).toBe(503);
    expect((await req("1.1.1.1")).status).toBe(429);
    expect((await req("2.2.2.2")).status).toBe(503);
  });

  it("demo caps", async () => {
    const { app, demo } = mk();
    expect((await post(app, "/demo/videos/c/bump", { views: 1_000_000_001 })).status).toBe(400);
    expect((await post(app, "/demo/videos/c/bump", { delta: 100_000_001 })).status).toBe(400);
    expect((await post(app, "/demo/videos/c/bump", { desc: "x".repeat(1001) })).status).toBe(400);
    for (let i = 0; i < 200; i++) demo.state.videos[`v${i}`] = { views: 0, desc: "" };
    expect((await post(app, "/demo/videos/new-one/bump", { views: 1 })).status).toBe(400);
    expect((await post(app, "/demo/videos/v1/bump", { views: 1 })).status).toBe(200); // existing still ok
  });
});

describe("ProofService fresh path", () => {
  const cfg = { ...baseCfg, reclaimAppId: "0xapp", reclaimAppSecret: "s", dataDir: join(tmp, "data3") };
  const url = "https://verifier.example/demo/videos/vid9";
  it("rejects an unknown attestor (and keeps the raw proof for inspection)", async () => {
    const svc = new ProofService({ ...cfg, attestors: ["0x244897572368eadf65bfbc5aec98d8e5443a9072"] }, () => {});
    (svc as any).zkFetch = async () => makeProof({ url });
    await expect(svc.get("demo", "vid9")).rejects.toMatchObject({ code: "unknown_attestor" });
  });
  it("accepts configured attestor, dedupes in-flight, reuses cache ≤ maxAge", async () => {
    const svc = new ProofService({ ...cfg, attestors: [TEST_ATTESTOR] }, () => {});
    const fetch = vi.fn(async () => makeProof({ url, timestampS: Math.floor(Date.now() / 1000) }));
    (svc as any).zkFetch = fetch;
    const [a, b] = await Promise.all([svc.get("demo", "vid9"), svc.get("demo", "vid9")]);
    expect(a.cached).toBe(false);
    expect(b).toBe(a);
    expect((await svc.get("demo", "vid9", { maxAgeS: 120 })).cached).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
