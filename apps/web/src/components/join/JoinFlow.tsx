"use client";

import { canJoin } from "@cliprail/shared";
import { AddressChip } from "@/components/common/AddressChip";
import { CodeBadge } from "@/components/common/CodeBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { TxButton } from "@/components/common/TxButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CheckDot } from "@/components/ui/Chip";
import { useApi } from "@/lib/api/ApiProvider";
import { errorMessage } from "@/lib/api/errors";
import { useCampaign, useIsHuman, useParticipant, useWrite } from "@/lib/api/hooks";
import { useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";

type StepState = "done" | "current" | "locked";

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={`rounded-[20px] border p-5 transition ${
        state === "current" ? "border-fg bg-surface shadow-card" : "border-border bg-surface"
      } ${state === "locked" ? "opacity-55" : ""}`}
    >
      <div className="flex items-center gap-3">
        {state === "done" ? (
          <CheckDot className="size-7" />
        ) : (
          <span
            className={`grid size-7 place-items-center rounded-full font-mono text-xs ${
              state === "current" ? "bg-ink text-ink-fg" : "bg-surface-2 text-muted"
            }`}
          >
            {n}
          </span>
        )}
        <h2 className="display text-lg">{title}</h2>
      </div>
      {children && <div className="mt-4 pl-10">{children}</div>}
    </li>
  );
}

export function JoinFlow({ id }: { id: bigint }) {
  const { api, account, mode } = useApi();
  const wallet = useWallet();
  const now = useNow();
  const campaign = useCampaign(id);
  const human = useIsHuman(id, account);
  const participant = useParticipant(id, account);
  const registerHuman = useWrite((a, cid: bigint) => a.registerHuman(cid), { campaignId: id });
  const join = useWrite((a, cid: bigint) => a.join(cid), { campaignId: id });

  if (campaign.isLoading) return <Skeleton className="h-96" />;
  const c = campaign.data;
  if (!c) {
    return (
      <EmptyState
        title="Kampanya bulunamadı"
        description={campaign.error ? errorMessage(campaign.error) : undefined}
        action={<ButtonLink href="/" variant="outline">Kampanyalara dön</ButtonLink>}
      />
    );
  }

  const p = c.params;
  const walletOk = mode === "chain" ? wallet.connected && !!account : !!account;
  const needsHuman = p.require_humanity;
  const isHuman = !needsHuman || human.data === true;
  const joined = participant.data ?? null;
  const open = canJoin(p, now) && !c.refunded;

  const s1: StepState = walletOk ? "done" : "current";
  const s2: StepState = !walletOk ? "locked" : isHuman ? "done" : "current";
  const s3: StepState = joined ? "done" : walletOk && isHuman ? "current" : "locked";

  const sampleDesc = joined
    ? `#ad ${p.title} için hazırlanmış bir klip. ClipRail kodu: ${joined.code}`
    : "";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Kampanyaya katıl"
        description={
          <>
            <span className="text-fg">{p.title || `Kampanya #${c.id}`}</span> · üç adımda katıl, kodunu al, videonun
            açıklamasına ekle.
          </>
        }
      />

      {!open && !joined && (
        <p className="mb-5 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          Bu kampanyanın katılım süresi doldu; son dönemin içerik aşaması bittiği için yeni katılım alınmıyor.
        </p>
      )}

      <ol className="space-y-3">
        <Step n={1} title="Cüzdanını bağla" state={s1}>
          {walletOk && account ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <AddressChip address={account} you />
              {mode === "mock" && !wallet.connected && <span className="text-muted">Mock rolü (sağ alttan değiştirilebilir)</span>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => wallet.connect()}
              className="label-mono h-10 rounded-full bg-lime px-5 text-[12px] text-lime-fg hover:opacity-90"
            >
              Cüzdan bağla
            </button>
          )}
        </Step>

        <Step n={2} title="İnsan doğrulaması" state={s2}>
          {!needsHuman ? (
            <p className="text-sm text-muted">Bu kampanya tek insan doğrulaması istemiyor.</p>
          ) : s2 === "done" ? (
            <p className="text-sm text-muted">Bu kampanya için tek ve gerçek bir insan olarak kaydın var.</p>
          ) : s2 === "current" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-dashed border-border-strong p-4">
                <p className="text-sm font-medium">Self ile doğrula</p>
                <p className="mt-1 text-xs text-muted">
                  Pasaportunla, kimliğini göstermeden ZK kanıtı. Yakında; hackathon sürümünde demo doğrulaması kullanılıyor.
                </p>
                <span className="label-mono mt-3 inline-block rounded-full bg-surface-2 px-2.5 py-1 text-[10px] text-muted">Yakında</span>
              </div>
              <div className="rounded-2xl border border-border-strong p-4">
                <p className="text-sm font-medium">Demo doğrulaması</p>
                <p className="mt-1 text-xs text-muted">
                  Relayer bu cüzdanı kampanya için tek insan olarak kaydeder (humanity kontratı).
                </p>
                <TxButton
                  className="mt-3"
                  action={() => registerHuman.mutateAsync(id)}
                  successTitle="İnsan doğrulaması tamam"
                >
                  Doğrula
                </TxButton>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Önce cüzdanını bağla.</p>
          )}
        </Step>

        <Step n={3} title="Katıl ve kodunu al" state={s3}>
          {joined ? (
            <div className="space-y-4">
              <CodeBadge code={joined.code} />
              <div className="rounded-2xl bg-panel p-4 text-sm">
                <p className="font-medium">Bu kodu videonun açıklamasına ekle</p>
                <p className="mt-1 text-muted">
                  Kanıt, açıklamada bu kodu arar. Kod yoksa klip kaydı reddedilir. Reklam olduğunu belirtmek için #ad ekle.
                </p>
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-surface p-3">
                  <p className="min-w-0 flex-1 break-words font-mono text-xs">{sampleDesc}</p>
                  <CopyButton text={sampleDesc} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/c/${c.id}/register`}>Klibini kaydet</ButtonLink>
                <ButtonLink href={`/c/${c.id}`} variant="outline">
                  Kampanya sayfası
                </ButtonLink>
              </div>
            </div>
          ) : s3 === "current" ? (
            <TxButton
              action={() => join.mutateAsync(id)}
              successTitle="Kampanyaya katıldın"
              successBody={(r) => `Kodun: ${r.code}`}
              disabledReason={open ? null : "Katılım süresi doldu"}
            >
              Katıl
            </TxButton>
          ) : (
            <p className="text-sm text-muted">Önceki adımları tamamla.</p>
          )}
        </Step>
      </ol>
    </div>
  );
}
