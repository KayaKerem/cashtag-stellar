export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Numbers proven · One human, once · Rules never change</p>
        <p>
          Hackathon build on Stellar testnet ·{" "}
          <a
            href="https://github.com/KayaKerem/cashtag-stellar"
            className="underline-offset-4 hover:text-fg hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
