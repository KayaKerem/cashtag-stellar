import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandPanel } from "@/components/brand/BrandPanel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <BrandPanel id={BigInt(id)} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Brand panel · Campaign #${id}`, description: "Budget, challenges, settle and refund." };
}
