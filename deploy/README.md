# Deploying the AFCD Foundation website (afcdfoundation.com)

The website is plain static files. It runs on the same VPS as AFCD Connect, but in its **own folder**
(`/srv/afcd-website/public`), served by the Caddy container AFCD Connect already uses. Nothing in AFCD
Connect's app, database or files changes; Caddy only gains one read-only folder and two site blocks.

## One-time setup on the VPS

1. **DNS** (at the domain registrar / Hostinger DNS zone): point `afcdfoundation.com` and `www.afcdfoundation.com`
   to the VPS: `A @ 2.25.8.220` and `CNAME www afcdfoundation.com` (or `A www 2.25.8.220`).
   Wait until `dig +short afcdfoundation.com` shows `2.25.8.220` before step 4, or Caddy can't get the HTTPS certificate.
2. **Folder**: `mkdir -p /srv/afcd-website/public`
3. **Caddy** (in AFCD Connect's folder on the VPS):
   - `docker-compose.yml` → under `caddy:` → `volumes:` add
     `- /srv/afcd-website/public:/srv/afcd-website:ro`
   - `Caddyfile` → append the blocks from `deploy/Caddyfile.website`.
4. **Apply**: `docker compose up -d caddy` (recreates only the Caddy container, a few seconds; the app and
   database keep running), then `docker compose logs -f caddy` to watch the certificate being issued.

## Every release (from this repo, on your computer)

    npm run build:hostinger            # production build for afcdfoundation.com → dist/
    bash deploy/deploy-vps.sh          # uploads dist/ to /srv/afcd-website/public

No Caddy restart is needed for content updates.

## Notes
- `npm run build:hostinger` makes the pages indexable (no "noindex") with canonical URLs on afcdfoundation.com.
- French and Arabic are included only when their translations are approved (`status: "approved"` in src/i18n).
- `deploy/.htaccess` is only for Apache/LiteSpeed shared hosting; Caddy ignores it (its rules are in Caddyfile.website).
- The contact form and Staff login need AFCD Studio hosted online; until then they show their "not connected" state.
