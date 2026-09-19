import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignPage } from "@/components/campaign/CampaignPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <CampaignPage id={BigInt(id)} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Campaign #${id}`, description: "Rules, epochs, clips and challenges." };
}
