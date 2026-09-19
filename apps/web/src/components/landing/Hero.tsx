import { ButtonLink } from "@/components/ui/Button";
import { FeatureChip, TagChip } from "@/components/ui/Chip";
import { ProofCard } from "./ProofCard";

function StellarMarks() {
  // Küçük ağ/varlık işaretleri: Stellar, USDC, Soroban (kendi çizimimiz)
  return (
    <span className="flex -space-x-1" aria-hidden>
      <span className="grid size-4 place-items-center rounded-full bg-ink text-[8px] font-bold text-ink-fg ring-2 ring-surface">✦</span>
      <span className="grid size-4 place-items-center rounded-full bg-info text-[8px] font-bold text-white ring-2 ring-surface">$</span>
      <span className="grid size-4 place-items-center rounded-full bg-lime text-[8px] font-bold text-lime-fg ring-2 ring-surface">S</span>
    </span>
  );
}

export function Hero() {
  return (
    <section className="px-2 pb-2 sm:px-2.5">
      <div className="grid gap-2 md:grid-cols-2">
        <div className="flex flex-col items-center justify-center rounded-[20px] bg-panel px-5 py-12 text-center sm:px-10 md:min-h-[528px]">
          <TagChip>
            Stellar testnet
            <StellarMarks />
          </TagChip>
          <h1 className="display mt-6 max-w-[520px] text-[32px] leading-[1.15] sm:text-[40px] sm:leading-[48px]">
            Her izlenme kanıtlı. Her ödeme kurala bağlı.
          </h1>
          <p className="mt-5 max-w-[440px] text-[15px] leading-[1.45] text-muted sm:text-base">
            Marka bütçesini Soroban escrow&apos;una kilitler. Clipper&apos;lar tek bir gerçek insan olduklarını
            kanıtlar, klibi kendi hesaplarında paylaşır. İzlenme sayısı zkTLS ile kontrata gelir ve bütçe her dönem,
            değişmez kurallarla, izlenme payına göre USDC olarak dağıtılır.
          </p>
          <div className="mt-7">
            <ButtonLink href="#campaigns">Kampanyalara göz at</ButtonLink>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <FeatureChip>zkTLS kanıtı</FeatureChip>
            <FeatureChip>Tek insan</FeatureChip>
            <FeatureChip>Değişmez kurallar</FeatureChip>
          </div>
        </div>

        <div className="flex items-center justify-center rounded-[24px] bg-panel-2 px-4 py-12 md:min-h-[528px]">
          <ProofCard />
        </div>
      </div>
    </section>
  );
}
