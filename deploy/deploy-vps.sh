#!/usr/bin/env bash
# Uploads the built website (dist/) to its own folder on the AFCD VPS. Does not touch AFCD Connect.
# Usage:  npm run build:hostinger && bash deploy/deploy-vps.sh [user@host]
set -euo pipefail
HOST="${1:-root@2.25.8.220}"
DEST=/srv/afcd-website/public
[ -f dist/index.html ] || { echo "dist/ is missing: run npm run build:hostinger first"; exit 1; }
ssh "$HOST" "mkdir -p $DEST"
rsync -az --delete --exclude .htaccess dist/ "$HOST:$DEST/"
echo "Uploaded to $HOST:$DEST"
