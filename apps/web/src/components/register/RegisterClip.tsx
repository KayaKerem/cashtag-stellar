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
import { bumpDemoVideo, demoDescription, suggestDemoId } from "@/lib/api/demo";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useClips, useParticipant, useWrite } from "@/lib/api/hooks";
import { useNow } from "@/lib/hooks/useNow";
import { PLATFORM_LABEL, videoUrl } from "@/lib/video";

const PLACEHOLDER: Record<string, string> = {
  youtube: "https://youtube.com/shorts/… or https://youtu.be/…",
  demo: "demo-video-01",
};

// Proof generation takes 5–30s; the stages are approximated from the elapsed time
const STAGES = [
  { key: "proof", label: "Generating the proof (zkTLS)", hint: "The verifier proves the view count and the description from the platform." },
  { key: "sign", label: "Signing", hint: "Approve the signature request in your wallet." },
  { key: "submit", label: "Submitting", hint: "The contract verifies the proof and registers the clip." },
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
        <span className="ml-auto font-mono text-xs text-muted tabular">{Math.floor(elapsed)}s</span>
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
      <p className="mt-4 text-xs text-muted">This usually takes 5–30 seconds. Don&apos;t close the page.</p>
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
  // Demo platform: the video ID whose description already carries the code
  const [prepared, setPrepared] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const c = campaign.data;
  const platforms = (c?.params.platforms ?? []) as Platform[];
  const current = platform ?? platforms[0] ?? "youtube";
  const parsed = useMemo(() => (link.trim() ? parseVideoLink(current, link) : null), [current, link]);

  if (campaign.isLoading || participant.isLoading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!c) {
    return (
      <EmptyState
        title="Campaign not found"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Back to campaigns</ButtonLink>}
      />
    );
  }
  if (mode === "chain" && !wallet.connected) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Register clip" />
        <EmptyState
          title="Connect your wallet"
          description="Connect the wallet you joined the campaign with to register a clip."
          action={
            <button type="button" onClick={() => wallet.connect()} className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg">
              Connect wallet
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
        <PageHeader title="Register clip" />
        <EmptyState
          title="Join the campaign first"
          description="To register a clip you need to have joined this campaign and added your code to the video description."
          action={<ButtonLink href={`/c/${c.id}/join`}>Join</ButtonLink>}
        />
      </div>
    );
  }

  const open = canJoin(c.params, now) && !c.refunded;
  const registered = result ? clips.data?.find((v) => v.clip.id === result.clipId)?.clip : undefined;
  const isDemo = current === "demo";
  const demoReady = !isDemo || (parsed?.ok && prepared === parsed.id);
  const canSubmit = open && parsed?.ok && confirmed && demoReady && startedAt === null;

  async function prepareDemo() {
    if (!parsed?.ok || !me) return;
    setPreparing(true);
    try {
      await bumpDemoVideo(parsed.id, { desc: demoDescription(me.code, c!.params.title), views: 100 });
      setPrepared(parsed.id);
      setConfirmed(true);
      toast.success("Demo video ready", { body: `${me.code} was written to the description and views set to 100.` });
    } catch (err) {
      toast.show({ tone: "error", title: "Couldn't prepare the demo video", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setPreparing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed?.ok || !canSubmit) return;
    setStartedAt(Date.now());
    try {
      const res = await register.mutateAsync({ platform: current, videoId: parsed.id });
      setResult(res);
      toast.success(`Clip #${res.clipId} registered`, { txHash: res.txHash });
    } catch (err) {
      toast.error(err, "Couldn't register the clip");
    } finally {
      setStartedAt(null);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Clip registered" description="The opening proof was verified in the contract. Views from here on count." />
        <div className="rounded-[20px] border border-border bg-surface p-6 shadow-card">
          <div className="flex items-center gap-3">
            <CheckDot className="size-7" />
            <p className="display text-xl">Clip #{result.clipId.toString()}</p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Baseline views</dt>
              <dd className="font-mono text-2xl tabular">
                {registered ? registered.baseline.toLocaleString("en-US") : <Skeleton className="mt-1 h-7 w-24" />}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Transaction</dt>
              <dd className="mt-1.5">
                <TxLink hash={result.txHash} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            Earnings are calculated from the views proven at the end of each epoch above this baseline.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/me">Go to my dashboard</ButtonLink>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setLink("");
                setConfirmed(false);
              }}
              className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2"
            >
              Register another clip
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Register clip"
        description={
          <>
            <span className="text-fg">{c.params.title || `Campaign #${c.id}`}</span> · paste your link; the opening proof is
            generated with zkTLS.
          </>
        }
      />

      {!open && (
        <p className="mb-5 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          Registration is closed; the content phase of the last epoch is over.
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
            <span className="text-sm font-medium">{current === "demo" ? "Demo video ID or link" : "Video link"}</span>
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
                  Video ID <code className="rounded bg-row px-1.5 py-0.5 font-mono text-fg">{parsed.id}</code>
                  <a href={videoUrl(current, parsed.id)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    open ↗
                  </a>
                </span>
              ) : (
                <span className="mt-1.5 block text-xs text-danger">{parsed.error}</span>
              ))}
          </label>

          {isDemo && (
            <div className="rounded-2xl border border-border-strong p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Prepare the demo video</p>
                <button
                  type="button"
                  onClick={() => {
                    setLink(suggestDemoId(me.code));
                    setPrepared(null);
                  }}
                  className="text-xs text-muted underline underline-offset-4 hover:text-fg"
                >
                  Suggest a new ID
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Writes your code and the #ad tag into the video description on the demo platform and sets views to 100. The proof looks for the code in that description.
              </p>
              {prepared && parsed?.ok && prepared === parsed.id ? (
                <p className="mt-3 flex items-center gap-2 text-sm">
                  <CheckDot /> Ready: <code className="font-mono text-xs">{prepared}</code>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={prepareDemo}
                  disabled={!parsed?.ok || preparing}
                  className="label-mono mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-lime px-5 text-[12px] text-lime-fg disabled:opacity-40"
                >
                  {preparing && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
                  {preparing ? "Preparing…" : "Prepare the demo video"}
                </button>
              )}
            </div>
          )}

          <div className="rounded-2xl bg-panel p-4">
            <p className="text-sm font-medium">Is this code in your description?</p>
            <p className="mt-1 text-xs text-muted">The proof looks for your code in the video description; without it the registration is rejected.</p>
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
              Yes, <span className="font-mono">{me.code}</span> is in the video description.
            </label>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="label-mono inline-flex h-12 w-full items-center justify-center rounded-full bg-ink text-sm text-ink-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prove and register
          </button>
          {isDemo && parsed?.ok && !demoReady && (
            <p className="text-center text-xs text-muted">Finish the &quot;Prepare the demo video&quot; step first.</p>
          )}
        </form>
      )}
    </div>
  );
}
