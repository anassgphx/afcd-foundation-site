# AFCD Studio on the VPS: Node (Studio server + site build) and Python (src/content.py).
# The site checkout is bind-mounted at /app (see docker-compose.yml), so Studio rebuilds the real site files.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates tini rsync \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app/studio
EXPOSE 4400
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
