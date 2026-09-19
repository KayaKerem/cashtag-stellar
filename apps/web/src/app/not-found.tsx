import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-24 text-center">
      <p className="label-mono text-sm text-muted">404</p>
      <h1 className="mt-2 display text-3xl">Page not found</h1>
      <Link href="/" className="mt-6 inline-block text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
        Back to campaigns
      </Link>
    </div>
  );
}
