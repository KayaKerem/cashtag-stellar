// Anchor-agnostic fiat on/off-ramp: SEP-1 (stellar.toml) discovery, SEP-10 web auth,
// SEP-24 hosted deposit/withdraw, SEP-6 programmatic deposit/withdraw (+ SEP-12 KYC, SEP-38 quotes),
// and the classic-side helpers (trustline, withdraw payment).
// Works with any SEP-24 or SEP-6 anchor; SEP-24 defaults to the SDF test anchor on testnet.
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
  TRY_SEP38_ASSET,
  anchorErrorMessage,
  isSep24Final,
  sep24StatusLabel,
  sep6StatusLabel,
  type AnchorErrorCode,
  type Sep12Status,
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
  /** SEP-24 TRANSFER_SERVER_SEP0024 (undefined: the anchor only speaks SEP-6). */
  transferServerSep24?: string;
  /** SEP-6 TRANSFER_SERVER (undefined: the anchor only speaks SEP-24). */
  transferServer?: string;
  /** SEP-12 KYC_SERVER (falls back to TRANSFER_SERVER per SEP-12). */
  kycServer?: string;
  /** SEP-38 ANCHOR_QUOTE_SERVER. */
  quoteServer?: string;
  signingKey: string;
  networkPassphrase: string;
  currencies: AnchorCurrency[];
  /** SEP-24 `/info` (null when `skipInfo`, unsupported or the call failed). */
  sep24: Sep24Info | null;
  /** SEP-6 `/info` (null when `skipInfo`, unsupported or the call failed). */
  sep6?: Sep6Info | null;
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
  /** Skip the SEP-24 / SEP-6 `/info` calls. */
  skipInfo?: boolean;
}

/** SEP-1: read `https://<homeDomain>/.well-known/stellar.toml` and the SEP-24 / SEP-6 `/info`. */
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
  const transferServerSep24 = str(toml.TRANSFER_SERVER_SEP0024)?.replace(/\/+$/, "");
  const transferServer = str(toml.TRANSFER_SERVER)?.replace(/\/+$/, "");
  if (!webAuthEndpoint || !signingKey) throw anchorError("anchor_toml_invalid", "WEB_AUTH_ENDPOINT / SIGNING_KEY");
  if (!transferServerSep24 && !transferServer) throw anchorError("anchor_sep24_unsupported");
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
    transferServerSep24,
    transferServer,
    kycServer: str(toml.KYC_SERVER)?.replace(/\/+$/, "") ?? transferServer,
    quoteServer: str(toml.ANCHOR_QUOTE_SERVER)?.replace(/\/+$/, ""),
    signingKey,
    networkPassphrase,
    currencies,
    sep24: null,
    sep6: null,
    toml,
  };
  if (!opts.skipInfo) {
    const [s24, s6] = await Promise.all([
      transferServerSep24 ? sep24Info(info, f).catch(() => null) : null,
      transferServer ? sep6Info(info, f).catch(() => null) : null,
    ]);
    info.sep24 = s24;
    info.sep6 = s6;
  }
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
  const res = await anchorFetch(f, `${sep24Server(anchor)}/info`);
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

