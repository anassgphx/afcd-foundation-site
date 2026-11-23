#!/usr/bin/env bash
# Nightly backup of AFCD Studio: PostgreSQL dump + data folder (media originals, keys, salts) + published content files.
# Keeps 14 days in /srv/afcd-studio/backups (readable by root only).
set -euo pipefail
cd /srv/afcd-studio
umask 077
D=backups/$(date +%Y%m%d-%H%M%S); mkdir -p "$D"
docker compose exec -T studio-pg pg_dump -U studio -d afcd_studio -Fc > "$D/db.dump"
tar -czf "$D/data.tgz" data
tar -czf "$D/site-content.tgz" site/src/data site/assets/media 2>/dev/null || true
find backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -r {} +
echo "$(date -Is) backup $D ($(du -sh "$D" | cut -f1))"
