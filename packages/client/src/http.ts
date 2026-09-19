import { parseContractError } from "@cliprail/shared";
import { CliprailError, toCliprailError } from "./errors";

/** JSON POST to the verifier; `{ error, code? }` bodies become CliprailError (contract_<n> → contract error). */
export async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
  opts: { token?: string; fetch?: typeof fetch } = {},
): Promise<T> {
  const f = opts.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await f(base.replace(/\/+$/, "") + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
  } catch (e) {
    throw new CliprailError("network", "verifier", "Could not reach the verification service.", null, e);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return data as T;
  const parsed = parseContractError(data);
  if (parsed) throw new CliprailError(parsed.code, parsed.source, parsed.message, parsed.name, data);
  const code = typeof data.code === "string" ? data.code : `http_${res.status}`;
  const msg =
    res.status === 401
      ? "The verification service rejected the authorization."
      : res.status === 429
        ? "Too many requests, try again in a minute."
        : `Verification service error: ${String(data.error ?? res.statusText)}`;
  throw new CliprailError(code, "verifier", msg, null, data);
}

export { toCliprailError };
