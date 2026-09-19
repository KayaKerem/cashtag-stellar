// Anchor-agnostic fiat on/off-ramp: SEP-1 (stellar.toml) discovery, SEP-10 web auth,
// SEP-24 hosted deposit/withdraw, and the classic-side helpers (trustline, withdraw payment).
// Works with any SEP-24 anchor; defaults to the SDF test anchor on testnet.
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  WebAuth,
  type MemoType,
} from "@stellar/stellar-sdk";
import {
  anchorErrorMessage,
  isSep24Final,
  sep24StatusLabel,
  type AnchorErrorCode,
  type Sep24Status,
} from "@cliprail/shared";
import { CliprailError } from "./errors";
import type { Signer } from "./chain";

export const DEFAULT_ANCHOR_HOME_DOMAIN = "testanchor.stellar.org";
/** SRT on testanchor; switch to the event anchor's TRY asset code when known. */
export const DEFAULT_ANCHOR_ASSET_CODE = "SRT";
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

type Fetch = typeof fetch;
type AnchorSigner = Pick<Signer, "signTransaction">;

export const anchorError = (code: AnchorErrorCode, detail?: string | null, cause?: unknown) =>
  new CliprailError(code, "anchor", anchorErrorMessage(code, detail), null, cause);

// ------------------------------------------------------------------ SEP-1

export interface AnchorCurrency {
  code: string;
  issuer?: string;
  status?: string;
  desc?: string;
  anchorAssetType?: string;
  isAssetAnchored?: boolean;
}

export interface Sep24AssetInfo {
  enabled: boolean;
  minAmount?: number;
  maxAmount?: number;
}

export interface Sep24Info {
  deposit: Record<string, Sep24AssetInfo>;
  withdraw: Record<string, Sep24AssetInfo>;
  raw: unknown;
}

export interface AnchorInfo {
  homeDomain: string;
  webAuthEndpoint: string;
  transferServerSep24: string;
  signingKey: string;
  networkPassphrase: string;
  currencies: AnchorCurrency[];
  /** SEP-24 `/info` (null when `skipInfo` or the call failed). */
  sep24: Sep24Info | null;
  toml: Record<string, unknown>;
}

type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };

/**
 * Minimal TOML reader for stellar.toml: `key = value` (strings, numbers, booleans, arrays,
 * multi-line arrays), `[TABLE]` and `[[ARRAY_OF_TABLES]]`, comments.
 */
