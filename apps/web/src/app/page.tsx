import { CampaignList } from "@/components/campaign/CampaignList";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Kampanyalar"
        description="Bütçesi kontratta kilitli, kuralları değişmez kampanyalar. Katıl, klibini kaydet, izlenmen kadar kazan."
        actions={<ButtonLink href="/brand/new" variant="outline">Kampanya kur</ButtonLink>}
      />
      <CampaignList />
    </div>
  );
}
