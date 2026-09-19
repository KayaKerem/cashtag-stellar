"use client";

import { MOCK_ACCOUNTS } from "@cliprail/client";
import { parseUsdc, type Platform } from "@cliprail/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TryRampButton } from "@/components/anchor/TryRampDialog";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { FundingChoice, SWAP_CAMPAIGN_TOKEN, SWAP_TOKEN_IN, swapErrorMessage, type FundWith } from "./SwapFunding";
import { useToast } from "@/components/common/Toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { useApi } from "@/lib/api/ApiProvider";
import { useWrite } from "@/lib/api/hooks";
import { buildParams, demoPreset, emptyForm, type CampaignForm, type FormErrors } from "@/lib/campaignForm";
import { formatDuration, useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Key = keyof CampaignForm;

function Field({
  label,
  help,
  error,
  suffix,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {suffix && <span className="font-mono text-[11px] font-normal text-muted">{suffix}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : (
        help && <span className="mt-1 block text-xs text-muted">{help}</span>
      )}
    </label>
  );
}

const inputCls = (err?: string) =>
  `h-11 w-full rounded-xl border bg-surface px-3.5 text-sm outline-none transition focus:border-fg ${
    err ? "border-danger" : "border-border-strong"
  }`;

function Group({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-[20px] border border-border bg-surface p-5 shadow-card sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h2 className="display text-xl">{title}</h2>
      <p className="mt-1 text-sm text-muted">{desc}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function CampaignFormPage() {
  const router = useRouter();
  const toast = useToast();
  const { account, mode } = useApi();
  const { connected, connect } = useWallet();
  const now = useNow();
  const [form, setForm] = useState<CampaignForm>(() => emptyForm(MOCK_ACCOUNTS.arbiter));
  const [touched, setTouched] = useState(false);
  const [fundWith, setFundWith] = useState<FundWith>("usdc");

  const { params, errors } = useMemo(() => buildParams(form, account, now), [form, account, now]);
  const shown: FormErrors = touched ? errors : {};

  const create = useWrite((api, p: NonNullable<typeof params>) => api.createCampaign(p));
  const createSwap = useWrite((api, p: NonNullable<typeof params>) =>
    api.createCampaignWithSwap({ ...p, token: SWAP_CAMPAIGN_TOKEN }, { tokenIn: SWAP_TOKEN_IN }),
  );
  const pending = create.isPending || createSwap.isPending;
  const budgetValue = (() => {
    try {
      return form.budget.trim() ? parseUsdc(form.budget) : null;
    } catch {
      return null;
    }
  })();

  const set = <K extends Key>(k: K, v: CampaignForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: Key) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never),
    className: inputCls(shown[k]),
  });
  const secs = (k: Key) => {
    const v = form[k] as string;
    return /^\d+$/.test(v) ? formatDuration(Number(v)) : undefined;
  };
  const togglePlatform = (p: Platform) =>
    set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);

  const needWallet = mode === "chain" && !connected;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (needWallet) {
      await connect();
      return;
    }
    if (!params) {
      toast.show({ tone: "error", title: "Some fields still need fixing" });
      return;
    }
    try {
      if (fundWith === "xlm") {
        const res = await createSwap.mutateAsync(params);
        toast.success(`Campaign #${res.id} created`, {
          txHash: res.txHash,
          body: "Your XLM was swapped for USDC on Soroswap and locked in the contract.",
        });
        router.push(`/c/${res.id}`);
      } else {
        const res = await create.mutateAsync(params);
        toast.success(`Campaign #${res.id} created`, { txHash: res.txHash, body: "The budget is locked in the contract." });
        router.push(`/c/${res.id}`);
      }
    } catch (err) {
      if (fundWith === "xlm") toast.show({ tone: "error", title: "Couldn't create the campaign", body: swapErrorMessage(err) });
      else toast.error(err, "Couldn't create the campaign");
    }
  }

  // Preview: a timeline from whatever fields are readable, even if the form is not valid yet
  const preview = (() => {
    const n = (v: string, d: number) => (/^\d+$/.test(v) ? BigInt(v) : BigInt(d));
    const epochs = Math.min(Math.max(Number(n(form.epochs, 1)), 1), 8);
    return {
      start: now + n(form.start_in, 60),
      epoch_len: n(form.epoch_len, 300) || 1n,
      epochs,
      proof_window: n(form.proof_window, 0),
      dispute_window: n(form.dispute_window, 0),
      arbiter_window: n(form.arbiter_window, 0),
      claim_grace: n(form.claim_grace, 0),
    };
  })();

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Lock the budget, set the rules. Once the campaign is created, no one can change them."
        actions={
          <>
            <TryRampButton kind="deposit" />
            <button
              type="button"
              onClick={() => {
                setForm(demoPreset(form.arbiter || MOCK_ACCOUNTS.arbiter));
                setTouched(false);
              }}
              className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2"
            >
              Demo preset
            </button>
          </>
        }
      />

      <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="grid gap-5">
          <Group title="Campaign" desc="The name clippers see, and the source content.">
            <div className="sm:col-span-2">
              <Field label="Title" error={shown.title} suffix={`${new TextEncoder().encode(form.title).length}/64`}>
                <input {...text("title")} placeholder="Summer collection clips" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Brief / source video link" help="Optional. The main content clippers will cut from." error={shown.brief_url}>
                <input {...text("brief_url")} placeholder="https://…" inputMode="url" />
              </Field>
            </div>
          </Group>

          <Group title="Budget and rate" desc="The budget is transferred to the contract at creation and split evenly across epochs.">
            <Field label="Total budget" help="USDC. Each epoch pays out budget ÷ epochs; whatever is left carries into the next epoch." error={shown.budget} suffix="USDC">
              <input {...text("budget")} inputMode="decimal" placeholder="500" />
            </Field>
            <FundingChoice value={fundWith} onChange={setFundWith} budget={budgetValue} />
            <Field label="Rate cap" help="The most you pay per 1,000 views. If demand is higher, the rate drops pro rata: r = min(cap, 1000·B/W)." error={shown.rate_max_per_1k} suffix="USDC / 1k">
              <input {...text("rate_max_per_1k")} inputMode="decimal" placeholder="1" />
            </Field>
          </Group>

          <Group title="Caps" desc="Per-epoch limits against bot views and any one person soaking up the budget.">
            <Field label="Cap per clip" help="The most views a single clip can count in one epoch." error={shown.cap_views_clip} suffix="views">
              <input {...text("cap_views_clip")} inputMode="numeric" />
            </Field>
            <Field label="Cap per human" help="The most views one person can count across all their clips." error={shown.cap_views_human} suffix="views">
              <input {...text("cap_views_human")} inputMode="numeric" />
            </Field>
            <Field label="Minimum views" help="A clip gaining less than this in an epoch counts as 0." error={shown.min_views} suffix="views">
              <input {...text("min_views")} inputMode="numeric" />
            </Field>
          </Group>

          <Group title="Timeline" desc="Every epoch: content → proof → challenge → response → arbiter → settle. The windows must fit inside the epoch.">
            <Field label="Start" help="How many seconds from now it starts (at least 30s, to leave time for signing)." error={shown.start_in} suffix={secs("start_in")}>
              <input {...text("start_in")} inputMode="numeric" />
            </Field>
            <Field label="Epochs" error={shown.epochs} suffix="max 52">
              <input {...text("epochs")} inputMode="numeric" />
            </Field>
            <Field label="Epoch length" help="In seconds." error={shown.epoch_len} suffix={secs("epoch_len")}>
              <input {...text("epoch_len")} inputMode="numeric" />
            </Field>
            <Field label="Proof window" help="How long closing proofs can be submitted after an epoch ends." error={shown.proof_window} suffix={secs("proof_window")}>
              <input {...text("proof_window")} inputMode="numeric" />
            </Field>
            <Field label="Challenge window" help="Half for opening challenges, half for responding to them." error={shown.dispute_window} suffix={secs("dispute_window")}>
              <input {...text("dispute_window")} inputMode="numeric" />
            </Field>
            <Field label="Arbiter window" help="How long the arbiter has to decide challenges that got a response." error={shown.arbiter_window} suffix={secs("arbiter_window")}>
              <input {...text("arbiter_window")} inputMode="numeric" />
            </Field>
            <Field label="Claim window" help="How long claims stay open after the last settle; the remaining balance then goes back to the brand. At least one epoch." error={shown.claim_grace} suffix={secs("claim_grace")}>
              <input {...text("claim_grace")} inputMode="numeric" />
            </Field>
          </Group>

          <Group title="Challenges and holdback" desc="Bonded challenges, and a holdback against deleted videos.">
            <Field label="Holdback" help="This share of a payout is released if the video is still live in the next epoch; not applied in the last epoch." error={shown.holdback_pct} suffix="%">
              <input {...text("holdback_pct")} inputMode="decimal" />
            </Field>
            <Field label="Challenge bond" help="Posted by both the challenger and the responder; the loser forfeits it." error={shown.bond} suffix="USDC">
              <input {...text("bond")} inputMode="decimal" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Arbiter address" help="Decides challenges that got a response. Can&apos;t be the brand. Defaults to the team arbiter account." error={shown.arbiter}>
                <input {...text("arbiter")} className={`${inputCls(shown.arbiter)} font-mono text-xs`} spellCheck={false} />
              </Field>
            </div>
          </Group>

          <Group title="Platforms and identity" desc="The platforms proofs are accepted from, and the unique-human requirement.">
            <div className="sm:col-span-2">
              <span className="text-sm font-medium">Platforms</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["youtube", "demo"] as Platform[]).map((p) => {
                  const on = form.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      aria-pressed={on}
                      className={`rounded-full border px-4 py-2 text-sm transition ${on ? "border-transparent bg-lime text-lime-fg" : "border-border-strong hover:bg-surface-2"}`}
                    >
                      {p === "youtube" ? "YouTube" : "Demo (live demo)"}
                    </button>
                  );
                })}
              </div>
              {shown.platforms && <span className="mt-1 block text-xs text-danger">{shown.platforms}</span>}
            </div>
            <label className="flex items-start gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.require_humanity}
                onChange={(e) => set("require_humanity", e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--lime)]"
              />
              <span className="text-sm">
                <span className="font-medium">Require human verification</span>
                <span className="block text-muted">Verification is required before joining; one person joins a campaign once.</span>
              </span>
            </label>
          </Group>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <PhaseTimeline params={preview} now={now} compact />
          <div className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
            <p className="text-sm text-muted">
              {fundWith === "xlm"
                ? "On submit, your XLM is swapped for USDC on Soroswap and locked in the contract in one transaction; if the swap fails, nothing is locked."
                : "On submit, the budget is transferred from your wallet to the contract."}{" "}
              These rules <strong className="text-fg">can never be changed</strong> afterwards.
            </p>
            {touched && Object.keys(errors).length > 0 && (
              <p className="mt-3 text-sm text-danger">{Object.keys(errors).length} field(s) need fixing.</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="label-mono mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm text-ink-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
              {needWallet ? "Connect a wallet first" : pending ? "Signing…" : fundWith === "xlm" ? "Fund with XLM and create" : "Create campaign"}
            </button>
          </div>
        </aside>
      </form>
    </>
  );
}
