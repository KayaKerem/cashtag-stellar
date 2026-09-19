export type PillStatus =
  | "Active"
  | "Challenged"
  | "Responded"
  | "Excluded"
  | "Claimable"
  | "Claimed"
  | "Holdback"
  | "Pending"
  | "Open"
  | "ChallengerWon"
  | "ClipperWon";

const MAP: Record<PillStatus, { label: string; tone: string }> = {
  Active: { label: "Aktif", tone: "bg-success-soft text-success" },
  Challenged: { label: "İtirazlı", tone: "bg-warning-soft text-warning" },
  Responded: { label: "Cevaplandı", tone: "bg-info-soft text-info" },
  Excluded: { label: "Dışlandı", tone: "bg-danger-soft text-danger" },
  Claimable: { label: "Claim edilebilir", tone: "bg-lime text-lime-fg" },
  Claimed: { label: "Claim edildi", tone: "bg-surface-2 text-muted" },
  Holdback: { label: "Holdback", tone: "bg-info-soft text-info" },
  Pending: { label: "Bekliyor", tone: "bg-surface-2 text-muted" },
  Open: { label: "Açık", tone: "bg-warning-soft text-warning" },
  ChallengerWon: { label: "İtiraz kazandı", tone: "bg-danger-soft text-danger" },
  ClipperWon: { label: "Clipper kazandı", tone: "bg-success-soft text-success" },
};

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const s = MAP[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${s.tone}`}>
      {label ?? s.label}
    </span>
  );
}
