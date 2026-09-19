import { PageHeader, Placeholder } from "@/components/layout/PageHeader";

export default function Page() {
  return (
    <>
      <PageHeader title="Yeni kampanya" description="Bütçeyi kilitle, kuralları belirle. Kampanya kurulduktan sonra kurallar değiştirilemez." />
      <Placeholder task="S06" />
    </>
  );
}