const sep24Server = (a: Pick<AnchorInfo, "transferServerSep24">): string => {
  if (!a.transferServerSep24) throw anchorError("anchor_sep24_unsupported");
  return a.transferServerSep24;
};

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
  const res = await anchorFetch(f, `${sep24Server(o.anchor)}/transactions/${o.kind}/interactive`, {
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
  /** SEP-38 / SEP-6 asset ids of the amounts, e.g. "iso4217:TRY", "stellar:USDC:G...". */
  amountInAsset?: string;
  amountOutAsset?: string;
  amountFeeAsset?: string;
  /** Off-chain reference: deposit transfer reference (açıklama) / withdrawal bank payout reference. */
  externalTransactionId?: string;
  /** Deposit settled as a claimable balance (account had no trustline). */
  claimableBalanceId?: string;
  quoteId?: string;
  /** Deposit: destination G...; withdrawal: destination IBAN. */
  to?: string;
  from?: string;
  /** Deposit waits for a trustline to the asset. */
  needsTrustline?: boolean;
  /** SEP-6 deposit instructions (SEP-9 fields: bank_name, bank_account_number, external_transfer_memo). */
  instructions?: Record<string, { value: string; description?: string }>;
  raw: Record<string, unknown>;
}

/** Raw SEP-24 / SEP-6 transaction object → AnchorTransaction (`protocol` picks the status wording). */
export function mapAnchorTransaction(t: Record<string, unknown>, protocol: AnchorProtocol = "sep24"): AnchorTransaction {
  const status = str(t.status) ?? "incomplete";
  const kind = str(t.kind) ?? "";
  const memoType = str(t.withdraw_memo_type);
  const fee = t.amount_fee ?? (t.fee_details as { total?: unknown } | undefined)?.total;
  return {
    id: String(t.id ?? ""),
    kind,
    status,
    statusLabel: protocol === "sep6" ? sep6StatusLabel(status, kind) : sep24StatusLabel(status),
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
    amountInAsset: str(t.amount_in_asset),
    amountOutAsset: str(t.amount_out_asset),
    amountFeeAsset: str(t.amount_fee_asset) ?? str((t.fee_details as { asset?: unknown } | undefined)?.asset),
    externalTransactionId: str(t.external_transaction_id),
    claimableBalanceId: str(t.claimable_balance_id),
    quoteId: str(t.quote_id),
    to: str(t.to),
    from: str(t.from),
    needsTrustline: status === "pending_trust",
    instructions: sep9Instructions(t.instructions),
    raw: t,
  };
}

/** SEP-6 `instructions` map → `{ field: { value, description } }` (undefined when absent). */
function sep9Instructions(v: unknown): Record<string, { value: string; description?: string }> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, { value: string; description?: string }> = {};
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    const o = (e ?? {}) as Record<string, unknown>;
    const value = str(o.value) ?? (typeof e === "string" ? e : undefined);
    if (value) out[k] = { value, description: str(o.description) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** "sep24" (TRANSFER_SERVER_SEP0024) or "sep6" (TRANSFER_SERVER). */
export type AnchorProtocol = "sep24" | "sep6";

export interface PollOptions {
  anchor: AnchorInfo;
  jwt: string;
  id: string;
  /** Which transfer server to ask (default: SEP-24 when the anchor has it, else SEP-6). */
  protocol?: AnchorProtocol;
  fetch?: Fetch;
}

/** SEP-24 / SEP-6 `GET /transaction?id=`. */
export async function pollTransaction({ anchor, jwt, id, protocol, fetch: f = globalThis.fetch }: PollOptions): Promise<AnchorTransaction> {
  const proto: AnchorProtocol = protocol ?? (anchor.transferServerSep24 ? "sep24" : "sep6");
  const base = proto === "sep6" ? sep6Server(anchor) : sep24Server(anchor);
  const res = await anchorFetch(f, `${base}/transaction?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  const body = await readJson(res);
  if (!res.ok || !body.transaction || typeof body.transaction !== "object") throw httpError(res, body, "anchor_tx_not_found");
  return mapAnchorTransaction(body.transaction as Record<string, unknown>, proto);
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

// ------------------------------------------------------------------ SEP-6 (programmatic deposit / withdraw)

export interface Sep6AssetInfo {
  enabled: boolean;
  authenticationRequired?: boolean;
  feePercent?: number;
  minAmount?: number;
  maxAmount?: number;
  fundingMethods?: string[];
}

export interface Sep6Info {
  deposit: Record<string, Sep6AssetInfo>;
  withdraw: Record<string, Sep6AssetInfo>;
  depositExchange: Record<string, Sep6AssetInfo>;
  withdrawExchange: Record<string, Sep6AssetInfo>;
  /** `features.claimable_balances`: the anchor can pay deposits to accounts without a trustline. */
  claimableBalances: boolean;
  raw: unknown;
}

const sep6Server = (a: Pick<AnchorInfo, "transferServer">): string => {
  if (!a.transferServer) throw anchorError("anchor_sep6_unsupported");
  return a.transferServer;
};

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

const sep6AssetMap = (o: unknown): Record<string, Sep6AssetInfo> => {
  const out: Record<string, Sep6AssetInfo> = {};
  if (!o || typeof o !== "object") return out;
  for (const [code, v] of Object.entries(o as Record<string, Record<string, unknown>>)) {
    out[code] = {
      enabled: v?.enabled === true,
      authenticationRequired: typeof v?.authentication_required === "boolean" ? v.authentication_required : undefined,
      feePercent: num(v?.fee_percent),
      minAmount: num(v?.min_amount),
      maxAmount: num(v?.max_amount),
      fundingMethods: Array.isArray(v?.funding_methods) ? (v.funding_methods as unknown[]).map(String) : undefined,
    };
  }
  return out;
};

/** SEP-6 `GET /info`. */
export async function sep6Info(anchor: Pick<AnchorInfo, "transferServer">, f: Fetch = globalThis.fetch): Promise<Sep6Info> {
  const res = await anchorFetch(f, `${sep6Server(anchor)}/info`);
  const body = await readJson(res);
  if (!res.ok) throw httpError(res, body, "anchor_request_failed");
  return {
    deposit: sep6AssetMap(body.deposit),
    withdraw: sep6AssetMap(body.withdraw),
    depositExchange: sep6AssetMap(body["deposit-exchange"]),
    withdrawExchange: sep6AssetMap(body["withdraw-exchange"]),
    claimableBalances: (body.features as { claimable_balances?: unknown } | undefined)?.claimable_balances === true,
    raw: body,
  };
}

/** Positive decimal string ("5000", "12.5"); throws `anchor_amount_invalid`. */
export function checkAmount(amount: string | number, maxDecimals = 7): string {
  const s = String(amount).trim().replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || Number(s) <= 0 || (m[2]?.length ?? 0) > maxDecimals) throw anchorError("anchor_amount_invalid", String(amount));
  return s;
}

async function sep6Get(anchor: AnchorInfo, jwt: string, path: string, params: Record<string, string | undefined>, f: Fetch) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const res = await anchorFetch(f, `${sep6Server(anchor)}/${path}?${q}`, { headers: { authorization: `Bearer ${jwt}` } });
  const body = await readJson(res);
  if (!res.ok || body.type === "non_interactive_customer_info_needed" || body.type === "customer_info_status") {
    if (body.type === "non_interactive_customer_info_needed") throw anchorError("anchor_kyc_failed", "KYC fields required", body);
    if (body.type === "customer_info_status") throw anchorError(body.status === "denied" ? "anchor_kyc_rejected" : "anchor_kyc_failed", str(body.status), body);
    throw httpError(res, body, "anchor_request_failed");
  }
  return body;
}

export interface Sep6DepositOptions {
  anchor: AnchorInfo;
  jwt: string;
  /** On-chain asset (default "USDC"). */
  assetCode?: string;
  /** Receiving G... / M... account. */
  account: string;
  /** Deposit amount in the off-chain asset for exchange deposits (TRY), else in the asset. */
  amount?: string;
  /** Funding method (default "bank_account"). */
  type?: string;
  /** SEP-38 quote id → uses `/deposit-exchange`. */
  quoteId?: string;
  /** Force `/deposit-exchange` (default: when `quoteId` or `sourceAsset` is given). */
  exchange?: boolean;
  /** Off-chain source asset for `/deposit-exchange` (default "iso4217:TRY"). */
  sourceAsset?: string;
  /** Let the anchor pay a claimable balance when there is no trustline. */
  claimableBalanceSupported?: boolean;
  lang?: string;
  extra?: Record<string, string>;
  fetch?: Fetch;
}

export interface Sep6DepositResponse {
  id: string;
  /** Human instructions ("Send TRY to IBAN ... with reference ..."). */
  how?: string;
  /** SEP-9 fields: bank_name, bank_account_number (IBAN), external_transfer_memo (reference). */
  instructions: Record<string, { value: string; description?: string }>;
  bankName?: string;
  iban?: string;
  /** Reference to write in the bank transfer description (açıklama). */
  reference?: string;
  /** Transaction page (sandbox: "simulate incoming transfer" button). */
  moreInfoUrl?: string;
  eta?: number;
  feePercent?: number;
  message?: string;
  raw: Record<string, unknown>;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/;

/** SEP-6 `GET /deposit` or `/deposit-exchange` → id + bank instructions (IBAN + reference). */
export async function sep6Deposit(o: Sep6DepositOptions): Promise<Sep6DepositResponse> {
  const f = o.fetch ?? globalThis.fetch;
  const code = o.assetCode ?? "USDC";
  const exchange = o.exchange ?? !!(o.quoteId || o.sourceAsset);
  const amount = o.amount === undefined ? undefined : checkAmount(o.amount);
  if (exchange && !amount) throw anchorError("anchor_amount_invalid", "amount required for deposit-exchange");
  const type = o.type ?? "bank_account";
  const params: Record<string, string | undefined> = {
    asset_code: code,
    account: o.account,
    amount,
    type,
    funding_method: type,
    lang: o.lang ?? "tr",
    ...(o.claimableBalanceSupported ? { claimable_balance_supported: "true" } : {}),
    ...(exchange ? { destination_asset: code, source_asset: o.sourceAsset ?? TRY_SEP38_ASSET, quote_id: o.quoteId } : {}),
    ...o.extra,
  };
  const body = await sep6Get(o.anchor, o.jwt, exchange ? "deposit-exchange" : "deposit", params, f);
  if (typeof body.id !== "string") throw anchorError("anchor_request_failed", "deposit: missing id", body);
  const instructions = sep9Instructions(body.instructions) ?? {};
  const message = str((body.extra_info as { message?: unknown } | undefined)?.message);
  const moreInfoUrl =
    str(body.more_info_url) ?? (message ?? str(body.how))?.match(URL_RE)?.[0]?.replace(/[.,;]+$/, "");
  return {
    id: body.id,
    how: str(body.how),
    instructions,
    bankName: instructions.bank_name?.value,
    iban: instructions.bank_account_number?.value ?? instructions.iban?.value,
    reference: instructions.external_transfer_memo?.value ?? instructions.reference?.value,
    moreInfoUrl,
    eta: num(body.eta),
    feePercent: num(body.fee_percent),
    message,
    raw: body,
  };
}

/** `sep6Deposit` through `/deposit-exchange` (TRY → USDC, optionally with a SEP-38 quote). */
export const sep6DepositExchange = (o: Sep6DepositOptions) => sep6Deposit({ ...o, exchange: true });

export interface Sep6WithdrawOptions {
  anchor: AnchorInfo;
  jwt: string;
  assetCode?: string;
  /** Sending account (optional per SEP-6; the JWT identifies the user). */
  account?: string;
  /** Amount of the on-chain asset (USDC) to withdraw. */
  amount?: string;
  /** Withdrawal type (default "bank_account"). */
  type?: string;
  /** Destination (IBAN) and extra (bank) — optional on the mock: the SEP-12 IBAN or a sandbox IBAN is used. */
  dest?: string;
  destExtra?: string;
  /** SEP-38 quote id → uses `/withdraw-exchange`. */
  quoteId?: string;
  exchange?: boolean;
  /** Off-chain destination asset for `/withdraw-exchange` (default "iso4217:TRY"). */
  destinationAsset?: string;
  refundMemo?: string;
  refundMemoType?: "text" | "id" | "hash";
  lang?: string;
  extra?: Record<string, string>;
  fetch?: Fetch;
}

export interface Sep6WithdrawResponse {
  id: string;
  /** Anchor account to pay the asset to. */
  accountId: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
  eta?: number;
  feePercent?: number;
  message?: string;
  /** SEP-7 `web+stellar:pay?...` URI when the anchor provides one. */
  paymentUri?: string;
  raw: Record<string, unknown>;
}

/** SEP-6 `GET /withdraw` or `/withdraw-exchange` → anchor account + memo to pay. */
export async function sep6Withdraw(o: Sep6WithdrawOptions): Promise<Sep6WithdrawResponse> {
  const f = o.fetch ?? globalThis.fetch;
  const code = o.assetCode ?? "USDC";
  const exchange = o.exchange ?? !!(o.quoteId || o.destinationAsset);
  const amount = o.amount === undefined ? undefined : checkAmount(o.amount);
  if (exchange && !amount) throw anchorError("anchor_amount_invalid", "amount required for withdraw-exchange");
  const type = o.type ?? "bank_account";
  const params: Record<string, string | undefined> = {
    asset_code: code,
    account: o.account,
    amount,
    type,
    funding_method: type,
    dest: o.dest,
    dest_extra: o.destExtra,
    refund_memo: o.refundMemo,
    refund_memo_type: o.refundMemo ? (o.refundMemoType ?? "text") : undefined,
    lang: o.lang ?? "tr",
    ...(exchange ? { source_asset: code, destination_asset: o.destinationAsset ?? TRY_SEP38_ASSET, quote_id: o.quoteId } : {}),
    ...o.extra,
  };
  const body = await sep6Get(o.anchor, o.jwt, exchange ? "withdraw-exchange" : "withdraw", params, f);
  if (typeof body.id !== "string" || typeof body.account_id !== "string") throw anchorError("anchor_request_failed", "withdraw: missing id / account_id", body);
  const memoType = str(body.memo_type);
  const extra = body.extra_info as { message?: unknown; payment_uri?: unknown } | undefined;
  return {
    id: body.id,
    accountId: body.account_id,
    memo: body.memo === undefined || body.memo === null ? undefined : String(body.memo),
    memoType: memoType === "id" || memoType === "hash" || memoType === "text" ? memoType : undefined,
    eta: num(body.eta),
    feePercent: num(body.fee_percent),
    message: str(extra?.message),
    paymentUri: str(extra?.payment_uri),
    raw: body,
  };
}

/** `sep6Withdraw` through `/withdraw-exchange` (USDC → TRY, optionally with a SEP-38 quote). */
export const sep6WithdrawExchange = (o: Sep6WithdrawOptions) => sep6Withdraw({ ...o, exchange: true });

/** A SEP-6 withdraw response as a payable transaction for `completeWithdrawPayment` (no poll needed). */
export function withdrawResponseToTx(w: Sep6WithdrawResponse, amount: string): AnchorTransaction {
  return mapAnchorTransaction(
    {
      id: w.id,
      kind: "withdrawal",
      status: "pending_user_transfer_start",
      amount_in: amount,
      withdraw_anchor_account: w.accountId,
      withdraw_memo: w.memo,
      withdraw_memo_type: w.memoType,
    },
    "sep6",
  );
}

export interface SimulateDepositOptions {
  anchor: Pick<AnchorInfo, "transferServer">;
  /** SEP-6 transaction id. */
  id: string;
  /** Off-chain amount that "arrives" (TRY). */
  amount: string;
  /** Transaction page; the simulate endpoint lives under it (default `<TRANSFER_SERVER>/tx/<id>`). */
  moreInfoUrl?: string;
  fetch?: Fetch;
}

/**
 * Sandbox only: make the off-chain TRY transfer "arrive" (what the more_info_url page's
 * "Simulate incoming TRY transfer" button does): `POST <more_info_url>/simulate-bank-transfer`.
 * On a real anchor the user's bank transfer does this; there is no such endpoint.
 */
export async function simulateDepositArrival(o: SimulateDepositOptions): Promise<AnchorTransaction | null> {
  const f = o.fetch ?? globalThis.fetch;
  const base = (o.moreInfoUrl ?? `${sep6Server(o.anchor)}/tx/${encodeURIComponent(o.id)}`).replace(/[?#].*$/, "").replace(/\/+$/, "");
  const res = await anchorFetch(f, `${base}/simulate-bank-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: checkAmount(o.amount, 2) }),
  });
  const body = await readJson(res);
  if (!res.ok || body.ok === false) throw httpError(res, body, "anchor_simulate_failed");
  return body.transaction && typeof body.transaction === "object" ? mapAnchorTransaction(body.transaction as Record<string, unknown>, "sep6") : null;
}

