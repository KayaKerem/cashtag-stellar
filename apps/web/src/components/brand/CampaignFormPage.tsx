"use client";

import { MOCK_ACCOUNTS } from "@cliprail/client";
import { parseUsdc, type Platform } from "@cliprail/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PhaseTimeline } from "@/components/common/PhaseTimeline";
import { FundingChoice, SWAP_CAMPAIGN_TOKEN, SWAP_TOKEN_IN, swapErrorMessage, type FundWith } from "./SwapFunding";
import { useToast } from "@/components/common/Toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { useApi } from "@/lib/api/ApiProvider";
import { useWrite } from "@/lib/api/hooks";
import { buildParams, demoPreset, emptyForm, type CampaignForm, type FormErrors } from "@/lib/campaignForm";
import { formatDuration, useNow } from "@/lib/hooks/useNow";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Key = keyof CampaignForm;

function Field({
  label,
  help,
  error,
  suffix,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {suffix && <span className="font-mono text-[11px] font-normal text-muted">{suffix}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : (
        help && <span className="mt-1 block text-xs text-muted">{help}</span>
      )}
    </label>
  );
}

const inputCls = (err?: string) =>
  `h-11 w-full rounded-xl border bg-surface px-3.5 text-sm outline-none transition focus:border-fg ${
    err ? "border-danger" : "border-border-strong"
  }`;

