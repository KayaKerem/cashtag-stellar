"use client";

import { isCliprailError } from "@cliprail/client";
import { useEffect, useState } from "react";
import { TxButton } from "@/components/common/TxButton";
import { TxLink } from "@/components/common/TxLink";
import { CheckDot } from "@/components/ui/Chip";
import { errorMessage } from "@/lib/api/errors";
import { useWrite } from "@/lib/api/hooks";

const STAGES = [
  { label: "Generating the ZK proof", hint: "A Groth16 proof from Aadhaar test data (~20–30s)." },
  { label: "Signing", hint: "Approve the signature request in your wallet." },
  { label: "Writing on-chain", hint: "The humanity contract verifies the proof on Soroban." },
];

function Progress({ startedAt }: { startedAt: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((Date.now() - startedAt) / 1000), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const stage = t < 18 ? 0 : t < 30 ? 1 : 2;
  return (
    <div className="rounded-2xl border border-fg p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full bg-lime pulse-lime" aria-hidden />
        {STAGES[stage].label}…
        <span className="ml-auto font-mono text-xs text-muted tabular">{Math.floor(t)}s</span>
      </div>
      <ol className="mt-3 space-y-2">
        {STAGES.map((s, i) => (
          <li key={s.label} className={`flex items-start gap-2.5 ${i > stage ? "opacity-45" : ""}`}>
            {i < stage ? (
              <CheckDot className="mt-0.5" />
            ) : (
              <span className={`mt-0.5 size-[18px] shrink-0 rounded-full border-2 ${i === stage ? "animate-spin border-fg border-t-transparent" : "border-border-strong"}`} aria-hidden />
            )}
            <span>
              <span className="block text-sm">{s.label}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const short = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

/**
 * Step 2 of joining: proof of a unique human.
 * The primary path is on-chain ZK (Anon Aadhaar Groth16 -> humanity.register_zk); the fallback is a
 * relayer-backed demo registration.
 */
export type ZkResult = { nullifier: string; txHash: string };

/** After ZK verification: shortened nullifier + tx + a note on privacy. */
export function ZkDoneCard({ result }: { result: ZkResult }) {
  return (
    <div className="rounded-2xl bg-panel p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckDot /> Verified with ZK
      </p>
      <p className="mt-2 text-muted">
        Nullifier{" "}
        <code className="rounded bg-row px-1.5 py-0.5 font-mono text-xs text-fg" title={result.nullifier}>
          {short(result.nullifier)}
        </code>
      </p>
      <p className="mt-2 text-xs text-muted">
        Your identity was never revealed. Only a one-time nullifier for this campaign was written to the contract, so the same person can&apos;t join again with another wallet.
      </p>
      <TxLink hash={result.txHash} className="mt-2" />
    </div>
  );
}

export function HumanStep({ campaignId, onZkDone }: { campaignId: bigint; onZkDone?: (r: ZkResult) => void }) {
  const zk = useWrite((a, identity: string | undefined) => a.registerHumanZk(campaignId, identity ? { identity } : undefined), {
    campaignId,
  });
  const demo = useWrite((a) => a.registerHuman(campaignId), { campaignId });
  const [identity, setIdentity] = useState<string>("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [sybil, setSybil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function proveZk() {
    setError(null);
    setSybil(null);
    setStartedAt(Date.now());
    try {
      const r = await zk.mutateAsync(identity || undefined);
      onZkDone?.(r);
    } catch (e) {
      if (isCliprailError(e) && e.source === "humanity" && e.code === 2) {
        setSybil(identity || "this identity");
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setStartedAt(null);
    }
  }

  if (startedAt !== null) return <Progress startedAt={startedAt} />;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border-strong p-4">
        <p className="text-sm font-medium">Verify with ZK (Aadhaar)</p>
        <p className="mt-1 text-xs text-muted">
          The Anon Aadhaar proof is verified on-chain on Soroban. Your identity data is never shared; a campaign-specific nullifier is derived instead.
        </p>

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">Advanced (demo): pick an identity</summary>
          <p className="mt-2 text-muted">
            Try the same test identity on two different wallets: the second attempt is rejected as a sybil.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              { v: "", l: "Wallet-specific" },
              { v: "alice", l: "alice" },
              { v: "bob", l: "bob" },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                onClick={() => setIdentity(o.v)}
                aria-pressed={identity === o.v}
                className={`rounded-full border px-3 py-1 ${identity === o.v ? "border-transparent bg-lime text-lime-fg" : "border-border-strong hover:bg-surface-2"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </details>

        {sybil && (
          <div role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            <p className="font-medium">Sybil blocked</p>
            <p className="mt-0.5">
              The identity &quot;{sybil}&quot; has already been verified in this campaign with another wallet. The same person can&apos;t join twice (NullifierUsed).
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={proveZk}
          className="label-mono mt-3 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[12px] text-ink-fg hover:opacity-90"
        >
          Verify with ZK
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        If ZK doesn&apos;t work:
        <TxButton
          variant="outline"
          className="h-8 px-3 text-[10px]"
          action={() => demo.mutateAsync(undefined)}
          successTitle="Demo registration done"
          successBody={() => "The relayer registered this wallet as a unique human for the campaign."}
        >
          Demo registration
        </TxButton>
      </div>
    </div>
  );
}
