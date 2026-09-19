import { describe, expect, it, vi } from "vitest";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";
import {
  anchorAsset,
  discoverAnchor,
  mapAnchorTransaction,
  parseToml,
  pollTransaction,
  sep10Auth,
  startInteractive,
  withdrawMemo,
  type AnchorInfo,
} from "../src/anchor";
import { CliprailError } from "../src/errors";

const HOME = "anchor.example";
const ANCHOR_KP = Keypair.random();
const ISSUER = Keypair.random().publicKey();

const TOML = `
# comment
ACCOUNTS = [
  "GAAA", # first
  "GBBB"
]
SIGNING_KEY = "${ANCHOR_KP.publicKey()}"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT = "https://${HOME}/auth"
TRANSFER_SERVER_SEP0024 = "https://${HOME}/sep24/"

[[CURRENCIES]]
code = "TRY"
issuer = "${ISSUER}"
is_asset_anchored = true
anchor_asset_type = "fiat"
desc = "Turkish lira # not a comment"

[[CURRENCIES]]
code = "native"

[DOCUMENTATION]
ORG_NAME = "Example"
`;

const INFO = { deposit: { TRY: { enabled: true, min_amount: 10, max_amount: 5000 } }, withdraw: { TRY: { enabled: true } } };

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown; text?: string } | undefined;
function mockFetch(route: Route) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = route(url, init);
    if (!r) return new Response("not found", { status: 404 });
    const text = r.text ?? JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const anchorRoutes: Route = (url) => {
  if (url === `https://${HOME}/.well-known/stellar.toml`) return { body: null, text: TOML };
  if (url === `https://${HOME}/sep24/info`) return { body: INFO };
  return undefined;
};

