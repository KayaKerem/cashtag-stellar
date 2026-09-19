import { notFound } from "next/navigation";
import { CampaignPage } from "@/components/campaign/CampaignPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <CampaignPage id={BigInt(id)} />;
}
