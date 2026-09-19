"use client";

import { AddressChip } from "@/components/common/AddressChip";
import { Amount } from "@/components/common/Amount";
import { CodeBadge } from "@/components/common/CodeBadge";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { StatusPill, type PillStatus } from "@/components/common/StatusPill";
import { useToast } from "@/components/common/Toast";
import { TxButton } from "@/components/common/TxButton";
import { TxLink } from "@/components/common/TxLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { useNow } from "@/lib/hooks/useNow";
import { useState } from "react";

const FAKE_HASH = "9f3c1a7e2b8d4c6f0a1e3b5d7c9f2a4e6b8d0c1e3f5a7b9d1c3e5f7a9b1d3c5e";
const STATUSES: PillStatus[] = [
  "Active",
  "Challenged",
  "Responded",
  "Excluded",
  "Claimable",
  "Claimed",
  "Holdback",
  "Pending",
  "Open",
  "ChallengerWon",
  "ClipperWon",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
      <h2 className="label-mono mb-4 text-xs text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function ComponentsPage() {
  const toast = useToast();
  const now = useNow();
  const [mode, setMode] = useState<"live" | "before">("live");

  // Demo zaman çizelgesi: 60 sn önce başlamış, 2 × 300 sn dönem (ARCHITECTURE §6 demo değerleri)
  const [start] = useState(() => BigInt(Math.floor(Date.now() / 1000)) - 60n);
  const params = {
    start: mode === "live" ? start : start + 600n,
    epoch_len: 300n,
    epochs: 2,
    proof_window: 90n,
    dispute_window: 90n,
    arbiter_window: 60n,
    claim_grace: 300n,
  };

  return (
    <>
      <PageHeader title="Bileşenler" description="S04 ortak bileşenlerinin vitrini (geliştirme sayfası)." />
      <div className="grid gap-5">
        <Section title="PhaseTimeline">
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => setMode("live")} className={`rounded-full px-3 py-1 text-xs ${mode === "live" ? "bg-ink text-ink-fg" : "bg-surface-2"}`}>
              Başlamış
            </button>
            <button type="button" onClick={() => setMode("before")} className={`rounded-full px-3 py-1 text-xs ${mode === "before" ? "bg-ink text-ink-fg" : "bg-surface-2"}`}>
              Başlamamış
            </button>
          </div>
          <PhaseTimeline params={params} now={now} />
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Amount · TxLink · AddressChip">
            <div className="flex flex-col items-start gap-3">
              <Amount value={5_000_000_000n} className="text-2xl" />
              <Amount value={4_812_345n} decimals={7} />
              <TxLink hash={FAKE_HASH} />
              <AddressChip address="GCV77O3T74VBDPL5TGCXVDYCASS2YAEFIQIHI4LUWRTWN4QAKX4OMGPD" label="Clipper" you />
            </div>
          </Section>

          <Section title="CodeBadge">
            <CodeBadge code="CR-7K3X9A" />
            <div className="mt-3">
              <CodeBadge code="CR-P2M4QZ" size="sm" />
            </div>
          </Section>
        </div>

        <Section title="StatusPill">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="TxButton · Toast">
            <div className="flex flex-wrap gap-2">
              <TxButton
                action={() => new Promise<{ txHash: string }>((r) => setTimeout(() => r({ txHash: FAKE_HASH }), 1200))}
                successTitle="Claim edildi"
                successBody={() => "12.40 USDC cüzdanına gönderildi."}
              >
                Başarılı tx
              </TxButton>
              <TxButton
                variant="outline"
                action={() => new Promise<{ txHash: string }>((_, rej) => setTimeout(() => rej(new Error("Error(Contract, #8)")), 900))}
                successTitle="-"
              >
                Kontrat hatası
              </TxButton>
              <TxButton variant="outline" disabledReason="Kanıt penceresi henüz açılmadı" action={async () => ({ txHash: "" })} successTitle="-">
                Pasif
              </TxButton>
              <button type="button" onClick={() => toast.error(new Error("Error(Contract, #7)"), "Katılım başarısız")} className="rounded-full bg-surface-2 px-4 text-xs">
                ErrorToast (#7)
              </button>
            </div>
          </Section>

          <Section title="EmptyState · Skeleton">
            <EmptyState
              title="Henüz klip yok"
              description="Bir kampanyaya katıl, kodu videonun açıklamasına ekle ve linki kaydet."
              action={<ButtonLink href="/" variant="outline">Kampanyalara göz at</ButtonLink>}
            />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
