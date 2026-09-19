import type { Metadata } from "next";
import { MePanel } from "@/components/me/MePanel";

export default function Page() {
  return <MePanel />;
}

export const metadata: Metadata = { title: "My dashboard", description: "Your clips, epoch status and earnings." };
