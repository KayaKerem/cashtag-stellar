import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair, hash } from "@stellar/stellar-sdk";
import { config, providers } from "../src/config.js";
import { createApp } from "../src/app.js";
import { DemoStore } from "../src/demo.js";
import { IgStore, openSigned, parsePostRef, verifySignedMessage } from "../src/instagram.js";
import { ProofService, proofUrl } from "../src/zkfetch.js";

const tmp = mkdtempSync(join(tmpdir(), "ig-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const brand = Keypair.random();
const alice = Keypair.random();
const bob = Keypair.random();
const POST = "DAbc_12-xyZ";

/** SEP-53 signed request body, as the dashboard sends it. */
function signedBody(kp: Keypair, msg: Record<string, unknown>, { raw = false, ts = Math.floor(Date.now() / 1000) } = {}) {
  const message = JSON.stringify({ ...msg, ts });
  const data = raw ? Buffer.from(message) : hash(Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)]));
  return { message, signature: Buffer.from(kp.sign(data)).toString("base64"), address: kp.publicKey() };
}

const cfg = {
  ...config,
  reclaimAppId: "",
  reclaimAppSecret: "",
  cliprailId: "CCLIPRAIL",
  humanityId: "CHUMANITY",
  demoPublicBase: "https://verifier.example",
  demoMode: true,
  writeToken: "",
  dataDir: join(tmp, "data"),
  proofFixtureDir: "",
};

