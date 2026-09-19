import type { Metadata } from "next";
import { ArbiterPage } from "@/components/arbiter/ArbiterPage";

export default function Page() {
  return <ArbiterPage />;
}

export const metadata: Metadata = { title: "Hakem", description: "Cevaplanmış itirazlara karar ver." };
