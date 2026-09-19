import { CampaignList } from "@/components/campaign/CampaignList";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Campaigns"
        description="Campaigns with the budget locked in the contract and rules that never change. Join, register your clip, and earn on every proven view — up to the campaign's rate cap."
        actions={<ButtonLink href="/brand/new" variant="outline">Create campaign</ButtonLink>}
      />
      <CampaignList />
    </div>
  );
}
