import { ButtonLink } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { IconTile } from "@/components/ui/IconTile";
import { ClaimCard } from "./ClaimCard";
import { FlowCard } from "./FlowCard";
import { ProofStepsCard } from "./ProofStepsCard";
import { Reveal } from "./Reveal";

const DOCS = "https://github.com/KayaKerem/cliprail-stellar/blob/main/docs/ARCHITECTURE.md";

function CardText({
  icon,
  title,
  children,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <div className="flex flex-col items-start">
      <IconTile>{icon}</IconTile>
      <h3 className="display mt-6 text-[26px] leading-[1.15] sm:text-[32px]">{title}</h3>
      <p className="mt-3 text-[15px] leading-[1.45] text-muted">{children}</p>
      <ButtonLink href={href} variant="soft" external className="mt-6">
        Daha fazla
      </ButtonLink>
    </div>
  );
}

const icons = {
  split: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h5l6 6-6 6H4M15 12h5" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v6c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  coin: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10.5c0-1 1.1-1.5 2.5-1.5s2.5.6 2.5 1.6c0 2.3-5 1.2-5 3.6 0 1 1.1 1.8 2.5 1.8s2.5-.6 2.5-1.5" />
    </svg>
  ),
};

const card =
  "rounded-[25.6px] border border-border bg-surface p-6 shadow-card sm:p-[38.4px]";

export function HowItWorks() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28">
      <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <Eyebrow>Nasıl çalışır</Eyebrow>
        <h2 className="display mt-5 text-[36px] leading-[1.15] sm:text-[48px] sm:leading-[57.6px]">
          <em>Kanıtlanabilir</em> kampanya rayları
        </h2>
        <p className="mt-5 max-w-[620px] text-[15px] leading-[1.5] text-muted sm:text-base">
          İzlenme sayısı platformun gösterdiği haliyle kanıtlanır, her katılımcı tek bir insandır ve dağıtım kuralları
          kampanya kurulduktan sonra kimse tarafından değiştirilemez. Hepsi Stellar testnet&apos;te, herkesin
          görebileceği bir kontratta.
        </p>
      </Reveal>

      <div className="mx-auto mt-14 grid max-w-[1280px] gap-5 lg:grid-cols-[1fr_1.67fr] lg:grid-rows-[auto_auto]">
        <Reveal className={`${card} flex flex-col gap-8 lg:row-span-2`}>
          <CardText icon={icons.split} title="Oransal dağıtım" href={`${DOCS}#5-kampanya-yaşam-döngüsü`}>
            &quot;İlk gelen alır&quot; yarışı yok. Dönemin bütçesi, kanıtlanmış izlenme payına göre bölünür; klip ve insan
            başına tavanlar bir kişinin bütçeyi yutmasını engeller.
          </CardText>
          <FlowCard />
        </Reveal>

        <Reveal delay={120} className={`${card} grid items-center gap-7 md:grid-cols-2`}>
          <CardText icon={icons.shield} title="Kanıt kontrat içinde" href={`${DOCS}#8-doğrulama-katmanı-reclaim-zktls`}>
            Reclaim zkTLS kanıtının imzası, URL&apos;si, açıklamadaki kod ve izlenme sayısı &quot;backend söyledi&quot;
            ile değil, doğrudan Soroban kontratında kontrol edilir.
          </CardText>
          <ProofStepsCard />
        </Reveal>

        <Reveal delay={200} className={`${card} grid items-center gap-7 md:grid-cols-2`}>
          <CardText icon={icons.coin} title="Payını çek" href={`${DOCS}#7-teminatlı-itiraz`}>
            Settle sonrası pay USDC olarak cüzdanına gelir. %20&apos;lik holdback, video bir sonraki dönem de yayındaysa
            serbest kalır; itiraz süreci teminatlıdır.
          </CardText>
          <ClaimCard />
        </Reveal>
      </div>
    </section>
  );
}
