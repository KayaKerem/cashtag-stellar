export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</div>;
}
