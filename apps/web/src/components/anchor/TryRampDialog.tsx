"use client";

import type { TryDepositResult, TryWithdrawResult } from "@cliprail/client";
import { ANCHOR_RAMP_STEP_LABELS, formatTry, formatTryRate, type AnchorRampStep } from "@cliprail/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/common/CopyButton";
import { TxLink } from "@/components/common/TxLink";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";
import { ANCHOR_HOME_DOMAIN, useTryRamp } from "@/lib/api/ramp";
import { useWallet } from "@/lib/wallet/WalletProvider";

export type RampKind = "deposit" | "withdraw";

const STEPS: Record<RampKind, AnchorRampStep[]> = {
  deposit: ["discover", "trustline", "auth", "kyc", "quote", "deposit", "bank_transfer", "waiting", "done"],
  withdraw: ["discover", "auth", "kyc", "quote", "withdraw", "payment", "waiting", "done"],
};

const COPY: Record<RampKind, { title: string; desc: string; amountLabel: string; unit: string; placeholder: string; button: string }> = {
  deposit: {
    title: "Deposit TRY",
    desc: "Send TRY by bank transfer and get USDC in your wallet. The campaign budget is locked with that USDC.",
    amountLabel: "Amount to deposit",
    unit: "TRY",
    placeholder: "5000",
    button: "Deposit TRY",
  },
  withdraw: {
    title: "Withdraw to TRY",
    desc: "Send the USDC you earned to the anchor and get TRY in your bank account.",
    amountLabel: "Amount to withdraw",
    unit: "USDC",
    placeholder: "5",
    button: "Withdraw to TRY",
  },
};

/** TRY 2 decimals, USDC 7 (the same limit as the client `checkAmount`) */
const DECIMALS: Record<RampKind, number> = { deposit: 2, withdraw: 7 };
const IBAN_RE = /^TR\d{24}$/;

function normalizeAmount(v: string, decimals: number): string | null {
  const t = v.trim().replace(",", ".");
  return new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(t) && Number(t) > 0 ? t : null;
}

/** Returns the value once typing stops (400 ms), so the live rate query does not fire on every key */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Result = { kind: "deposit"; r: TryDepositResult } | { kind: "withdraw"; r: TryWithdrawResult };

