#!/usr/bin/env bash
# Copies the website Studio last built (/srv/afcd-studio/site) to the folder Caddy serves (/srv/afcd-website/public),
# public files only. Runs every minute from cron; does nothing unless the built homepage changed.
set -euo pipefail
cd /srv/afcd-studio
SITE=site; PUB=/srv/afcd-website/public; STAMP=data/.last-sync
[ -f "$SITE/index.html" ] || exit 0
if [ -f "$STAMP" ] && [ ! "$SITE/index.html" -nt "$STAMP" ] && [ ! "$SITE/sitemap.xml" -nt "$STAMP" ]; then exit 0; fi
# never ship a preview build (noindex) to the live site
grep -q 'name="robots" content="noindex' "$SITE/index.html" && { echo "$(date -Is) skipped: preview build"; exit 0; }
docker compose exec -T studio-app node /app/deploy/build-dist.mjs >/dev/null
rsync -a --delete --exclude .htaccess "$SITE/dist/" "$PUB/"
touch "$STAMP"
echo "$(date -Is) synced"
