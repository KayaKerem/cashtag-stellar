import type { Metadata } from "next";
import { CampaignFormPage } from "@/components/brand/CampaignFormPage";

export default function Page() {
  return <CampaignFormPage />;
}

export const metadata: Metadata = { title: "Yeni kampanya", description: "Bütçeyi kilitle, kuralları belirle." };
