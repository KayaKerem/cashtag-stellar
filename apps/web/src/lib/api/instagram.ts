import type { CliprailApi } from "@cliprail/shared";
import { API_MODE, CHAIN_CONFIG } from "./config";

/** A participant's Instagram post as the verifier stores it (`GET /ig/campaigns/:id/posts`). */
export interface IgPost {
  code: string;
  campaignId: string;
  wallet: string;
  participantCode: string;
  likes: number;
  comments: number;
  approved: boolean;
  submittedAt: number;
  approvedAt?: number;
  /** likes + comments once the organiser confirmed them, else 0 */
  score: number;
}

export interface MessageSigner {
  address: string;
  /** SEP-53 signature (base64) over `message` */
  signMessage(message: string): Promise<string>;
}

export const IG_ACTIONS = {
  submit: "cashtag:ig-submit",
  approve: "cashtag:ig-approve",
  reject: "cashtag:ig-reject",
  approveParticipant: "cashtag:ig-approve-participant",
} as const;

/** The signed body the verifier expects: `{ message, signature, address }`, message = JSON action + fields + ts. */
export async function signedBody(signer: MessageSigner, action: string, fields: Record<string, string | number>) {
  const message = JSON.stringify({ action, ...fields, ts: Math.floor(Date.now() / 1000) });
  const signature = await signer.signMessage(message);
  return { message, signature, address: signer.address };
}

const base = () => CHAIN_CONFIG.verifierUrl.replace(/\/$/, "");

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(res.status === 429 ? "Too many requests, try again in a minute." : (data?.error ?? `Verifier error (${res.status})`));
  }
  return data as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---- mock mode: an in-memory store, no signatures checked ----

const mockPosts = new Map<string, IgPost>();
const mockApproved = new Set<string>(); // `${campaignId}:${wallet}`
const mockTx = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const wait = () => new Promise((r) => setTimeout(r, 400));
const scored = (p: IgPost): IgPost => ({ ...p, score: p.approved ? p.likes + p.comments : 0 });

/** In mock mode: whether the organiser approved this wallet (the mock humanity is separate). */
export const mockIsApproved = (campaignId: bigint, wallet: string) => mockApproved.has(`${campaignId}:${wallet}`);

export async function listIgPosts(campaignId: bigint): Promise<IgPost[]> {
  if (API_MODE !== "chain") {
    return [...mockPosts.values()].filter((p) => p.campaignId === String(campaignId)).sort((a, b) => a.submittedAt - b.submittedAt).map(scored);
  }
  const { posts } = await call<{ posts: IgPost[] }>(`/ig/campaigns/${campaignId}/posts`);
  return posts;
}

/** Participant: registers their post (shortcode) with the verifier before the clip is registered on-chain. */
export async function submitIgPost(signer: MessageSigner, campaignId: bigint, code: string, api: CliprailApi): Promise<IgPost> {
  if (API_MODE !== "chain") {
    await wait();
    const me = await api.getParticipant(campaignId, signer.address);
    if (!me) throw new Error("Join the campaign first.");
    const cur = mockPosts.get(code);
    if (cur && (cur.campaignId !== String(campaignId) || cur.wallet !== signer.address))
      throw new Error("This post was already submitted by another participant.");
    const mine = [...mockPosts.values()].filter((p) => p.campaignId === String(campaignId) && p.wallet === signer.address);
    if (!cur && mine.length >= 20) throw new Error("At most 20 posts per participant in a campaign.");
    const p: IgPost = cur ?? {
      code,
      campaignId: String(campaignId),
      wallet: signer.address,
      participantCode: me.code,
      likes: 0,
      comments: 0,
      approved: false,
      submittedAt: Math.floor(Date.now() / 1000),
      score: 0,
    };
    mockPosts.set(code, p);
    return scored(p);
  }
  const body = await signedBody(signer, IG_ACTIONS.submit, { campaignId: String(campaignId), post: code });
  return (await post<{ post: IgPost }>("/ig/submit", body)).post;
}

/** Organiser: confirms a post's likes and comments (the score the campaign pays on). */
export async function approveIgPost(
  signer: MessageSigner,
  campaignId: bigint,
  code: string,
  likes: number,
  comments: number,
): Promise<IgPost> {
  if (API_MODE !== "chain") {
    await wait();
    const p = mockPosts.get(code);
    if (!p || p.campaignId !== String(campaignId)) throw new Error("Post not found in this campaign.");
    Object.assign(p, { likes, comments, approved: true, approvedAt: Math.floor(Date.now() / 1000) });
    return scored(p);
  }
  const body = await signedBody(signer, IG_ACTIONS.approve, { campaignId: String(campaignId), post: code, likes, comments });
  return (await post<{ post: IgPost }>("/ig/approve", body)).post;
}

/** Organiser: removes a submission that is not confirmed yet (e.g. someone else's post). */
export async function rejectIgPost(signer: MessageSigner, campaignId: bigint, code: string): Promise<void> {
  if (API_MODE !== "chain") {
    await wait();
    const p = mockPosts.get(code);
    if (!p || p.campaignId !== String(campaignId)) throw new Error("Post not found in this campaign.");
    if (p.approved) throw new Error("A confirmed post can't be rejected.");
    mockPosts.delete(code);
    return;
  }
  const body = await signedBody(signer, IG_ACTIONS.reject, { campaignId: String(campaignId), post: code });
  await post<{ ok: boolean }>("/ig/reject", body);
}

/** Organiser: admits a wallet to the campaign (the verifier registers it in humanity for this campaign). */
export async function approveIgParticipant(signer: MessageSigner, campaignId: bigint, wallet: string): Promise<{ txHash: string }> {
  if (API_MODE !== "chain") {
    await wait();
    mockApproved.add(`${campaignId}:${wallet}`);
    return { txHash: mockTx() };
  }
  const body = await signedBody(signer, IG_ACTIONS.approveParticipant, { campaignId: String(campaignId), wallet });
  return post<{ txHash: string }>("/ig/participants/approve", body);
}