export function TryRampDialog({ kind, onClose, onDone }: { kind: RampKind; onClose(): void; onDone?(r: Result): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ramp = useTryRamp();
  const { account, mode } = useApi();
  const wallet = useWallet();
  const c = COPY[kind];

  const [amount, setAmount] = useState("");
  const [iban, setIban] = useState("");
  const [step, setStep] = useState<AnchorRampStep | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const running = step !== null && step !== "done" && !error;
  const parsed = normalizeAmount(amount, DECIMALS[kind]);
  const ibanClean = iban.replace(/\s+/g, "").toUpperCase();
  const ibanBad = kind === "withdraw" && ibanClean !== "" && !IBAN_RE.test(ibanClean);
  const debounced = useDebounced(parsed);

  // Indicative rate before confirmation (SEP-38 price; no wallet or sign-in needed)
  const price = useQuery({
    queryKey: ["anchor", "price", ANCHOR_HOME_DOMAIN, kind, debounced],
    queryFn: () => ramp.priceTRY({ direction: kind, amount: debounced! }),
    enabled: debounced !== null && !result,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 0,
  });

  const needWallet = mode === "chain" && !wallet.connected;
  const disabledReason = needWallet
    ? "Connect a wallet first"
    : !parsed
      ? amount.trim()
        ? `Invalid amount (at most ${DECIMALS[kind]} decimals)`
        : "Enter an amount"
      : ibanBad
        ? "The IBAN must be 26 characters starting with TR"
        : !account
          ? "No account"
          : null;

  async function run() {
    if (disabledReason || running) return;
    setError(null);
    setStatusLabel(null);
    setStep("discover");
    try {
      const common = { account: account!, onStep: setStep, onUpdate: (t: { statusLabel: string }) => setStatusLabel(t.statusLabel) };
      const r: Result =
        kind === "deposit"
          ? { kind, r: await ramp.depositTRY({ ...common, amountTRY: parsed! }) }
          : { kind, r: await ramp.withdrawToTRY({ ...common, amountUSDC: parsed!, ...(ibanClean ? { iban: ibanClean } : {}) }) };
      setStep("done");
      setResult(r);
      onDone?.(r);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const steps = STEPS[kind];
  const stepIdx = step ? steps.indexOf(step) : -1;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        if (running) e.preventDefault(); // do not let Esc close it mid-transaction
      }}
      className="m-auto w-[min(92vw,520px)] rounded-[20px] border border-border bg-surface p-0 text-fg shadow-float backdrop:bg-black/50"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="display text-xl">{c.title}</h2>
            <p className="mt-1 text-sm text-muted">{c.desc}</p>
          </div>
          <span className="label-mono shrink-0 rounded-full border border-border-strong px-2 py-0.5 text-[9px] text-muted" title={ANCHOR_HOME_DOMAIN}>
            Anchor · SEP-6/10/12/38
          </span>
        </div>

        {result ? (
          <ResultView result={result} />
        ) : (
          <>
            <label className="mt-5 block">
              <span className="flex items-baseline justify-between text-sm font-medium">
                {c.amountLabel}
                <span className="font-mono text-[11px] font-normal text-muted">{c.unit}</span>
              </span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={running}
                inputMode="decimal"
                placeholder={c.placeholder}
                autoFocus
                className="mt-1.5 h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm outline-none transition focus:border-fg disabled:opacity-60"
              />
            </label>

            {kind === "withdraw" && (
              <label className="mt-3 block">
                <span className="flex items-baseline justify-between text-sm font-medium">
                  IBAN
                  <span className="font-mono text-[11px] font-normal text-muted">optional (test)</span>
                </span>
                <input
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  disabled={running}
                  placeholder="TR00 0000 0000 0000 0000 0000 00"
                  spellCheck={false}
                  className={`mt-1.5 h-11 w-full rounded-xl border bg-surface px-3.5 font-mono text-sm outline-none transition focus:border-fg disabled:opacity-60 ${ibanBad ? "border-danger" : "border-border-strong"}`}
                />
                <span className="mt-1 block text-xs text-muted">Leave it empty to pay out to the anchor&apos;s test IBAN (a simulated FAST payment).</span>
              </label>
            )}

            <div className="mt-4 rounded-2xl bg-panel p-4 text-sm" aria-live="polite">
              {!parsed ? (
                <p className="text-muted">Enter an amount to see the rate.</p>
              ) : price.isLoading || debounced !== parsed ? (
                <p className="text-muted">Getting the rate quote…</p>
              ) : price.error ? (
                <p className="text-danger">{errorMessage(price.error)}</p>
              ) : price.data ? (
                <>
                  <p>
                    <span className="font-mono text-lg tabular">
                      ≈ {kind === "deposit" ? `${Number(price.data.buyAmount).toFixed(2)} USDC` : formatTry(price.data.buyAmount)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {price.data.tryPerUsdc !== undefined && formatTryRate(price.data.tryPerUsdc)}
                    {price.data.feeTotal && ` · fee ${price.data.feeAsset?.startsWith("iso4217") ? formatTry(price.data.feeTotal) : `${Number(price.data.feeTotal).toFixed(4)} USDC`}`}
                    {" · "}indicative rate; a SEP-38 quote is locked on confirmation
                  </p>
                </>
              ) : null}
            </div>

            {step && (
              <ol className="mt-4 space-y-1.5 text-sm" aria-label="Transaction steps">
                {steps.map((s, i) => {
                  const state = error && i === stepIdx ? "error" : i < stepIdx || step === "done" ? "done" : i === stepIdx ? "active" : "todo";
                  return (
                    <li key={s} className={`flex items-center gap-2.5 ${state === "todo" ? "text-muted/60" : state === "error" ? "text-danger" : ""}`}>
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                          state === "done" ? "border-success bg-success text-white" : state === "active" ? "border-fg" : state === "error" ? "border-danger" : "border-border-strong"
                        }`}
                        aria-hidden
                      >
                        {state === "done" ? "✓" : state === "active" ? <span className="size-2 animate-pulse rounded-full bg-fg" /> : state === "error" ? "!" : ""}
                      </span>
                      <span>{ANCHOR_RAMP_STEP_LABELS[s]}</span>
                      {state === "active" && s === "waiting" && statusLabel && <span className="text-xs text-muted">· {statusLabel}</span>}
                    </li>
                  );
                })}
              </ol>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            {kind === "deposit" && (
              <p className="mt-4 text-xs text-muted">
                Wallet approvals: a USDC trustline (if missing) and the anchor sign-in (SEP-10). On the test anchor the bank transfer is simulated and KYC is auto-approved.
              </p>
            )}
            {kind === "withdraw" && (
              <p className="mt-4 text-xs text-muted">Wallet approvals: the anchor sign-in (SEP-10) and a USDC payment to the anchor account with a memo.</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => ref.current?.close()}
                disabled={running}
                className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2 disabled:opacity-50"
              >
                {error ? "Close" : "Cancel"}
              </button>
              <span title={disabledReason ?? undefined}>
                <button
                  type="button"
                  onClick={needWallet ? () => wallet.connect() : run}
                  disabled={(!needWallet && !!disabledReason) || running}
                  aria-busy={running}
                  className="label-mono inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[12px] text-ink-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {running && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
                  {needWallet ? "Connect wallet" : running ? "Working…" : error ? "Try again" : c.button}
                </button>
              </span>
            </div>
          </>
        )}

        <p className="mt-5 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
          The anchor converts between TRY and Stellar assets over SEP-10/12/38 and SEP-6. Real Turkish anchors such as BiLira use the same
          SEP interface; only the anchor address changes (<span className="font-mono">{ANCHOR_HOME_DOMAIN}</span>).
        </p>
      </div>
    </dialog>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted">{k}</span>
      <span className="text-right text-sm">{v}</span>
    </div>
  );
}

function ResultView({ result }: { result: Result }) {
  const { r } = result;
  const stellarHash = result.kind === "deposit" ? result.r.stellarTransactionId : result.r.paymentTxHash;
  return (
    <div className="mt-5">
      <div className="rounded-2xl bg-success-soft p-4">
        <p className="label-mono text-[10px] text-success">Completed · {r.statusLabel}</p>
        <p className="mt-1.5 font-mono text-2xl tabular">
          {result.kind === "deposit" ? `+${Number(result.r.usdcReceived).toFixed(2)} USDC` : formatTry(result.r.tryPaidOut)}
        </p>
        {r.tryPerUsdc !== undefined && <p className="mt-1 text-xs text-success">{formatTryRate(r.tryPerUsdc)}</p>}
      </div>
      <div className="mt-3 divide-y divide-border rounded-2xl border border-border px-4">
        {result.kind === "deposit" ? (
          <>
            <Row k="Sent" v={formatTry(result.r.amountTRY)} />
            {result.r.feeTRY && <Row k="Anchor fee" v={formatTry(result.r.feeTRY)} />}
            {result.r.bankName && <Row k="Bank" v={result.r.bankName} />}
            {result.r.iban && <Row k="Anchor IBAN" v={<span className="font-mono text-xs">{result.r.iban}</span>} />}
            {result.r.reference && (
              <Row
                k="Transfer reference"
                v={
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-xs">{result.r.reference}</span>
                    <CopyButton text={result.r.reference} />
                  </span>
                }
              />
            )}
          </>
        ) : (
          <>
            <Row k="Sent" v={`${Number(result.r.amountUSDC).toFixed(2)} USDC`} />
            {result.r.feeTRY && <Row k="Anchor fee" v={formatTry(result.r.feeTRY)} />}
            {result.r.iban && <Row k="Paid-out IBAN" v={<span className="font-mono text-xs">{result.r.iban}</span>} />}
            {result.r.payoutReference && <Row k="Payout reference" v={<span className="font-mono text-xs">{result.r.payoutReference}</span>} />}
          </>
        )}
        {stellarHash && <Row k="Stellar transaction" v={<TxLink hash={stellarHash} />} />}
      </div>
      <div className="mt-5 flex justify-end">
        <form method="dialog">
          <button type="submit" className="label-mono h-10 rounded-full bg-ink px-5 text-[12px] text-ink-fg hover:opacity-90">
            Done
          </button>
        </form>
      </div>
    </div>
  );
}

/** The "Deposit TRY" / "Withdraw to TRY" button + dialog */
export function TryRampButton({ kind, className = "", variant = "outline" }: { kind: RampKind; className?: string; variant?: "outline" | "soft" }) {
  const [open, setOpen] = useState(false);
  const cls =
    variant === "soft"
      ? "bg-panel-2 text-fg hover:opacity-90"
      : "border border-border-strong text-fg hover:bg-surface-2";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`label-mono inline-flex h-10 items-center justify-center rounded-full px-5 text-[12px] transition ${cls} ${className}`}>
        {COPY[kind].title}
      </button>
      {open && <TryRampDialog kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}