describe("SEP-1 discovery", () => {
  it("parses stellar.toml", () => {
    const t = parseToml(TOML) as Record<string, any>;
    expect(t.ACCOUNTS).toEqual(["GAAA", "GBBB"]);
    expect(t.CURRENCIES).toHaveLength(2);
    expect(t.CURRENCIES[0]).toMatchObject({ code: "TRY", is_asset_anchored: true, desc: "Turkish lira # not a comment" });
    expect(t.DOCUMENTATION.ORG_NAME).toBe("Example");
  });

  it("discovers endpoints, currencies and /info", async () => {
    const f = mockFetch(anchorRoutes);
    const a = await discoverAnchor(HOME, { fetch: f });
    expect(a).toMatchObject({
      homeDomain: HOME,
      webAuthEndpoint: `https://${HOME}/auth`,
      transferServerSep24: `https://${HOME}/sep24`,
      signingKey: ANCHOR_KP.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    expect(a.currencies[0]).toMatchObject({ code: "TRY", issuer: ISSUER, anchorAssetType: "fiat", isAssetAnchored: true });
    expect(a.sep24?.deposit.TRY).toEqual({ enabled: true, minAmount: 10, maxAmount: 5000 });
    expect(anchorAsset(a, "TRY").getIssuer()).toBe(ISSUER);
    expect(() => anchorAsset(a, "EUR")).toThrow(CliprailError);
  });

  it("rejects missing SEP-24 and other networks", async () => {
    const noSep24 = mockFetch((u) => (u.endsWith("stellar.toml") ? { body: null, text: TOML.replace(/TRANSFER_SERVER_SEP0024.*\n/, "") } : undefined));
    await expect(discoverAnchor(HOME, { fetch: noSep24 })).rejects.toMatchObject({ code: "anchor_sep24_unsupported", source: "anchor" });
    await expect(discoverAnchor(HOME, { fetch: mockFetch(anchorRoutes), networkPassphrase: Networks.PUBLIC })).rejects.toMatchObject({
      code: "anchor_wrong_network",
    });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(discoverAnchor(HOME, { fetch: down })).rejects.toMatchObject({ code: "anchor_unreachable" });
  });
});

describe("SEP-10", () => {
  const user = Keypair.random();
  const signer = {
    signTransaction: vi.fn(async (xdr: string, o: { networkPassphrase: string }) => {
      const { TransactionBuilder } = await import("@stellar/stellar-sdk");
      const tx = TransactionBuilder.fromXDR(xdr, o.networkPassphrase);
      tx.sign(user);
      return { signedTxXdr: tx.toXDR() };
    }),
  };

  async function anchor(): Promise<AnchorInfo> {
    return discoverAnchor(HOME, { fetch: mockFetch(anchorRoutes), skipInfo: true });
  }

  const authRoutes = (serverKp: Keypair, home = HOME): Route => (url, init) => {
    if (url.startsWith(`https://${HOME}/auth?`)) {
      const tx = WebAuth.buildChallengeTx(serverKp, user.publicKey(), home, 300, Networks.TESTNET, HOME);
      return { body: { transaction: tx, network_passphrase: Networks.TESTNET } };
    }
    if (url === `https://${HOME}/auth` && init?.method === "POST") return { body: { token: "jwt-123" } };
    return undefined;
  };

  it("verifies, signs and exchanges the challenge", async () => {
    const f = mockFetch(authRoutes(ANCHOR_KP));
    await expect(sep10Auth({ anchor: await anchor(), account: user.publicKey(), signer, fetch: f })).resolves.toBe("jwt-123");
    expect(signer.signTransaction).toHaveBeenCalledWith(expect.any(String), { networkPassphrase: Networks.TESTNET, address: user.publicKey() });
  });

  it("refuses a challenge not signed by the anchor SIGNING_KEY", async () => {
    signer.signTransaction.mockClear();
    const f = mockFetch(authRoutes(Keypair.random()));
    await expect(sep10Auth({ anchor: await anchor(), account: user.publicKey(), signer, fetch: f })).rejects.toMatchObject({
      code: "anchor_challenge_invalid",
      source: "anchor",
    });
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses a challenge for another home domain", async () => {
    const f = mockFetch(authRoutes(ANCHOR_KP, "evil.example"));
    await expect(sep10Auth({ anchor: await anchor(), account: user.publicKey(), signer, fetch: f })).rejects.toMatchObject({
      code: "anchor_challenge_invalid",
    });
  });
});

describe("SEP-24", () => {
  const anchorInfo = async () => discoverAnchor(HOME, { fetch: mockFetch(anchorRoutes) });

  it("starts an interactive flow with lang=en", async () => {
    const f = mockFetch((url, init) =>
      url === `https://${HOME}/sep24/transactions/deposit/interactive` && init?.method === "POST"
        ? { body: { type: "interactive_customer_info_needed", url: "https://anchor.example/kyc?t=1", id: "tx1" } }
        : undefined,
    );
    const r = await startInteractive({ anchor: await anchorInfo(), jwt: "j", kind: "deposit", assetCode: "TRY", account: "GUSER", amount: "100", fetch: f });
    expect(r).toEqual({ id: "tx1", url: "https://anchor.example/kyc?t=1" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ asset_code: "TRY", account: "GUSER", amount: "100", lang: "en" });
    await expect(
      startInteractive({ anchor: await anchorInfo(), jwt: "j", kind: "deposit", assetCode: "EUR", account: "GUSER", fetch: f }),
    ).rejects.toMatchObject({ code: "anchor_asset_unsupported" });
  });

  it("maps poll responses", async () => {
    const raw = {
      id: "w1",
      kind: "withdrawal",
      status: "pending_user_transfer_start",
      amount_in: "50",
      amount_out: "49",
      amount_fee: "1",
      withdraw_anchor_account: "GANCHOR",
      withdraw_memo: "12345",
      withdraw_memo_type: "id",
      more_info_url: "https://anchor.example/more",
    };
    const f = mockFetch((url, init) =>
      url === `https://${HOME}/sep24/transaction?id=w1` && (init?.headers as Record<string, string>).authorization === "Bearer j"
        ? { body: { transaction: raw } }
        : { status: 401, body: { error: "expired" } },
    );
    const tx = await pollTransaction({ anchor: await anchorInfo(), jwt: "j", id: "w1", fetch: f });
    expect(tx).toMatchObject({
      status: "pending_user_transfer_start",
      statusLabel: "Waiting for your payment",
      needsUserPayment: true,
      final: false,
      amountIn: "50",
      amountOut: "49",
      amountFee: "1",
      withdrawAnchorAccount: "GANCHOR",
      withdrawMemo: "12345",
      withdrawMemoType: "id",
      moreInfoUrl: "https://anchor.example/more",
    });
    await expect(pollTransaction({ anchor: await anchorInfo(), jwt: "bad", id: "w1", fetch: f })).rejects.toMatchObject({
      code: "anchor_unauthorized",
    });
    expect(mapAnchorTransaction({ id: "d", kind: "deposit", status: "completed", fee_details: { total: "0.5" } })).toMatchObject({
      final: true,
      needsUserPayment: false,
      amountFee: "0.5",
      statusLabel: "Completed",
    });
  });

  it("builds withdraw memos", () => {
    expect(withdrawMemo("12345", "id").type).toBe("id");
    expect(withdrawMemo("hello", "text").value).toBe("hello");
    const b64 = Buffer.alloc(32, 7).toString("base64");
    expect(Buffer.from(withdrawMemo(b64, "hash").value as Buffer).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(withdrawMemo(undefined, undefined).type).toBe("none");
  });
});
