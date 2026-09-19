import type { Metadata } from "next";
import { CampaignFormPage } from "@/components/brand/CampaignFormPage";

export default function Page() {
  return <CampaignFormPage />;
}

export const metadata: Metadata = { title: "New campaign", description: "Lock the budget, set the rules." };
