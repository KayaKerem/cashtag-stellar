import { notFound } from "next/navigation";
import { BrandPanel } from "@/components/brand/BrandPanel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <BrandPanel id={BigInt(id)} />;
}
