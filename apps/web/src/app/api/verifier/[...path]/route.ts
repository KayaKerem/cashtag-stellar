import { NextResponse, type NextRequest } from "next/server";

/**
 * Server-side proxy for the verifier's token-protected writes (threat model TM-2).
 * WRITE_TOKEN stays on the server: it is read from a non-public env var and never reaches the browser.
 * Anyone can still call this proxy, so it is allow-listed, size-capped and rate-limited per IP.
 */

export const runtime = "nodejs";
// the Aadhaar prover can take up to 120 s
export const maxDuration = 300;

const ALLOWED = [/^demo\/videos\/[a-z0-9-]{1,32}\/bump$/, /^humanity\/demo-register$/, /^humanity\/aadhaar\/prove$/, /^proof\/submit$/];
const MAX_BODY = 16 * 1024;
const RATE = { perMin: 10, maxIps: 5_000 };

// per-instance limiter: best effort on serverless, enough to stop casual abuse
const hits = new Map<string, { n: number; reset: number }>();
function allow(ip: string, now = Date.now()): boolean {
  const h = hits.get(ip);
  if (!h || now >= h.reset) {
    if (hits.size >= RATE.maxIps) hits.delete(hits.keys().next().value!);
    hits.delete(ip);
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  return ++h.n <= RATE.perMin;
}

/** On Vercel, x-forwarded-for is set by the platform; its first hop is the client. */
function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

const err = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!ALLOWED.some((re) => re.test(path))) return err(404, "not found", "not_found");

  const base = (process.env.VERIFIER_URL || process.env.NEXT_PUBLIC_VERIFIER_URL || "").replace(/\/+$/, "");
  const token = process.env.WRITE_TOKEN;
  if (!base || !token) return err(503, "verifier proxy not configured", "proxy_unconfigured");

  if (!allow(clientIp(req))) return err(429, "Too many requests, try again in a minute.", "rate_limited");

  const body = await req.text();
  if (body.length > MAX_BODY) return err(413, "request body too large", "too_large");

  let res: Response;
  try {
    res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body,
      cache: "no-store",
    });
  } catch {
    return err(502, "Could not reach the verification service.", "network");
  }
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}
