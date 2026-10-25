#!/usr/bin/env bash
# Creates hirebyte/.env for docker-compose.prod.yml from .env.production.example, fills in freshly
# generated secrets (never typed or shown) and, if given, the CloudFront domain.
#
#   bash deploy/init-env.sh d1234abcd.cloudfront.net
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists, so nothing was changed. Edit it with: nano .env"
  exit 0
fi

cp .env.production.example .env
chmod 600 .env
for key in POSTGRES_PASSWORD SESSION_SECRET DOCUMENT_SERVICE_TOKEN; do
  sed -i "s|^${key}=\$|${key}=$(openssl rand -hex 32)|" .env
done

if [ $# -ge 1 ]; then
  domain="${1#https://}"
  domain="${domain%/}"
  sed -i "s|https://YOUR-DISTRIBUTION.cloudfront.net|https://${domain}|g" .env
  echo "Public URL set to https://${domain}"
fi

echo "Created .env with generated POSTGRES_PASSWORD, SESSION_SECRET and DOCUMENT_SERVICE_TOKEN."
echo "Next: nano .env   (fill in SEED_RECRUITER_*, LLM_API_KEY, LLM_MODEL and the LIVEKIT_* values)"
