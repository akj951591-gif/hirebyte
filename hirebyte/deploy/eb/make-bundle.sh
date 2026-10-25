#!/usr/bin/env bash
# Builds the Elastic Beanstalk zip (Caddy + API + document service + Postgres + built frontend).
#
#   bash deploy/eb/make-bundle.sh <out-dir> <source-env-file> <public-host> [api-host]
#   bash deploy/eb/make-bundle.sh ~/hb-out backend/api/.env bulkblast.in api.bulkblast.in
#
# The zip contains secrets (.env): keep <out-dir> outside the repository and never upload the zip
# anywhere except Elastic Beanstalk. Only variable NAMES are printed, never values.
set -euo pipefail

out="${1:?out dir}"; src="${2:?source env file}"; host="${3:?public host, e.g. bulkblast.in}"
cd "$(dirname "$0")/../.."                      # hirebyte/
repo="$(git rev-parse --show-toplevel)"
[ -f "$src" ] || { echo "source env file not found: $src"; exit 1; }
[ -f frontend/dist/index.html ] || { echo "build the frontend first: (cd frontend && npm run build)"; exit 1; }

stage="$out/stage"
rm -rf "$stage" && mkdir -p "$stage/backend"

# Committed files only, so no node_modules and no local .env files.
git -C "$repo" archive "HEAD:hirebyte/backend" | tar -x -C "$stage/backend"
git -C "$repo" archive "HEAD:hirebyte" .ebextensions | tar -x -C "$stage"
git -C "$repo" archive "HEAD:hirebyte/deploy/eb" docker-compose.eb.yml Caddyfile | tar -x -C "$stage"
mv "$stage/docker-compose.eb.yml" "$stage/docker-compose.yml"
cp -r frontend/dist "$stage/site"

get() { grep -m1 "^$1=" "$src" | cut -d= -f2- | tr -d '\r' | sed -E "s/^(['\"])(.*)\1\$/\2/" || true; }
gen() { openssl rand -hex 32; }

env_out="$stage/.env"
{
  echo "WEB_ORIGIN=https://$host"
  echo "APP_BASE_URL=https://$host"
  echo "POSTGRES_PASSWORD=$(gen)"
  echo "SESSION_SECRET=$(gen)"
  echo "DOCUMENT_SERVICE_TOKEN=$(gen)"
  echo "RECORDING_ENABLED=false"
  echo "LOG_LEVEL=info"
} > "$env_out"

required="SEED_RECRUITER_EMAIL SEED_RECRUITER_PASSWORD SEED_RECRUITER_NAME LLM_PROVIDER LLM_API_KEY LLM_MODEL LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET"
optional="COMPANY_NAME LLM_TIMEOUT_MS CONVERSATION_TIMEOUT_MS"
missing=""
for k in $required $optional; do
  v="$(get "$k")"
  if [ -z "$v" ]; then
    case " $required " in *" $k "*) missing="$missing $k";; esac
    continue
  fi
  case "$v" in *'$'*) echo "warning: $k contains a \$ sign, which docker compose may expand";; esac
  echo "$k=$v" >> "$env_out"
  echo "$k: set"
done
if [ -n "$missing" ]; then echo "missing required values in $src:$missing"; exit 1; fi
[ "$(grep -c '=$' "$env_out")" = 0 ] || { echo "empty value in generated .env"; exit 1; }
chmod 600 "$env_out"

zip_path="$out/hirebyte-eb.zip"
rm -f "$zip_path"
if [ -x /c/Windows/System32/tar.exe ]; then /c/Windows/System32/tar.exe -a -c -f "$zip_path" -C "$stage" .; else (cd "$stage" && zip -qr "$zip_path" .); fi
echo "bundle: $zip_path ($(du -h "$zip_path" | cut -f1))"
