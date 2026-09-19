import { PageHeader, Placeholder } from "@/components/layout/PageHeader";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title={`Kampanya #${id} · Katıl`} description="Cüzdanını bağla, insan doğrulamasından geç, kodunu al." />
      <Placeholder task="S07" />
    </>
  );
}
