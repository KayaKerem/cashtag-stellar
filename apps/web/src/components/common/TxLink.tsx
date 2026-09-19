import { explorerTxUrl } from "@cliprail/shared";

export function TxLink({ hash, className = "" }: { hash: string; className?: string }) {
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      title={hash}
      className={`inline-flex items-center gap-1 font-mono text-xs underline decoration-border-strong underline-offset-4 hover:decoration-fg ${className}`}
    >
      tx {short} <span aria-hidden>↗</span>
    </a>
  );
}
