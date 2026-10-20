#!/usr/bin/env bash
# Builds everything the vivla-wiki Worker deploys, from one content root:
#   1. the Starlight site       -> site/dist
#   2. the MCP corpus           -> worker/generated/{corpus.json,llms*.txt,pages/}
#   3. the chunk embeddings     -> worker/generated/embeddings.json
#   4. the Worker unit tests
#
# Usage: scripts/build-wiki.sh <content-root>
#   <content-root> is a checkout of the aggregated `docs` branch (docs.json
#   plus every page). In CI on the `docs` branch it is the repo root itself.
#
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for step 3 (Workers
# AI inference only). Set SKIP_EMBEDDINGS=1 to stop after step 2; the Worker
# tests need the embeddings, so they are skipped too.
set -euo pipefail

CONTENT_ROOT="$(cd "${1:?usage: build-wiki.sh <content-root>}" && pwd)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "::group::Site (Starlight)"
cd "$REPO_ROOT/site"
pnpm install --frozen-lockfile
VIVLA_DOCS_CONTENT_ROOT="$CONTENT_ROOT" pnpm run build
echo "::endgroup::"

echo "::group::MCP corpus"
cd "$REPO_ROOT/scripts"
npm ci --no-audit --no-fund
node build-corpus.mjs --source "$CONTENT_ROOT" --out "$REPO_ROOT/worker/generated"
echo "::endgroup::"

if [ "${SKIP_EMBEDDINGS:-0}" = "1" ]; then
  echo "SKIP_EMBEDDINGS=1: no embeddings, no Worker tests."
  exit 0
fi

echo "::group::Embeddings (Workers AI)"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required for the embeddings}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required for the embeddings}"
node build-embeddings.mjs \
  --corpus "$REPO_ROOT/worker/generated/corpus.json" \
  --out "$REPO_ROOT/worker/generated/embeddings.json"
echo "::endgroup::"

echo "::group::Worker tests"
cd "$REPO_ROOT/worker"
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
echo "::endgroup::"
