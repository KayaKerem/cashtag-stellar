"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AddressChip } from "@/components/common/AddressChip";
import { EmptyState, Skeleton } from "@/components/common/EmptyState";
import { TxButton } from "@/components/common/TxButton";
import { TxLink } from "@/components/common/TxLink";
import { useToast } from "@/components/common/Toast";
import { qk, useIgPosts, useMessageSigner } from "@/lib/api/hooks";
import { approveIgParticipant, approveIgPost, rejectIgPost, type IgPost } from "@/lib/api/instagram";
import { instagramUrl } from "@/lib/video";

const isStellarAddress = (s: string) => /^G[A-Z2-7]{55}$/.test(s);
const count = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const inputCls = "h-9 w-24 rounded-lg border border-border-strong bg-surface px-2.5 text-right font-mono text-sm tabular outline-none focus:border-fg";

function ApproveParticipant({ campaignId, isBrand }: { campaignId: bigint; isBrand: boolean }) {
  const signer = useMessageSigner();
  const qc = useQueryClient();
  const [wallet, setWallet] = useState("");
  const [last, setLast] = useState<{ wallet: string; txHash: string } | null>(null);
  const w = wallet.trim();
  const reason = !isBrand ? "Only the organiser can approve participants" : !signer ? "Connect your wallet" : !isStellarAddress(w) ? "Enter a wallet address (G…)" : null;

  return (
    <div className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
      <h3 className="display text-lg">Approve participant</h3>
      <p className="mt-1 text-sm text-muted">
        Paste the wallet address a participant sent you. Approving registers it for this campaign so it can join; you sign a message, no fee.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="G…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Participant wallet address"
          className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-3.5 font-mono text-xs outline-none focus:border-fg"
        />
        <TxButton
          disabledReason={reason}
          action={() => approveIgParticipant(signer!, campaignId, w)}
          successTitle="Participant approved"
          successBody={() => "They can join the campaign now."}
          onSuccess={(r) => {
            setLast({ wallet: w, txHash: r.txHash });
            setWallet("");
            qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
          }}
        >
          Approve
        </TxButton>
      </div>
      {last && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          Approved <AddressChip address={last.wallet} /> <TxLink hash={last.txHash} />
        </p>
      )}
    </div>
  );
}

function PostRow({ post, campaignId, isBrand }: { post: IgPost; campaignId: bigint; isBrand: boolean }) {
  const signer = useMessageSigner();
  const toast = useToast();
  const qc = useQueryClient();
  const [likes, setLikes] = useState(String(post.likes));
  const [comments, setComments] = useState(String(post.comments));
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const l = count(likes);
  const c = count(comments);
  const reason = !isBrand ? "Only the organiser can confirm" : !signer ? "Connect your wallet" : l === null || c === null ? "Enter whole numbers" : null;

  async function confirm() {
    if (reason || l === null || c === null) return;
    setPending("confirm");
    try {
      const p = await approveIgPost(signer!, campaignId, post.code, l, c);
      toast.success("Engagement confirmed", { body: `${post.code}: score ${(p.score ?? (p.approved ? p.likes + p.comments : 0)).toLocaleString("en-US")}` });
      qc.invalidateQueries({ queryKey: qk.igPosts(campaignId) });
    } catch (err) {
      toast.error(err, "Couldn't confirm the post");
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    if (!signer || !isBrand) return;
    setPending("reject");
    try {
      await rejectIgPost(signer, campaignId, post.code);
      toast.success("Post rejected", { body: `${post.code} was removed from the campaign.` });
      qc.invalidateQueries({ queryKey: qk.igPosts(campaignId) });
    } catch (err) {
      toast.error(err, "Couldn't reject the post");
    } finally {
      setPending(null);
    }
  }

  return (
    <tr className="border-b border-border align-middle last:border-b-0">
      <td className="px-4 py-3">
        <a href={instagramUrl(post.code)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">
          {post.code} ↗
        </a>
      </td>
      <td className="px-4 py-3 font-mono text-xs">{post.participantCode}</td>
      <td className="px-4 py-3">
        <AddressChip address={post.wallet} />
      </td>
      <td className="px-4 py-3">
        <input value={likes} onChange={(e) => setLikes(e.target.value)} onFocus={(e) => e.currentTarget.select()} inputMode="numeric" aria-label="Likes" disabled={!isBrand} className={inputCls} />
      </td>
      <td className="px-4 py-3">
        <input value={comments} onChange={(e) => setComments(e.target.value)} onFocus={(e) => e.currentTarget.select()} inputMode="numeric" aria-label="Comments" disabled={!isBrand} className={inputCls} />
      </td>
      <td className="px-4 py-3 text-right font-mono tabular">{post.score.toLocaleString("en-US")}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`label-mono rounded-full px-2.5 py-1 text-[10px] ${post.approved ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {post.approved ? "Confirmed" : "Pending"}
          </span>
          {isBrand && (
            <span title={reason ?? undefined}>
              <button
                type="button"
                onClick={confirm}
                disabled={!!reason || !!pending}
                className="label-mono h-8 rounded-full border border-border-strong px-3 text-[10px] transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending === "confirm" ? "Signing…" : "Confirm"}
              </button>
            </span>
          )}
          {isBrand && !post.approved && (
            <button
              type="button"
              onClick={reject}
              disabled={!signer || !!pending}
              title="Remove this submission (e.g. someone else's post)"
              className="label-mono h-8 rounded-full border border-danger/40 px-3 text-[10px] text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending === "reject" ? "Signing…" : "Reject"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Brand panel section for Instagram campaigns: participant approval and engagement confirmation. */
export function InstagramPanel({ campaignId, isBrand }: { campaignId: bigint; isBrand: boolean }) {
  const posts = useIgPosts(campaignId);

  return (
    <section className="mb-10">
      <h2 className="display mb-1 text-2xl">Instagram</h2>
      <p className="mb-4 text-sm text-muted">
        Only participants you approve can join. Enter each post&apos;s likes and comments and confirm; the score (likes + comments) is what
        the contract pays on, pro rata. Confirm before the clips&apos; closing proofs are taken.
      </p>
      <div className="space-y-4">
        <ApproveParticipant campaignId={campaignId} isBrand={isBrand} />
        {posts.isLoading ? (
          <Skeleton className="h-32" />
        ) : posts.error ? (
          <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            Couldn&apos;t load the posts: {posts.error instanceof Error ? posts.error.message : String(posts.error)}
          </p>
        ) : !posts.data?.length ? (
          <EmptyState title="No posts yet" description="Posts show up here when participants submit them." />
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-3 font-normal">Post</th>
                  <th className="px-4 py-3 font-normal">Code</th>
                  <th className="px-4 py-3 font-normal">Wallet</th>
                  <th className="px-4 py-3 font-normal">Likes</th>
                  <th className="px-4 py-3 font-normal">Comments</th>
                  <th className="px-4 py-3 text-right font-normal">Score</th>
                  <th className="px-4 py-3 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {posts.data.map((p) => (
                  <PostRow key={`${p.code}:${p.approvedAt ?? 0}`} post={p} campaignId={campaignId} isBrand={isBrand} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
