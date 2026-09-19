import type { Metadata } from "next";
import { ArbiterPage } from "@/components/arbiter/ArbiterPage";

export default function Page() {
  return <ArbiterPage />;
}

export const metadata: Metadata = { title: "Arbiter", description: "Decide the challenges that got a response." };
