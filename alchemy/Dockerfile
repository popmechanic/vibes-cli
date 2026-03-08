FROM ghcr.io/pocket-id/pocket-id:v2

USER root

# fuse: FUSE kernel support for R2 mount
# sqlite: sqlite3 CLI for safe .backup command
# bash: needed for our entrypoint (trap, functions)
RUN apk add --no-cache fuse sqlite bash

# tigrisfs: S3-compatible FUSE adapter (per CF docs)
RUN wget -qO /usr/local/bin/tigrisfs \
    "https://github.com/tigrisdata/tigrisfs/releases/latest/download/tigrisfs-linux-amd64" \
    && chmod +x /usr/local/bin/tigrisfs

COPY entrypoint.sh /vibes-entrypoint.sh
RUN chmod +x /vibes-entrypoint.sh

EXPOSE 1411
ENTRYPOINT ["/vibes-entrypoint.sh"]
