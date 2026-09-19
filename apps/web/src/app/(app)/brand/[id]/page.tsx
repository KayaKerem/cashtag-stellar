import { PageHeader, Placeholder } from "@/components/layout/PageHeader";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title={`Kampanya #${id} · Marka paneli`} description="Bütçe, klipler, itirazlar ve dönem settle işlemleri." />
      <Placeholder task="S10" />
    </>
  );
}
