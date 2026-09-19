import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Placeholder } from "@/components/layout/PageHeader";

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <section id="campaigns" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <h2 className="display mb-6 text-3xl">Aktif kampanyalar</h2>
        <Placeholder task="S03 sonrası (kampanya listesi)" />
      </section>
    </>
  );
}
