#!/bin/bash
# ============================================================================
#  BlogSEO Engine — penjaga proses untuk shared hosting cPanel (tanpa Passenger).
#
#  Dipanggil cron setiap beberapa menit:
#    /usr/bin/flock -n ~/.blogseo-runner.lock /bin/bash ~/blogseo-runner.sh
#
#  1. Memasang dependensi bila belum ada atau package-lock.json berubah.
#  2. Menyalakan ulang aplikasi bila kode berubah (setelah Git Deploy).
#  3. Menyalakan aplikasi bila prosesnya mati.
#  Aman dipanggil berkali-kali.
# ============================================================================
HOME_DIR=/home/semestat
APP_DIR=$HOME_DIR/blogseo-app
PIDFILE=$HOME_DIR/blogseo.pid
LOG=$HOME_DIR/blogseo-app.log
REV_FILE=$HOME_DIR/.blogseo-rev
LOCK_FILE=$HOME_DIR/.blogseo-lockhash
STATUS=$HOME_DIR/blogseo-status.txt

export PATH="$HOME_DIR/.local/share/mise/shims:$HOME_DIR/.local/bin:$PATH"

# Log tidak boleh tumbuh tanpa batas.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

[ -f "$APP_DIR/src/server.js" ] || exit 0
[ -f "$APP_DIR/.env" ] || exit 0
cd "$APP_DIR" || exit 1

# --- 1. Dependensi ----------------------------------------------------------
LOCKHASH=$(md5sum package-lock.json 2>/dev/null | cut -d' ' -f1)
if [ ! -d node_modules/express ] || [ "$(cat "$LOCK_FILE" 2>/dev/null)" != "$LOCKHASH" ]; then
  echo "=== $(date) npm ci ===" >> "$LOG"
  if npm ci --omit=dev --no-audit --no-fund >> "$LOG" 2>&1; then
    echo "$LOCKHASH" > "$LOCK_FILE"
  else
    echo "npm ci GAGAL" >> "$LOG"
    exit 1
  fi
fi

# --- 2 & 3. Nyalakan / nyalakan ulang ----------------------------------------
REV=$(git rev-parse HEAD 2>/dev/null || stat -c%Y src/server.js)
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  [ "$(cat "$REV_FILE" 2>/dev/null)" = "$REV" ] && exit 0
  echo "=== $(date) kode berubah, restart ===" >> "$LOG"
  kill "$(cat "$PIDFILE")" 2>/dev/null
  sleep 3
fi

# Tutup semua file descriptor >2 sebelum exec. Tanpa ini proses node mewarisi
# kunci flock dari cron, sehingga setiap putaran cron berikutnya ditolak dan
# aplikasi tidak pernah di-restart setelah deploy.
start_detached() {
  for fd in $(ls /proc/$BASHPID/fd); do
    [ "$fd" -gt 2 ] && eval "exec $fd>&-" 2>/dev/null
  done
  exec "$@"
}

export NODE_OPTIONS="--max-old-space-size=256"
echo "=== $(date) menyalakan (rev $REV) ===" >> "$LOG"
( start_detached node src/server.js ) >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
echo "$REV" > "$REV_FILE"

# Catat status untuk pemeriksaan jarak jauh.
sleep 4
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/api/status")
echo "$(date) rev=$REV node=$(node -v) http=$CODE" > "$STATUS"
