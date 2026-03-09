#!/bin/bash
set -e
# Domain: vibesos.com (2026-03-08)

R2_MOUNT="/mnt/r2"
DATA_DIR="/app/data"
DB_PATH="$DATA_DIR/pocket-id.db"
BACKUP_NAME="pocket-id.db"
BACKUP_PATH="$R2_MOUNT/$BACKUP_NAME"

mkdir -p "$R2_MOUNT" "$DATA_DIR"

# ---- MOUNT R2 ----
S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
echo "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" > /etc/passwd-s3fs
chmod 600 /etc/passwd-s3fs
s3fs "$R2_BUCKET_NAME" "$R2_MOUNT" \
    -o url="$S3_ENDPOINT" \
    -o passwd_file=/etc/passwd-s3fs \
    -o use_path_request_style \
    -o allow_other &

# Wait for mount (up to 10 seconds)
for i in $(seq 1 10); do
    mountpoint -q "$R2_MOUNT" 2>/dev/null && break
    sleep 1
done
rm -f /etc/passwd-s3fs

# ---- RESTORE ----
if mountpoint -q "$R2_MOUNT" && [ -f "$BACKUP_PATH" ]; then
    cp "$BACKUP_PATH" "$DB_PATH"
    echo "[vibes] Database restored from R2 backup ($(wc -c < "$DB_PATH") bytes)"
else
    echo "[vibes] No backup found, starting fresh"
fi

# ---- PERIODIC BACKUP ----
periodic_backup() {
    while true; do
        sleep 600  # 10 minutes
        if [ -f "$DB_PATH" ] && mountpoint -q "$R2_MOUNT" 2>/dev/null; then
            sqlite3 "$DB_PATH" ".backup '/tmp/periodic.db'" 2>/dev/null
            if [ -f /tmp/periodic.db ]; then
                cp /tmp/periodic.db "$BACKUP_PATH"
                rm -f /tmp/periodic.db
                echo "[vibes] Periodic backup saved to R2"
            fi
        fi
    done
}
periodic_backup &
BACKUP_PID=$!

# ---- SIGTERM HANDLER ----
cleanup() {
    echo "[vibes] SIGTERM received, backing up..."
    if [ -f "$DB_PATH" ] && mountpoint -q "$R2_MOUNT" 2>/dev/null; then
        sqlite3 "$DB_PATH" ".backup '/tmp/final.db'"
        cp /tmp/final.db "$BACKUP_PATH"
        rm -f /tmp/final.db
        echo "[vibes] Final backup saved to R2"
    fi
    kill "$BACKUP_PID" 2>/dev/null
    kill -TERM "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
    exit 0
}
trap cleanup SIGTERM SIGINT

# ---- START POCKET ID ----
# Chain through original entrypoint (handles user/group + su-exec privilege drop)
echo "[vibes] Starting Pocket ID via original entrypoint..."
sh /app/docker/entrypoint.sh /app/pocket-id &
PID=$!
wait "$PID"