export function parseToml(text: string): Record<string, unknown> {
  const root: Record<string, TomlValue> = {};
  let cur: Record<string, TomlValue> = root;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i]).trim();
    if (!line) continue;
    const arrT = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    if (arrT) {
      const list = (root[arrT[1]] ??= []) as TomlValue[];
      cur = {};
      list.push(cur);
      continue;
    }
    const tbl = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (tbl) {
      cur = (root[tbl[1]] ??= {}) as Record<string, TomlValue>;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^"(.*)"$/, "$1");
    let raw = line.slice(eq + 1).trim();
    if (raw.startsWith("[")) {
      while (bracketDepth(raw) > 0 && i + 1 < lines.length) raw += " " + stripComment(lines[++i]).trim();
    } else if (raw.startsWith('"""')) {
      while (!/"""\s*$/.test(raw.slice(3)) && i + 1 < lines.length) raw += "\n" + lines[++i];
    }
    cur[key] = parseValue(raw);
  }
  return root;
}

function stripComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\" && inStr === '"') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function bracketDepth(s: string): number {
  let d = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\" && inStr === '"') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "[") d++;
    else if (c === "]") d--;
  }
  return d;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let d = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\" && inStr === '"') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "[" || c === "{") d++;
    else if (c === "]" || c === "}") d--;
    else if (c === "," && d === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseValue(raw: string): TomlValue {
  if (raw.startsWith('"""')) return raw.slice(3, raw.lastIndexOf('"""')).replace(/^\n/, "");
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, raw.lastIndexOf('"'));
    }
  }
  if (raw.startsWith("'")) return raw.slice(1, raw.lastIndexOf("'"));
  if (raw.startsWith("[")) return splitTopLevel(raw.slice(1, raw.lastIndexOf("]"))).map(parseValue);
  if (raw === "true" || raw === "false") return raw === "true";
  const n = Number(raw.replace(/_/g, ""));
  return raw !== "" && Number.isFinite(n) ? n : raw;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** `example.com` → `https://example.com`; full URLs (e.g. `http://localhost:8080`) pass through. */
const originOf = (homeDomain: string) =>
  (/^https?:\/\//i.test(homeDomain) ? homeDomain : `https://${homeDomain}`).replace(/\/+$/, "");
const bareDomain = (homeDomain: string) => homeDomain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

async function anchorFetch(f: Fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await f(url, init);
  } catch (e) {
    throw anchorError("anchor_unreachable", null, e);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/** Anchor HTTP error → CliprailError (401/403 → unauthorized, 404 → not found). */
function httpError(res: Response, body: Record<string, unknown>, fallback: AnchorErrorCode): CliprailError {
  const detail = str(body.error) ?? str(body.message) ?? `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return anchorError("anchor_unauthorized", detail, body);
  if (res.status === 404 && fallback === "anchor_tx_not_found") return anchorError("anchor_tx_not_found", detail, body);
  return anchorError(fallback, detail, body);
}

export interface DiscoverOptions {
  fetch?: Fetch;
  /** Expected network (default testnet); a different NETWORK_PASSPHRASE throws `anchor_wrong_network`. */
  networkPassphrase?: string;
  /** Skip the SEP-24 `/info` call. */
  skipInfo?: boolean;
}

/** SEP-1: read `https://<homeDomain>/.well-known/stellar.toml` and the SEP-24 `/info`. */
export async function discoverAnchor(homeDomain: string = DEFAULT_ANCHOR_HOME_DOMAIN, opts: DiscoverOptions = {}): Promise<AnchorInfo> {
  const f = opts.fetch ?? globalThis.fetch;
  const expected = opts.networkPassphrase ?? Networks.TESTNET;
  const res = await anchorFetch(f, `${originOf(homeDomain)}/.well-known/stellar.toml`);
  if (!res.ok) throw anchorError("anchor_toml_invalid", `HTTP ${res.status}`);
  let toml: Record<string, unknown>;
  try {
    toml = parseToml(await res.text());
  } catch (e) {
    throw anchorError("anchor_toml_invalid", "parse", e);
  }
  const webAuthEndpoint = str(toml.WEB_AUTH_ENDPOINT);
  const signingKey = str(toml.SIGNING_KEY);
  const transferServerSep24 = str(toml.TRANSFER_SERVER_SEP0024);
  if (!webAuthEndpoint || !signingKey) throw anchorError("anchor_toml_invalid", "WEB_AUTH_ENDPOINT / SIGNING_KEY");
  if (!transferServerSep24) throw anchorError("anchor_sep24_unsupported");
  const networkPassphrase = str(toml.NETWORK_PASSPHRASE) ?? expected;
  if (networkPassphrase !== expected) throw anchorError("anchor_wrong_network", networkPassphrase);

  const currencies: AnchorCurrency[] = (Array.isArray(toml.CURRENCIES) ? toml.CURRENCIES : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !!str((c as Record<string, unknown>).code))
    .map((c) => ({
      code: str(c.code)!,
      issuer: str(c.issuer),
      status: str(c.status),
      desc: str(c.desc),
      anchorAssetType: str(c.anchor_asset_type),
      isAssetAnchored: typeof c.is_asset_anchored === "boolean" ? c.is_asset_anchored : undefined,
    }));

  const info: AnchorInfo = {
    homeDomain: bareDomain(homeDomain),
    webAuthEndpoint: webAuthEndpoint.replace(/\/+$/, ""),
    transferServerSep24: transferServerSep24.replace(/\/+$/, ""),
    signingKey,
    networkPassphrase,
    currencies,
    sep24: null,
    toml,
  };
  if (!opts.skipInfo) info.sep24 = await sep24Info(info, f).catch(() => null);
  return info;
}

const assetInfoMap = (o: unknown): Record<string, Sep24AssetInfo> => {
  const out: Record<string, Sep24AssetInfo> = {};
  if (!o || typeof o !== "object") return out;
  for (const [code, v] of Object.entries(o as Record<string, Record<string, unknown>>)) {
    out[code] = {
      enabled: v?.enabled === true,
      minAmount: typeof v?.min_amount === "number" ? v.min_amount : undefined,
      maxAmount: typeof v?.max_amount === "number" ? v.max_amount : undefined,
    };
  }
  return out;
};

/** SEP-24 `GET /info`: which assets can be deposited / withdrawn. */
export async function sep24Info(anchor: Pick<AnchorInfo, "transferServerSep24">, f: Fetch = globalThis.fetch): Promise<Sep24Info> {
  const res = await anchorFetch(f, `${anchor.transferServerSep24}/info`);
  const body = await readJson(res);
  if (!res.ok) throw httpError(res, body, "anchor_request_failed");
  return { deposit: assetInfoMap(body.deposit), withdraw: assetInfoMap(body.withdraw), raw: body };
}

/** Classic asset for `code` from the anchor's CURRENCIES (`issuer` disambiguates / overrides). */
export function anchorAsset(anchor: Pick<AnchorInfo, "currencies">, code: string, issuer?: string): Asset {
  if (code === "native" || code === "XLM") return Asset.native();
  const cur = anchor.currencies.find((c) => c.code === code && (!issuer || c.issuer === issuer));
  const iss = issuer ?? cur?.issuer;
  if (!iss) throw anchorError("anchor_asset_unsupported", code);
  return new Asset(code, iss);
}

// ------------------------------------------------------------------ SEP-10

export interface Sep10Options {
  anchor: AnchorInfo;
  /** User's G... account. */
  account: string;
  signer: AnchorSigner;
  fetch?: Fetch;
}

/** SEP-10: fetch the challenge, verify it (anchor SIGNING_KEY, home + web auth domain), sign, exchange for a JWT. */
export async function sep10Auth({ anchor, account, signer, fetch: f = globalThis.fetch }: Sep10Options): Promise<string> {
  const q = new URLSearchParams({ account, home_domain: anchor.homeDomain });
  const res = await anchorFetch(f, `${anchor.webAuthEndpoint}?${q}`);
  const body = await readJson(res);
  if (!res.ok || typeof body.transaction !== "string") throw httpError(res, body, "anchor_auth_failed");
  const passphrase = str(body.network_passphrase) ?? anchor.networkPassphrase;
  if (passphrase !== anchor.networkPassphrase) throw anchorError("anchor_wrong_network", passphrase);

  const webAuthDomain = new URL(anchor.webAuthEndpoint).host;
  try {
    const { clientAccountID } = WebAuth.readChallengeTx(body.transaction, anchor.signingKey, passphrase, anchor.homeDomain, webAuthDomain);
    if (clientAccountID !== account) throw new Error(`challenge is for ${clientAccountID}`);
  } catch (e) {
    throw anchorError("anchor_challenge_invalid", e instanceof Error ? e.message : null, e);
  }

  let signed: string;
  try {
    signed = (await signer.signTransaction(body.transaction, { networkPassphrase: passphrase, address: account })).signedTxXdr;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/reject|declin|denied|cancel/i.test(text)) throw new CliprailError("wallet_rejected", "wallet", "İşlem cüzdanda reddedildi.", null, e);
    throw anchorError("anchor_auth_failed", text, e);
  }

  const post = await anchorFetch(f, anchor.webAuthEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: signed }),
  });
  const tok = await readJson(post);
  if (!post.ok || typeof tok.token !== "string") throw httpError(post, tok, "anchor_auth_failed");
  return tok.token;
}

/** `exp` (unix seconds) of a JWT, or null. */
export function jwtExpiry(jwt: string): number | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ SEP-24

export type TransferKind = "deposit" | "withdraw";

export interface StartInteractiveOptions {
  anchor: AnchorInfo;
  jwt: string;
  kind: TransferKind;
  assetCode: string;
  assetIssuer?: string;
  /** Account receiving (deposit) / sending (withdraw) the asset. */
  account: string;
  amount?: string;
  lang?: string;
  /** Extra SEP-24 fields (e.g. `claimable_balance_supported`, `wallet_name`). */
  extra?: Record<string, string>;
  fetch?: Fetch;
}

/** SEP-24 `POST /transactions/{deposit|withdraw}/interactive` → the anchor's popup URL. */
export async function startInteractive(o: StartInteractiveOptions): Promise<{ id: string; url: string }> {
  const f = o.fetch ?? globalThis.fetch;
  const info = o.anchor.sep24?.[o.kind]?.[o.assetCode];
  if (o.anchor.sep24 && (!info || !info.enabled)) throw anchorError("anchor_asset_unsupported", `${o.kind} ${o.assetCode}`);
  const body: Record<string, string> = { asset_code: o.assetCode, account: o.account, lang: o.lang ?? "tr", ...o.extra };
  if (o.assetIssuer) body.asset_issuer = o.assetIssuer;
  if (o.amount) body.amount = o.amount;
  const res = await anchorFetch(f, `${o.anchor.transferServerSep24}/transactions/${o.kind}/interactive`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.jwt}` },
    body: JSON.stringify(body),
  });
  const j = await readJson(res);
  if (!res.ok || typeof j.url !== "string" || typeof j.id !== "string") throw httpError(res, j, "anchor_request_failed");
  return { id: j.id, url: j.url };
}

export interface AnchorTransaction {
  id: string;
  /** SEP-24 uses "deposit" / "withdrawal". */
  kind: string;
  status: Sep24Status | string;
  /** Turkish status label for the UI. */
  statusLabel: string;
  /** Anchor will not change it anymore (completed / error / refunded / ...). */
  final: boolean;
  /** Withdraw waiting for the user's Stellar payment → call `completeWithdrawPayment`. */
  needsUserPayment: boolean;
  moreInfoUrl?: string;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  withdrawAnchorAccount?: string;
  withdrawMemo?: string;
  withdrawMemoType?: "text" | "id" | "hash";
  stellarTransactionId?: string;
  message?: string;
  raw: Record<string, unknown>;
}

/** Raw SEP-24 transaction object → AnchorTransaction. */
export function mapAnchorTransaction(t: Record<string, unknown>): AnchorTransaction {
  const status = str(t.status) ?? "incomplete";
  const kind = str(t.kind) ?? "";
  const memoType = str(t.withdraw_memo_type);
  const fee = t.amount_fee ?? (t.fee_details as { total?: unknown } | undefined)?.total;
  return {
    id: String(t.id ?? ""),
    kind,
    status,
    statusLabel: sep24StatusLabel(status),
    final: isSep24Final(status),
    needsUserPayment: kind.startsWith("withdraw") && status === "pending_user_transfer_start",
    moreInfoUrl: str(t.more_info_url),
    amountIn: str(t.amount_in),
    amountOut: str(t.amount_out),
    amountFee: str(fee),
    withdrawAnchorAccount: str(t.withdraw_anchor_account),
    withdrawMemo: str(t.withdraw_memo),
    withdrawMemoType: memoType === "id" || memoType === "hash" || memoType === "text" ? memoType : undefined,
    stellarTransactionId: str(t.stellar_transaction_id),
    message: str(t.message),
    raw: t,
  };
}

export interface PollOptions {
  anchor: AnchorInfo;
  jwt: string;
  id: string;
  fetch?: Fetch;
}

/** SEP-24 `GET /transaction?id=`. */
export async function pollTransaction({ anchor, jwt, id, fetch: f = globalThis.fetch }: PollOptions): Promise<AnchorTransaction> {
  const res = await anchorFetch(f, `${anchor.transferServerSep24}/transaction?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  const body = await readJson(res);
  if (!res.ok || !body.transaction || typeof body.transaction !== "object") throw httpError(res, body, "anchor_tx_not_found");
  return mapAnchorTransaction(body.transaction as Record<string, unknown>);
}

export interface WaitOptions extends PollOptions {
  /** Stop at these statuses (default: final statuses). */
  until?: readonly string[];
  intervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (tx: AnchorTransaction) => void;
}

/** Poll until the status is in `until` (or final); throws `anchor_timeout`. */
export async function waitForTransaction(o: WaitOptions): Promise<AnchorTransaction> {
  const deadline = Date.now() + (o.timeoutMs ?? 5 * 60_000);
  let last: string | null = null;
  for (;;) {
    const tx = await pollTransaction(o);
    if (tx.status !== last) {
      last = tx.status;
      o.onUpdate?.(tx);
    }
    if (o.until ? o.until.includes(tx.status) || tx.final : tx.final) return tx;
    if (Date.now() > deadline) throw anchorError("anchor_timeout", tx.status);
    await new Promise((r) => setTimeout(r, o.intervalMs ?? 3000));
  }
}

// ------------------------------------------------------------------ classic side (Horizon)

export interface ClassicOptions {
  horizonUrl?: string;
  networkPassphrase?: string;
}

const horizon = (o: ClassicOptions) => new Horizon.Server(o.horizonUrl ?? DEFAULT_HORIZON_URL);

async function loadAccount(server: Horizon.Server, account: string) {
  try {
    return await server.loadAccount(account);
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404 || /not ?found/i.test(String((e as Error)?.message)))
      throw anchorError("anchor_account_missing", account, e);
    throw anchorError("anchor_unreachable", "horizon", e);
  }
}

/** Horizon `result_codes` of a failed submit, as "tx_failed/op_underfunded". */
export function horizonResultCodes(e: unknown): string | null {
  const codes = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })?.response
    ?.data?.extras?.result_codes;
  if (!codes) return null;
  return [codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join("/");
}

async function signAndSubmit(
  server: Horizon.Server,
  xdr: string,
  account: string,
  signer: AnchorSigner,
  passphrase: string,
  failCode: AnchorErrorCode,
): Promise<string> {
  let signed: string;
  try {
    signed = (await signer.signTransaction(xdr, { networkPassphrase: passphrase, address: account })).signedTxXdr;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/reject|declin|denied|cancel/i.test(text)) throw new CliprailError("wallet_rejected", "wallet", "İşlem cüzdanda reddedildi.", null, e);
    throw anchorError(failCode, text, e);
  }
  try {
    const res = await server.submitTransaction(TransactionBuilder.fromXDR(signed, passphrase));
    return res.hash;
  } catch (e) {
    const codes = horizonResultCodes(e);
    if (codes && /underfunded|insufficient_balance|line_full/.test(codes)) throw anchorError("anchor_underfunded", codes, e);
    if (codes && /no_trust|src_no_trust/.test(codes)) throw anchorError("anchor_trustline_failed", codes, e);
    throw anchorError(failCode, codes ?? (e instanceof Error ? e.message : null), e);
  }
}

/** Balance line of `asset` on `account` (null: no trustline). Native always exists. */
export async function assetBalance(asset: Asset, account: string, o: ClassicOptions = {}): Promise<string | null> {
  const acc = await loadAccount(horizon(o), account);
  const line = acc.balances.find((b) =>
    asset.isNative()
      ? b.asset_type === "native"
      : "asset_code" in b && b.asset_code === asset.getCode() && "asset_issuer" in b && b.asset_issuer === asset.getIssuer(),
  );
  return line ? line.balance : null;
}

/** Add a trustline to `asset` if missing (changeTrust). `txHash` is null when it already existed. */
export async function ensureTrustline(
  asset: Asset,
  account: string,
  signer: AnchorSigner,
  o: ClassicOptions & { limit?: string } = {},
): Promise<{ created: boolean; txHash: string | null }> {
  if (asset.isNative()) return { created: false, txHash: null };
  const server = horizon(o);
  const passphrase = o.networkPassphrase ?? Networks.TESTNET;
  const acc = await loadAccount(server, account);
  const has = acc.balances.some(
    (b) => "asset_code" in b && b.asset_code === asset.getCode() && "asset_issuer" in b && b.asset_issuer === asset.getIssuer(),
  );
  if (has) return { created: false, txHash: null };
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset, ...(o.limit ? { limit: o.limit } : {}) }))
    .setTimeout(180)
    .build();
  const txHash = await signAndSubmit(server, tx.toXDR(), account, signer, passphrase, "anchor_trustline_failed");
  return { created: true, txHash };
}

/** SEP-24 withdraw memo → SDK Memo (hash memos are base64 per SEP-24). */
export function withdrawMemo(memo: string | undefined, type: AnchorTransaction["withdrawMemoType"]): Memo<MemoType> {
  if (!memo) return Memo.none();
  if (type === "id") return Memo.id(memo);
  if (type === "hash") {
    const bytes = /^[0-9a-f]{64}$/i.test(memo) ? hexToBytes(memo) : Uint8Array.from(atob(memo), (c) => c.charCodeAt(0));
    return Memo.hash(bytesToHex(bytes));
  }
  return Memo.text(memo);
}

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface CompleteWithdrawOptions extends ClassicOptions {
  /** Result of `pollTransaction` with status `pending_user_transfer_start`. */
  tx: AnchorTransaction;
  asset: Asset;
  account: string;
  signer: AnchorSigner;
  /** Defaults to `tx.amountIn` (the amount the user entered in the anchor's form). */
  amount?: string;
}

/** Withdraw step 2: pay `amount` of `asset` to `withdraw_anchor_account` with the anchor's memo; returns the tx hash. */
export async function completeWithdrawPayment(o: CompleteWithdrawOptions): Promise<string> {
  const { tx } = o;
  if (tx.status !== "pending_user_transfer_start") throw anchorError("anchor_not_ready", tx.status);
  const destination = tx.withdrawAnchorAccount;
  const amount = o.amount ?? tx.amountIn;
  if (!destination || !amount) throw anchorError("anchor_payment_failed", "withdraw_anchor_account / amount");
  const server = horizon(o);
  const passphrase = o.networkPassphrase ?? Networks.TESTNET;
  const acc = await loadAccount(server, o.account);
  const built = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.payment({ destination, asset: o.asset, amount }))
    .addMemo(withdrawMemo(tx.withdrawMemo, tx.withdrawMemoType))
    .setTimeout(180)
    .build();
  return signAndSubmit(server, built.toXDR(), o.account, o.signer, passphrase, "anchor_payment_failed");
}