function mk(platforms = ["instagram"]) {
  const ig = new IgStore(join(tmp, `ig-${Math.random()}.json`));
  const demo = new DemoStore(null);
  const ops = {
    submitClose: vi.fn(async () => ({ txHash: "ab".repeat(32), views: "0" })),
    demoRegister: vi.fn(async () => ({ txHash: "cd".repeat(32) })),
    campaignInfo: vi.fn(async () => ({ brand: brand.publicKey(), platforms })),
    participantCode: vi.fn(async (_id: bigint, w: string) => (w === alice.publicKey() ? "CR-ALICE00001" : null) as string | null),
  };
  const app = createApp({ cfg, demo, proofs: new ProofService(cfg, () => {}, demo), ops, ig });
  return { app, ig, ops };
}
const post = (app: any, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("parsePostRef", () => {
  it("accepts post, reel and profile-scoped links and bare shortcodes", () => {
    expect(parsePostRef(`https://www.instagram.com/p/${POST}/`)).toBe(POST);
    expect(parsePostRef(`https://instagram.com/reel/${POST}/?igsh=abc`)).toBe(POST);
    expect(parsePostRef(`https://www.instagram.com/btu.kalite/p/${POST}/`)).toBe(POST);
    expect(parsePostRef(POST)).toBe(POST);
  });
  it("rejects other hosts and junk", () => {
    expect(parsePostRef(`https://evil.example/p/${POST}/`)).toBeNull();
    expect(parsePostRef("https://www.instagram.com/btu.kalite/")).toBeNull();
    expect(parsePostRef('a"b')).toBeNull();
  });
});

describe("signed messages", () => {
  it("verifies SEP-53 and raw signatures, rejects others", () => {
    const b = signedBody(alice, { action: "x" });
    expect(verifySignedMessage(alice.publicKey(), b.message, b.signature)).toBe(true);
    const r = signedBody(alice, { action: "x" }, { raw: true });
    expect(verifySignedMessage(alice.publicKey(), r.message, r.signature)).toBe(true);
    expect(verifySignedMessage(bob.publicKey(), b.message, b.signature)).toBe(false);
    expect(verifySignedMessage(alice.publicKey(), b.message + " ", b.signature)).toBe(false);
  });
  it("rejects wrong action and expired messages", () => {
    expect(() => openSigned(signedBody(alice, { action: "a" }), "b")).toThrow(/action/);
    expect(() => openSigned(signedBody(alice, { action: "a" }, { ts: Math.floor(Date.now() / 1000) - 3600 }), "a")).toThrow(/expired/);
    const b = signedBody(alice, { action: "a" });
    expect(() => openSigned({ ...b, address: bob.publicKey() }, "a")).toThrow("bad signature");
  });
});

describe("instagram flow", () => {
  it("submit -> served with score 0 and the participant code -> approve -> served with likes + comments", async () => {
    const { app } = mk();
    const r = await post(app, "/ig/submit", signedBody(alice, { action: "cashtag:ig-submit", campaignId: "7", post: `https://www.instagram.com/p/${POST}/` }));
    expect(r.status).toBe(200);
    let j = await (await app.request(`/ig/posts/${POST}`)).json();
    expect(j.items[0].statistics.viewCount).toBe("0");
    expect(j.items[0].snippet.description).toContain("CR-ALICE00001");

    const a = await post(app, "/ig/approve", signedBody(brand, { action: "cashtag:ig-approve", campaignId: 7, post: POST, likes: 120, comments: 8 }));
    expect(a.status).toBe(200);
    j = await (await app.request(`/ig/posts/${POST}`)).json();
    expect(j.items[0].statistics.viewCount).toBe("128");
    const list = await (await app.request("/ig/campaigns/7/posts")).json();
    expect(list.posts).toHaveLength(1);
    expect(list.posts[0]).toMatchObject({ code: POST, wallet: alice.publicKey(), score: 128, approved: true });
  });

  it("the served body matches the provider regexes (same claim shape as demo)", async () => {
    const { app } = mk();
    await post(app, "/ig/submit", signedBody(alice, { action: "cashtag:ig-submit", campaignId: 7, post: POST }));
    const body = await (await app.request(`/ig/posts/${POST}`)).text();
    const [views, desc] = providers.instagram.responseMatches.map((m) => new RegExp(m.value).exec(body)?.groups);
    expect(views?.views).toBe("0");
    expect(desc?.desc).toContain("CR-ALICE00001");
    expect(proofUrl("instagram", POST, cfg)).toBe(`https://verifier.example/ig/posts/${POST}`);
  });

  it("only the brand can approve posts and participants", async () => {
    const { app, ops } = mk();
    await post(app, "/ig/submit", signedBody(alice, { action: "cashtag:ig-submit", campaignId: 7, post: POST }));
    const r = await post(app, "/ig/approve", signedBody(alice, { action: "cashtag:ig-approve", campaignId: 7, post: POST, likes: 1e6, comments: 0 }));
    expect(r.status).toBe(403);
    const p = await post(app, "/ig/participants/approve", signedBody(bob, { action: "cashtag:ig-approve-participant", campaignId: 7, wallet: bob.publicKey() }));
    expect(p.status).toBe(403);
    const ok = await post(app, "/ig/participants/approve", signedBody(brand, { action: "cashtag:ig-approve-participant", campaignId: 7, wallet: bob.publicKey() }));
    expect(ok.status).toBe(200);
    expect(ops.demoRegister).toHaveBeenCalledWith(7n, bob.publicKey());
  });

  it("a post belongs to one participant; non-participants cannot submit", async () => {
    const { app, ig } = mk();
    await post(app, "/ig/submit", signedBody(alice, { action: "cashtag:ig-submit", campaignId: 7, post: POST }));
    const r = await post(app, "/ig/submit", signedBody(bob, { action: "cashtag:ig-submit", campaignId: 7, post: POST }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("not_joined");
    ig.submit({ code: "OtherPost1", campaignId: "7", wallet: alice.publicKey(), participantCode: "CR-ALICE00001" });
    expect(() => ig.submit({ code: "OtherPost1", campaignId: "7", wallet: bob.publicKey(), participantCode: "CR-BOB0000001" })).toThrow(/another participant/);
  });

  it("rejects non-Instagram campaigns and bad signatures", async () => {
    const { app } = mk(["youtube"]);
    expect((await post(app, "/ig/submit", signedBody(alice, { action: "cashtag:ig-submit", campaignId: 7, post: POST }))).status).toBe(400);
    const b = signedBody(alice, { action: "cashtag:ig-submit", campaignId: 7, post: POST });
    expect((await post(mk().app, "/ig/submit", { ...b, signature: Buffer.alloc(64).toString("base64") })).status).toBe(401);
  });

  it("open demo-register is closed for Instagram campaigns", async () => {
    const { app, ops } = mk();
    const r = await post(app, "/humanity/demo-register", { campaignId: 7, wallet: bob.publicKey() });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("approval_required");
    expect(ops.demoRegister).not.toHaveBeenCalled();
  });

  it("persists across restarts", () => {
    const path = join(tmp, "persist.json");
    const a = new IgStore(path);
    a.submit({ code: POST, campaignId: "1", wallet: alice.publicKey(), participantCode: "CR-X" });
    a.approve(POST, "1", 5, 2);
    expect(new IgStore(path).isApproved(POST)).toBe(true);
  });
});