// ------------------------------------------------------------------ SEP-12 (KYC)

export interface Sep12Customer {
  id?: string;
  status: Sep12Status | string;
  message?: string;
  /** Fields the anchor still wants (`{ first_name: { type, description, optional } }`). */
  fields: Record<string, { type?: string; description?: string; optional?: boolean }>;
  providedFields: Record<string, { status?: string }>;
  raw: Record<string, unknown>;
}

export interface Sep12Options {
  anchor: Pick<AnchorInfo, "kycServer" | "transferServer">;
  jwt: string;
  /** SEP-12 customer type (e.g. "sep6-deposit"); optional. */
  type?: string;
  fetch?: Fetch;
}

const kycServer = (a: Pick<AnchorInfo, "kycServer" | "transferServer">): string => {
  const s = a.kycServer ?? a.transferServer;
  if (!s) throw anchorError("anchor_kyc_failed", "KYC_SERVER");
  return s;
};

/** SEP-12 `GET /customer` (the JWT identifies the account). */
export async function sep12GetCustomer({ anchor, jwt, type, fetch: f = globalThis.fetch }: Sep12Options): Promise<Sep12Customer> {
  const q = type ? `?${new URLSearchParams({ type })}` : "";
  const res = await anchorFetch(f, `${kycServer(anchor)}/customer${q}`, { headers: { authorization: `Bearer ${jwt}` } });
  const body = await readJson(res);
  if (!res.ok) throw httpError(res, body, "anchor_kyc_failed");
  return {
    id: str(body.id),
    status: str(body.status) ?? "NEEDS_INFO",
    message: str(body.message),
    fields: (body.fields as Sep12Customer["fields"]) ?? {},
    providedFields: (body.provided_fields as Sep12Customer["providedFields"]) ?? {},
    raw: body,
  };
}

