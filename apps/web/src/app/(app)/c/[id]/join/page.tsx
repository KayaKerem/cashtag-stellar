import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinFlow } from "@/components/join/JoinFlow";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <JoinFlow id={BigInt(id)} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Katıl · Kampanya #${id}`, description: "Cüzdan, insan doğrulaması ve katılım kodu." };
}
