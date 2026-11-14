#!/usr/bin/env bash
# Deploy the hosted stack to a server over SSH.
#   deploy/deploy.sh root@203.0.113.7            # sync code, build, restart
#   deploy/deploy.sh root@203.0.113.7 --artifacts # also upload Anon Aadhaar artifacts (~600 MB, once)
# The server needs Docker; deploy/.env and deploy/verifier.env must exist on the server.
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh user@host [--artifacts]}"
DIR=/opt/cashtag
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '**/node_modules' --exclude 'contracts/target' \
  --exclude '**/.data' --exclude '**/.env' --exclude '**/.env.*' --exclude 'apps' --exclude 'docs' \
  --exclude 'scripts/.accounts' --exclude 'deploy/.env' --exclude 'deploy/verifier.env' \
  "$ROOT/" "$HOST:$DIR/"

if [[ "${2:-}" == "--artifacts" ]]; then
  ssh "$HOST" "docker volume create deploy_verifier-data >/dev/null && mkdir -p /tmp/aadhaar-artifacts"
  rsync -az --progress "$ROOT/services/verifier/.data/aadhaar-artifacts/" "$HOST:/tmp/aadhaar-artifacts/"
  ssh "$HOST" "docker run --rm -v deploy_verifier-data:/data -v /tmp/aadhaar-artifacts:/src alpine sh -c 'mkdir -p /data/aadhaar-artifacts && cp -a /src/. /data/aadhaar-artifacts/' && rm -rf /tmp/aadhaar-artifacts"
fi

ssh "$HOST" "cd $DIR && GIT_SHA=$SHA docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build && docker image prune -f >/dev/null"
PUBLIC_HOST="$(ssh "$HOST" "grep ^PUBLIC_HOST= $DIR/deploy/.env | cut -d= -f2")"
echo "waiting for https://$PUBLIC_HOST/health ..."
for _ in $(seq 1 30); do
  if curl -fsS "https://$PUBLIC_HOST/health"; then echo; exit 0; fi
  sleep 5
done
echo "health check failed" >&2
exit 1
