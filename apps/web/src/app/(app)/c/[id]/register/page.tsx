import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RegisterClip } from "@/components/register/RegisterClip";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <RegisterClip id={BigInt(id)} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Register clip · Campaign #${id}`, description: "Paste your link; the opening proof is generated with zkTLS." };
}
