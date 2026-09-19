"use client";

import { useEffect, useRef, useState } from "react";
import { Amount } from "@/components/common/Amount";
import { TxButton } from "@/components/common/TxButton";

const MAX_EVIDENCE = 200; // bayt (contracts/cliprail/src/dispute.rs)

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
        <h2 className="display text-xl">İtiraz et</h2>
        <p className="mt-1 text-sm text-muted">
          {clipLabel} · Dönem {epoch + 1}
        </p>

        <label className="mt-5 block">
          <span className="flex items-baseline justify-between text-sm font-medium">
            Kanıt
            <span className={`font-mono text-[11px] ${tooLong ? "text-danger" : "text-muted"}`}>
              {bytes}/{MAX_EVIDENCE}
            </span>
          </span>
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={3}
            placeholder="Bot izlenme şüphesinin kanıtı: link ya da kısa açıklama"
            className="mt-1.5 w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-fg"
          />
        </label>

        <div className="mt-4 rounded-2xl bg-warning-soft p-4 text-sm text-warning">
          <p className="font-medium">
            <Amount value={bond} /> teminat yatıracaksın.
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>Clipper cevap vermezse itirazı kazanırsın: teminatın iade edilir, klip bu dönemden dışlanır.</li>
            <li>Clipper cevap verirse hakem karar verir; aleyhine karar çıkarsa teminatını kaybedersin.</li>
            <li>Dışlanan klibin payı sana dönmez, diğer clipper&apos;lara dağılır.</li>
          </ul>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2">
            Vazgeç
          </button>
          <TxButton
            variant="danger"
            disabledReason={!evidence.trim() ? "Kanıt gir" : tooLong ? "Kanıt çok uzun" : null}
            action={() => onSubmit(evidence.trim())}
            successTitle="İtiraz açıldı"
            successBody={(r) => `İtiraz #${r.disputeId}; clipper'ın cevap süresi başladı.`}
            onSuccess={() => ref.current?.close()}
          >
            Teminatı yatır ve itiraz et
          </TxButton>
        </div>
      </div>
    </dialog>
  );
}
