# ClipRail

**Verifiable pay-per-view clipping campaigns on Stellar.** Brands lock a budget in a Soroban escrow; ZK-verified unique humans post campaign clips on their own social accounts; view counts are proven with zkTLS (Reclaim) and checked *inside* the contract; the budget is distributed per epoch, pro-rata, under immutable rules.

> Sayı doğru (zkTLS) · Kişi tek (ZK identity) · Kurallar değişmez (Soroban)

Status: hackathon build, Stellar **testnet**. 

| Doc | |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | Project overview (TR) — what it is / isn't, roadmap |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, mechanism design, trust model, threat table |
| [docs/INTERFACES.md](docs/INTERFACES.md) | Contract / service / web interfaces (frozen contract between team members) |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | Detailed dev plan, milestones, task list |

Monorepo layout: `contracts/` (Soroban, Rust) · `services/verifier/` (Node, zkFetch) · `apps/web/` (Next.js) · `packages/` (generated bindings) · `docs/`.

## Development setup

```bash
# Rust + Soroban
rustup default stable && rustup target add wasm32v1-none
brew install stellar-cli            # v28
cd contracts && cargo test && stellar contract build

# JS workspace (web, verifier, bindings)
pnpm install
```

- `contracts/` — Cargo workspace, `soroban-sdk` 28 (`hazmat-crypto` feature for `secp256k1_recover`).
- `apps/web` — Next.js (Sena). `services/verifier` — Node/TS. `packages/*` — generated contract bindings.
- `main` must always build. Pull with `git pull --rebase` before pushing.

Contract IDs, run instructions and demo flow: _TBD (K15, K19)_.