/**
 * SEP-12 `PUT /customer` with SEP-9 fields (e.g. `first_name`, `bank_account_number` = IBAN).
 * The mock anchor auto-approves any PUT, even an empty one. Returns the customer id.
 */
export async function sep12PutCustomer(o: Sep12Options & { fields?: Record<string, string> }): Promise<{ id: string }> {
  const f = o.fetch ?? globalThis.fetch;
  const body = { ...(o.type ? { type: o.type } : {}), ...(o.fields ?? {}) };
  const res = await anchorFetch(f, `${kycServer(o.anchor)}/customer`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.jwt}` },
    body: JSON.stringify(body),
  });
  const j = await readJson(res);
  if (!res.ok || typeof j.id !== "string") throw httpError(res, j, "anchor_kyc_failed");
  return { id: j.id };
}

/** KYC status; when not ACCEPTED, PUT `fields` (default none: simulated KYC) and re-read. Throws on REJECTED. */
export async function ensureKyc(o: Sep12Options & { fields?: Record<string, string> }): Promise<Sep12Customer> {
  let c = await sep12GetCustomer(o).catch(() => null);
  if (c?.status !== "ACCEPTED") {
    await sep12PutCustomer(o);
    c = await sep12GetCustomer(o);
  }
  if (c.status === "REJECTED") throw anchorError("anchor_kyc_rejected", c.message);
  return c;
}

// ------------------------------------------------------------------ SEP-38 (quotes)

/** Classic asset → SEP-38 id `stellar:CODE:ISSUER`. */
export const sep38AssetId = (asset: Asset): string => (asset.isNative() ? "stellar:native" : `stellar:${asset.getCode()}:${asset.getIssuer()}`);

export interface Sep38PriceRequest {
  anchor: Pick<AnchorInfo, "quoteServer">;
  sellAsset: string;
  buyAsset: string;
  /** Exactly one of sellAmount / buyAmount. */
  sellAmount?: string;
  buyAmount?: string;
  /** Default "sep6". */
  context?: "sep6" | "sep24" | "sep31";
  sellDeliveryMethod?: string;
  buyDeliveryMethod?: string;
  countryCode?: string;
  jwt?: string;
  fetch?: Fetch;
}

export interface Sep38Price {
  /** SEP-38 `total_price`: sell units per 1 buy unit, fee included. */
  totalPrice: string;
  /** Price excluding the fee. */
  price: string;
  sellAmount: string;
  buyAmount: string;
  fee?: { total: string; asset: string; details?: { name: string; description?: string; amount: string }[] };
  /** TRY per 1 USDC (fee included), whichever way the trade goes — for "1 USDC = 49,03 TL". */
  tryPerUsdc?: number;
  raw: Record<string, unknown>;
}

export interface Sep38Quote extends Sep38Price {
  id: string;
  expiresAt: string;
  sellAsset: string;
  buyAsset: string;
}

const quoteServer = (a: Pick<AnchorInfo, "quoteServer">): string => {
  if (!a.quoteServer) throw anchorError("anchor_quote_failed", "ANCHOR_QUOTE_SERVER");
  return a.quoteServer;
};

function mapPrice(b: Record<string, unknown>, sellAsset: string, buyAsset: string): Sep38Price {
  const sellAmount = str(b.sell_amount) ?? "0";
  const buyAmount = str(b.buy_amount) ?? "0";
  const s = Number(sellAmount);
  const bu = Number(buyAmount);
  let tryPerUsdc: number | undefined;
  if (sellAsset.startsWith("iso4217:TRY") && bu > 0) tryPerUsdc = s / bu;
  else if (buyAsset.startsWith("iso4217:TRY") && s > 0) tryPerUsdc = bu / s;
  const fee = b.fee as Sep38Price["fee"] | undefined;
  return { totalPrice: str(b.total_price) ?? "", price: str(b.price) ?? "", sellAmount, buyAmount, fee, tryPerUsdc, raw: b };
}

function priceParams(o: Sep38PriceRequest): Record<string, string> {
  if (!!o.sellAmount === !!o.buyAmount) throw anchorError("anchor_amount_invalid", "exactly one of sellAmount / buyAmount");
  const p: Record<string, string> = { sell_asset: o.sellAsset, buy_asset: o.buyAsset, context: o.context ?? "sep6" };
  if (o.sellAmount) p.sell_amount = checkAmount(o.sellAmount);
  if (o.buyAmount) p.buy_amount = checkAmount(o.buyAmount);
  if (o.sellDeliveryMethod) p.sell_delivery_method = o.sellDeliveryMethod;
  if (o.buyDeliveryMethod) p.buy_delivery_method = o.buyDeliveryMethod;
  if (o.countryCode) p.country_code = o.countryCode;
  return p;
}

/** SEP-38 `GET /price` (indicative, no auth needed). */
export async function sep38Price(o: Sep38PriceRequest): Promise<Sep38Price> {
  const f = o.fetch ?? globalThis.fetch;
  const q = new URLSearchParams(priceParams(o));
  const res = await anchorFetch(f, `${quoteServer(o.anchor)}/price?${q}`, o.jwt ? { headers: { authorization: `Bearer ${o.jwt}` } } : undefined);
  const body = await readJson(res);
  if (!res.ok || !str(body.total_price)) throw httpError(res, body, "anchor_quote_failed");
  return mapPrice(body, o.sellAsset, o.buyAsset);
}

/** SEP-38 `POST /quote` (firm, single-use, needs the SEP-10 JWT). Pass `id` as `quoteId` to the -exchange call. */
export async function sep38Quote(o: Sep38PriceRequest & { jwt: string; expireAfter?: string }): Promise<Sep38Quote> {
  const f = o.fetch ?? globalThis.fetch;
  const body = { ...priceParams(o), ...(o.expireAfter ? { expire_after: o.expireAfter } : {}) };
  const res = await anchorFetch(f, `${quoteServer(o.anchor)}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.jwt}` },
    body: JSON.stringify(body),
  });
  const j = await readJson(res);
  if (!res.ok || typeof j.id !== "string") throw httpError(res, j, "anchor_quote_failed");
  return {
    ...mapPrice(j, o.sellAsset, o.buyAsset),
    id: j.id,
    expiresAt: str(j.expires_at) ?? "",
    sellAsset: str(j.sell_asset) ?? o.sellAsset,
    buyAsset: str(j.buy_asset) ?? o.buyAsset,
  };
}