function Group({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-[20px] border border-border bg-surface p-5 shadow-card sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h2 className="display text-xl">{title}</h2>
      <p className="mt-1 text-sm text-muted">{desc}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function CampaignFormPage() {
  const router = useRouter();
  const toast = useToast();
  const { account, mode } = useApi();
  const { connected, connect } = useWallet();
  const now = useNow();
  const [form, setForm] = useState<CampaignForm>(() => emptyForm(MOCK_ACCOUNTS.arbiter));
  const [touched, setTouched] = useState(false);
  const [fundWith, setFundWith] = useState<FundWith>("usdc");

  const { params, errors } = useMemo(() => buildParams(form, account, now), [form, account, now]);
  const shown: FormErrors = touched ? errors : {};

  const create = useWrite((api, p: NonNullable<typeof params>) => api.createCampaign(p));
  const createSwap = useWrite((api, p: NonNullable<typeof params>) =>
    api.createCampaignWithSwap({ ...p, token: SWAP_CAMPAIGN_TOKEN }, { tokenIn: SWAP_TOKEN_IN }),
  );
  const pending = create.isPending || createSwap.isPending;
  const budgetValue = (() => {
    try {
      return form.budget.trim() ? parseUsdc(form.budget) : null;
    } catch {
      return null;
    }
  })();

  const set = <K extends Key>(k: K, v: CampaignForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: Key) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never),
    className: inputCls(shown[k]),
  });
  const secs = (k: Key) => {
    const v = form[k] as string;
    return /^\d+$/.test(v) ? formatDuration(Number(v)) : undefined;
  };
  const togglePlatform = (p: Platform) =>
    set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);

  const needWallet = mode === "chain" && !connected;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (needWallet) {
      await connect();
      return;
    }
    if (!params) {
      toast.show({ tone: "error", title: "Formda düzeltilmesi gereken alanlar var" });
      return;
    }
    try {
      if (fundWith === "xlm") {
        const res = await createSwap.mutateAsync(params);
        toast.success(`Kampanya #${res.id} kuruldu`, {
          txHash: res.txHash,
          body: "XLM Soroswap'ta USDC'ye çevrilip kontrata kilitlendi.",
        });
        router.push(`/c/${res.id}`);
      } else {
        const res = await create.mutateAsync(params);
        toast.success(`Kampanya #${res.id} kuruldu`, { txHash: res.txHash, body: "Bütçe kontrata kilitlendi." });
        router.push(`/c/${res.id}`);
      }
    } catch (err) {
      if (fundWith === "xlm") toast.show({ tone: "error", title: "Kampanya kurulamadı", body: swapErrorMessage(err) });
      else toast.error(err, "Kampanya kurulamadı");
    }
  }

  // Önizleme: form geçerli olmasa da okunabilen alanlarla zaman çizelgesi
  const preview = (() => {
    const n = (v: string, d: number) => (/^\d+$/.test(v) ? BigInt(v) : BigInt(d));
    const epochs = Math.min(Math.max(Number(n(form.epochs, 1)), 1), 8);
    return {
      start: now + n(form.start_in, 60),
      epoch_len: n(form.epoch_len, 300) || 1n,
      epochs,
      proof_window: n(form.proof_window, 0),
      dispute_window: n(form.dispute_window, 0),
      arbiter_window: n(form.arbiter_window, 0),
      claim_grace: n(form.claim_grace, 0),
    };
  })();

  return (
    <>
      <PageHeader
        title="Yeni kampanya"
        description="Bütçeyi kilitle, kuralları belirle. Kampanya kurulduktan sonra kurallar kimse tarafından değiştirilemez."
        actions={
          <button
            type="button"
            onClick={() => {
              setForm(demoPreset(form.arbiter || MOCK_ACCOUNTS.arbiter));
              setTouched(false);
            }}
            className="label-mono h-10 rounded-full border border-border-strong px-5 text-[12px] hover:bg-surface-2"
          >
            Demo ön ayarı
          </button>
        }
      />

      <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="grid gap-5">
          <Group title="Kampanya" desc="Clipper'ların göreceği ad ve kaynak içerik.">
            <div className="sm:col-span-2">
              <Field label="Başlık" error={shown.title} suffix={`${new TextEncoder().encode(form.title).length}/64`}>
                <input {...text("title")} placeholder="Yaz koleksiyonu klipleri" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Brief / kaynak video linki" help="İsteğe bağlı. Clipper'ların keseceği ana içerik." error={shown.brief_url}>
                <input {...text("brief_url")} placeholder="https://…" inputMode="url" />
              </Field>
            </div>
          </Group>

          <Group title="Bütçe ve oran" desc="Bütçe kampanya kurulurken kontrata transfer edilir ve dönemlere eşit bölünür.">
            <Field label="Toplam bütçe" help="USDC. Her dönem bütçe/dönem sayısı kadar dağıtılır; harcanmayan sonraki döneme devreder." error={shown.budget} suffix="USDC">
              <input {...text("budget")} inputMode="decimal" placeholder="500" />
            </Field>
            <FundingChoice value={fundWith} onChange={setFundWith} budget={budgetValue} />
            <Field label="Oran tavanı" help="1000 izlenme başına en fazla ödeme. Talep fazlaysa oran orantılı düşer: r = min(tavan, 1000·B/W)." error={shown.rate_max_per_1k} suffix="USDC / 1k">
              <input {...text("rate_max_per_1k")} inputMode="decimal" placeholder="1" />
            </Field>
          </Group>

          <Group title="Tavanlar" desc="Bot izlenmeye ve tek kişinin bütçeyi yutmasına karşı dönem başına sınırlar.">
            <Field label="Klip başına tavan" help="Bir klibin bir dönemde sayılacak en fazla izlenmesi." error={shown.cap_views_clip} suffix="izlenme">
              <input {...text("cap_views_clip")} inputMode="numeric" />
            </Field>
            <Field label="İnsan başına tavan" help="Bir kişinin tüm klipleri toplamında sayılacak en fazla izlenme." error={shown.cap_views_human} suffix="izlenme">
              <input {...text("cap_views_human")} inputMode="numeric" />
            </Field>
            <Field label="Minimum izlenme" help="Bir klibin dönemde bundan az artışı 0 sayılır." error={shown.min_views} suffix="izlenme">
              <input {...text("min_views")} inputMode="numeric" />
            </Field>
          </Group>

          <Group title="Zaman çizelgesi" desc="Her dönem: içerik → kanıt → itiraz → cevap → hakem → settle. Pencereler dönem süresine sığmalı.">
            <Field label="Başlangıç" help="Şu andan kaç saniye sonra başlasın (en az 30 sn; imza süresi için)." error={shown.start_in} suffix={secs("start_in")}>
              <input {...text("start_in")} inputMode="numeric" />
            </Field>
            <Field label="Dönem sayısı" error={shown.epochs} suffix="en fazla 52">
              <input {...text("epochs")} inputMode="numeric" />
            </Field>
            <Field label="Dönem süresi" help="Saniye." error={shown.epoch_len} suffix={secs("epoch_len")}>
              <input {...text("epoch_len")} inputMode="numeric" />
            </Field>
            <Field label="Kanıt penceresi" help="Dönem bitince kapanış kanıtlarının gönderildiği süre." error={shown.proof_window} suffix={secs("proof_window")}>
              <input {...text("proof_window")} inputMode="numeric" />
            </Field>
            <Field label="İtiraz penceresi" help="Yarısı itiraz açmak, yarısı cevap vermek için." error={shown.dispute_window} suffix={secs("dispute_window")}>
              <input {...text("dispute_window")} inputMode="numeric" />
            </Field>
            <Field label="Hakem penceresi" help="Cevaplanmış itirazlara hakemin karar süresi." error={shown.arbiter_window} suffix={secs("arbiter_window")}>
              <input {...text("arbiter_window")} inputMode="numeric" />
            </Field>
            <Field label="Claim süresi" help="Son settle'dan sonra claim için kalan süre; sonra kalan bakiye markaya döner. En az bir dönem." error={shown.claim_grace} suffix={secs("claim_grace")}>
              <input {...text("claim_grace")} inputMode="numeric" />
            </Field>
          </Group>

          <Group title="İtiraz ve holdback" desc="Teminatlı itiraz ve silinen videolara karşı tutma payı.">
            <Field label="Holdback" help="Payın bu kısmı video sonraki dönemde yayındaysa serbest kalır; son dönemde uygulanmaz." error={shown.holdback_pct} suffix="%">
              <input {...text("holdback_pct")} inputMode="decimal" />
            </Field>
            <Field label="İtiraz teminatı" help="İtiraz eden ve cevap veren yatırır; kaybeden kaybeder." error={shown.bond} suffix="USDC">
              <input {...text("bond")} inputMode="decimal" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Hakem adresi" help="Cevaplanmış itirazlara karar verir. Marka olamaz. Varsayılan: ekip hakem hesabı." error={shown.arbiter}>
                <input {...text("arbiter")} className={`${inputCls(shown.arbiter)} font-mono text-xs`} spellCheck={false} />
              </Field>
            </div>
          </Group>

          <Group title="Platformlar ve kimlik" desc="Kanıtı kabul edilecek platformlar ve tek insan şartı.">
            <div className="sm:col-span-2">
              <span className="text-sm font-medium">Platformlar</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["youtube", "demo"] as Platform[]).map((p) => {
                  const on = form.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      aria-pressed={on}
                      className={`rounded-full border px-4 py-2 text-sm transition ${on ? "border-transparent bg-lime text-lime-fg" : "border-border-strong hover:bg-surface-2"}`}
                    >
                      {p === "youtube" ? "YouTube" : "Demo (canlı gösterim)"}
                    </button>
                  );
                })}
              </div>
              {shown.platforms && <span className="mt-1 block text-xs text-danger">{shown.platforms}</span>}
            </div>
            <label className="flex items-start gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.require_humanity}
                onChange={(e) => set("require_humanity", e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--lime)]"
              />
              <span className="text-sm">
                <span className="font-medium">Tek insan zorunlu</span>
                <span className="block text-muted">Katılmadan önce insan doğrulaması gerekir; bir kişi kampanyaya bir kez katılır.</span>
              </span>
            </label>
          </Group>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <PhaseTimeline params={preview} now={now} compact />
          <div className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
            <p className="text-sm text-muted">
              {fundWith === "xlm"
                ? "Gönderdiğinde XLM tek işlemde Soroswap'ta USDC'ye çevrilir ve kontrata kilitlenir; takas başarısız olursa hiçbir şey kilitlenmez."
                : "Gönderdiğinde bütçe cüzdanından kontrata transfer edilir."}{" "}
              Bu kurallar sonradan <strong className="text-fg">değiştirilemez</strong>.
            </p>
            {touched && Object.keys(errors).length > 0 && (
              <p className="mt-3 text-sm text-danger">{Object.keys(errors).length} alanda hata var.</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="label-mono mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm text-ink-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
              {needWallet ? "Önce cüzdan bağla" : pending ? "İmzalanıyor…" : fundWith === "xlm" ? "XLM ile fonla ve kur" : "Kampanyayı kur"}
            </button>
          </div>
        </aside>
      </form>
    </>
  );
}
