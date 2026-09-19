import { notFound } from "next/navigation";
import { RegisterClip } from "@/components/register/RegisterClip";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <RegisterClip id={BigInt(id)} />;
}
