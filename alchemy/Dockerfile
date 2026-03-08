FROM ghcr.io/pocket-id/pocket-id:v2

USER root

# s3fs-fuse: S3-compatible FUSE adapter for R2 mount
# sqlite: sqlite3 CLI for safe .backup command
# bash: needed for our entrypoint (trap, functions)
RUN apk add --no-cache fuse s3fs-fuse sqlite bash

COPY entrypoint.sh /vibes-entrypoint.sh
RUN chmod +x /vibes-entrypoint.sh

EXPOSE 1411
ENTRYPOINT ["/vibes-entrypoint.sh"]
