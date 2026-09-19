import { notFound } from "next/navigation";
import { JoinFlow } from "@/components/join/JoinFlow";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <JoinFlow id={BigInt(id)} />;
}
