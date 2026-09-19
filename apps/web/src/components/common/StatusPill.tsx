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
  Active: { label: "Active", tone: "bg-success-soft text-success" },
  Challenged: { label: "Challenged", tone: "bg-warning-soft text-warning" },
  Responded: { label: "Responded", tone: "bg-info-soft text-info" },
  Excluded: { label: "Excluded", tone: "bg-danger-soft text-danger" },
  Claimable: { label: "Claimable", tone: "bg-lime text-lime-fg" },
  Claimed: { label: "Claimed", tone: "bg-surface-2 text-muted" },
  Holdback: { label: "Holdback", tone: "bg-info-soft text-info" },
  Pending: { label: "Pending", tone: "bg-surface-2 text-muted" },
  Open: { label: "Open", tone: "bg-warning-soft text-warning" },
  ChallengerWon: { label: "Challenger won", tone: "bg-danger-soft text-danger" },
  ClipperWon: { label: "Clipper won", tone: "bg-success-soft text-success" },
};

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const s = MAP[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${s.tone}`}>
      {label ?? s.label}
    </span>
  );
}
