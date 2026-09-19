import { PageHeader, Placeholder } from "@/components/layout/PageHeader";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title={`Kampanya #${id}`} description="Kurallar, dönemler, klipler ve itirazlar." />
      <Placeholder task="S05" />
    </>
  );
}
