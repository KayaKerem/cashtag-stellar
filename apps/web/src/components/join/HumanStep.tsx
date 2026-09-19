"use client";

import { isCliprailError } from "@cliprail/client";
import { useEffect, useState } from "react";
import { TxButton } from "@/components/common/TxButton";
import { TxLink } from "@/components/common/TxLink";
import { CheckDot } from "@/components/ui/Chip";
import { errorMessage } from "@/lib/api/errors";
import { useWrite } from "@/lib/api/hooks";

const STAGES = [
  { label: "ZK kanıtı üretiliyor", hint: "Aadhaar test verisinden Groth16 kanıtı (~20–30 sn)." },
  { label: "İmza", hint: "Cüzdanında imza isteği çıkarsa onayla." },
  { label: "Zincire yazılıyor", hint: "Humanity kontratı kanıtı Soroban'da doğruluyor." },
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
        <span className="ml-auto font-mono text-xs text-muted tabular">{Math.floor(t)} sn</span>
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
 * Katılım 2. adımı: tek insan kanıtı.
 * Birincil yol on-chain ZK (Anon Aadhaar Groth16 → humanity.register_zk); yedek relayer demo kaydı.
 */
export type ZkResult = { nullifier: string; txHash: string };

/** ZK doğrulaması sonrası: kısaltılmış nullifier + tx + gizlilik açıklaması. */
export function ZkDoneCard({ result }: { result: ZkResult }) {
  return (
    <div className="rounded-2xl bg-panel p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckDot /> ZK ile doğrulandı
      </p>
      <p className="mt-2 text-muted">
        Nullifier{" "}
        <code className="rounded bg-row px-1.5 py-0.5 font-mono text-xs text-fg" title={result.nullifier}>
          {short(result.nullifier)}
        </code>
      </p>
      <p className="mt-2 text-xs text-muted">
        Kimliğin ifşa edilmedi. Kontrata yalnızca bu kampanya için tek kullanımlık bir nullifier yazıldı; aynı kişi başka bir cüzdanla ikinci kez katılamaz.
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
        setSybil(identity || "bu kimlik");
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
        <p className="text-sm font-medium">ZK ile doğrula (Aadhaar)</p>
        <p className="mt-1 text-xs text-muted">
          Anon Aadhaar kanıtı Soroban&apos;da on-chain doğrulanır. Kimlik bilgin paylaşılmaz; kampanyaya özel bir nullifier üretilir.
        </p>

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">Gelişmiş (demo): kimlik seç</summary>
          <p className="mt-2 text-muted">
            Aynı test kimliğini iki farklı cüzdanda dene: ikinci deneme sybil olarak reddedilir.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              { v: "", l: "Cüzdana özel" },
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
            <p className="font-medium">Sybil engellendi</p>
            <p className="mt-0.5">
              &quot;{sybil}&quot; kimliği bu kampanyada başka bir cüzdanla zaten doğrulanmış. Aynı kişi ikinci kez katılamaz (NullifierUsed).
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
          ZK ile doğrula
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        ZK çalışmıyorsa:
        <TxButton
          variant="outline"
          className="h-8 px-3 text-[10px]"
          action={() => demo.mutateAsync(undefined)}
          successTitle="Demo kaydı tamam"
          successBody={() => "Relayer bu cüzdanı kampanya için tek insan olarak kaydetti."}
        >
          Demo kaydı
        </TxButton>
      </div>
    </div>
  );
}
