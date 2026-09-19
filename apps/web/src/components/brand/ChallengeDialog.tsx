"use client";

import { useEffect, useRef, useState } from "react";
import { Amount } from "@/components/common/Amount";
import { TxButton } from "@/components/common/TxButton";

const MAX_EVIDENCE = 200; // bytes (contracts/cliprail/src/dispute.rs)

export function ChallengeDialog({
  clipLabel,
  epoch,
  bond,
  onClose,
  onSubmit,
}: {
  clipLabel: string;
  epoch: number;
  bond: bigint;
  onClose(): void;
  onSubmit(evidence: string): Promise<{ disputeId: bigint; txHash: string }>;
}) {
  const [evidence, setEvidence] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const bytes = new TextEncoder().encode(evidence).length;
  const tooLong = bytes > MAX_EVIDENCE;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,480px)] rounded-[20px] border border-border bg-surface p-0 text-fg shadow-float backdrop:bg-black/50"
    >
      <div className="p-5 sm:p-6">
        <h2 className="display text-xl">Challenge clip</h2>
        <p className="mt-1 text-sm text-muted">
          {clipLabel} · Epoch {epoch + 1}
        </p>

        <label className="mt-5 block">
          <span className="flex items-baseline justify-between text-sm font-medium">
            Evidence
            <span className={`font-mono text-[11px] ${tooLong ? "text-danger" : "text-muted"}`}>
              {bytes}/{MAX_EVIDENCE}
            </span>
          </span>
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={3}
            placeholder="Evidence of suspected bot views: a link or a short note"
            className="mt-1.5 w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-fg"
          />
        </label>

        <div className="mt-4 rounded-2xl bg-warning-soft p-4 text-sm text-warning">
          <p className="font-medium">
            You&apos;re posting a <Amount value={bond} /> bond.
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>If the clipper doesn&apos;t respond, you win: your bond is returned and the clip is excluded from this epoch.</li>
            <li>If the clipper responds, the arbiter decides; if the ruling goes against you, you lose your bond.</li>
            <li>The excluded clip&apos;s share doesn&apos;t come back to you; it is split among the other clippers.</li>
          </ul>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2">
            Cancel
          </button>
          <TxButton
            variant="danger"
            disabledReason={!evidence.trim() ? "Enter some evidence" : tooLong ? "The evidence is too long" : null}
            action={() => onSubmit(evidence.trim())}
            successTitle="Challenge opened"
            successBody={(r) => `Challenge #${r.disputeId}; the clipper's response window has started.`}
            onSuccess={() => ref.current?.close()}
          >
            Post bond and challenge
          </TxButton>
        </div>
      </div>
    </dialog>
  );
}
