"use client";

import { canJoin, parseVideoLink, type Platform } from "@cliprail/shared";
import { useEffect, useMemo, useState } from "react";
import { CodeBadge } from "@/components/common/CodeBadge";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { useToast } from "@/components/common/Toast";
import { TxLink } from "@/components/common/TxLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CheckDot } from "@/components/ui/Chip";
import { useApi } from "@/lib/api/ApiProvider";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useClips, useParticipant, useWrite } from "@/lib/api/hooks";
import { useNow } from "@/lib/hooks/useNow";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";

const PLACEHOLDER: Record<string, string> = {
  youtube: "https://youtube.com/shorts/… ya da https://youtu.be/…",
  demo: "demo-video-01",
};

// Kanıt üretimi 5–30 sn sürer; aşamalar süreye göre yaklaşık gösterilir
const STAGES = [
  { key: "proof", label: "Kanıt üretiliyor (zkTLS)", hint: "Verifier izlenmeyi ve açıklamayı platformdan kanıtlıyor." },
  { key: "sign", label: "İmza", hint: "Cüzdanında imza isteği çıkarsa onayla." },
  { key: "submit", label: "Gönderim", hint: "Kontrat kanıtı doğruluyor ve klibi kaydediyor." },
];

function Progress({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const stage = elapsed < 6 ? 0 : elapsed < 20 ? 1 : 2;
  return (
    <div className="rounded-[20px] border border-fg bg-surface p-5 shadow-card" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-lime pulse-lime" aria-hidden />
        <span className="text-sm font-medium">{STAGES[stage].label}…</span>
        <span className="ml-auto font-mono text-xs text-muted tabular">{Math.floor(elapsed)} sn</span>
      </div>
      <ol className="mt-4 space-y-2.5">
        {STAGES.map((s, i) => (
          <li key={s.key} className={`flex items-start gap-3 ${i > stage ? "opacity-45" : ""}`}>
            {i < stage ? (
              <CheckDot className="mt-0.5" />
            ) : (
              <span
                className={`mt-0.5 size-[18px] shrink-0 rounded-full border-2 ${
                  i === stage ? "animate-spin border-fg border-t-transparent" : "border-border-strong"
                }`}
                aria-hidden
              />
            )}
            <span>
              <span className="block text-sm">{s.label}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">Bu işlem genellikle 5–30 saniye sürer. Sayfayı kapatma.</p>
    </div>
  );
}

export function RegisterClip({ id }: { id: bigint }) {
  const { account, mode } = useApi();
  const wallet = useWallet();
  const toast = useToast();
  const now = useNow();
  const campaign = useCampaign(id);
  const participant = useParticipant(id, account);
  const clips = useClips(id);
  const register = useWrite(
    (a, v: { platform: Platform; videoId: string }) => a.registerClip(id, v.platform, v.videoId),
    { campaignId: id },
  );

  const [platform, setPlatform] = useState<Platform | null>(null);
  const [link, setLink] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<{ clipId: bigint; txHash: string } | null>(null);

  const c = campaign.data;
  const platforms = (c?.params.platforms ?? []) as Platform[];
  const current = platform ?? platforms[0] ?? "youtube";
  const parsed = useMemo(() => (link.trim() ? parseVideoLink(current, link) : null), [current, link]);

  if (campaign.isLoading || participant.isLoading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!c) {
    return (
      <EmptyState
        title="Kampanya bulunamadı"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Kampanyalara dön</ButtonLink>}
      />
    );
  }
  if (mode === "chain" && !wallet.connected) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Klip kaydet" />
        <EmptyState
          title="Cüzdanını bağla"
          description="Klip kaydetmek için kampanyaya katıldığın cüzdanı bağla."
          action={
            <button type="button" onClick={() => wallet.connect()} className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg">
              Cüzdan bağla
            </button>
          }
        />
      </div>
    );
  }
  const me = participant.data;
  if (!me) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Klip kaydet" />
        <EmptyState
          title="Önce kampanyaya katıl"
          description="Klip kaydetmek için bu kampanyaya katılmış olman ve kodunu videonun açıklamasına eklemiş olman gerekir."
          action={<ButtonLink href={`/c/${c.id}/join`}>Katıl</ButtonLink>}
        />
      </div>
    );
  }

  const open = canJoin(c.params, now) && !c.refunded;
  const registered = result ? clips.data?.find((v) => v.clip.id === result.clipId)?.clip : undefined;
  const canSubmit = open && parsed?.ok && confirmed && startedAt === null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed?.ok || !canSubmit) return;
    setStartedAt(Date.now());
    try {
      const res = await register.mutateAsync({ platform: current, videoId: parsed.id });
      setResult(res);
      toast.success(`Klip #${res.clipId} kaydedildi`, { txHash: res.txHash });
    } catch (err) {
      toast.error(err, "Klip kaydedilemedi");
    } finally {
      setStartedAt(null);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Klip kaydedildi" description="Açılış kanıtı kontratta doğrulandı. Bundan sonraki izlenme artışı sayılır." />
        <div className="rounded-[20px] border border-border bg-surface p-6 shadow-card">
          <div className="flex items-center gap-3">
            <CheckDot className="size-7" />
            <p className="display text-xl">Klip #{result.clipId.toString()}</p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Başlangıç izlenmesi (baseline)</dt>
              <dd className="font-mono text-2xl tabular">
                {registered ? registered.baseline.toLocaleString("en-US") : <Skeleton className="mt-1 h-7 w-24" />}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">İşlem</dt>
              <dd className="mt-1.5">
                <TxLink hash={result.txHash} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            Kazanç, her dönemin sonunda kanıtlanan izlenmenin bu değerin üstüne çıkan kısmından hesaplanır.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/me">Panelime git</ButtonLink>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setLink("");
                setConfirmed(false);
              }}
              className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2"
            >
              Başka klip kaydet
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Klip kaydet"
        description={
          <>
            <span className="text-fg">{c.params.title || `Kampanya #${c.id}`}</span> · linkini gir; açılış kanıtı zkTLS ile
            üretilir.
          </>
        }
      />

      {!open && (
        <p className="mb-5 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          Kayıt süresi doldu; son dönemin içerik aşaması bitti.
        </p>
      )}

      {startedAt !== null ? (
        <Progress startedAt={startedAt} />
      ) : (
        <form onSubmit={submit} className="space-y-5 rounded-[20px] border border-border bg-surface p-5 shadow-card sm:p-6">
          <div>
            <span className="text-sm font-medium">Platform</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {platforms.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  aria-pressed={current === p}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    current === p ? "border-transparent bg-lime text-lime-fg" : "border-border-strong hover:bg-surface-2"
                  }`}
                >
                  {PLATFORM_LABEL[p] ?? p}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">{current === "demo" ? "Demo video kimliği ya da linki" : "Video linki"}</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={PLACEHOLDER[current]}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className={`mt-1.5 h-11 w-full rounded-xl border bg-surface px-3.5 text-sm outline-none focus:border-fg ${
                parsed && !parsed.ok ? "border-danger" : "border-border-strong"
              }`}
            />
            {parsed &&
              (parsed.ok ? (
                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  Video kimliği <code className="rounded bg-row px-1.5 py-0.5 font-mono text-fg">{parsed.id}</code>
                  <a href={videoUrl(current, parsed.id)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    aç ↗
                  </a>
                </span>
              ) : (
                <span className="mt-1.5 block text-xs text-danger">{parsed.error}</span>
              ))}
          </label>

          <div className="rounded-2xl bg-panel p-4">
            <p className="text-sm font-medium">Açıklamanda bu kod var mı?</p>
            <p className="mt-1 text-xs text-muted">Kanıt, videonun açıklamasında kodunu arar; yoksa kayıt reddedilir.</p>
            <div className="mt-3">
              <CodeBadge code={me.code} size="sm" />
            </div>
            <label className="mt-3 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--lime)]"
              />
              Evet, <span className="font-mono">{me.code}</span> videonun açıklamasında.
            </label>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="label-mono inline-flex h-12 w-full items-center justify-center rounded-full bg-ink text-sm text-ink-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kanıtla ve kaydet
          </button>
        </form>
      )}
    </div>
  );
}
