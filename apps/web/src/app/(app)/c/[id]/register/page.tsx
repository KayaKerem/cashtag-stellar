import { PageHeader, Placeholder } from "@/components/layout/PageHeader";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title={`Kampanya #${id} · Klip kaydet`} description="Videonun linkini gir; açılış kanıtı zkTLS ile üretilir." />
      <Placeholder task="S08" />
    </>
  );
}
