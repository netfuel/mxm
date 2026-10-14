#!/bin/bash
# Upload media/ to the Cloudflare R2 bucket "mxm" (served by the site at /media/*).
# Run on your Mac via "Upload videos to R2.command". Safe to re-run: only new or
# changed files are sent (tracked in tools/.r2-uploaded).
set -uo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SITE"
BUCKET="${R2_BUCKET:-mxm}"
W=(npx --yes wrangler@4.151.0)
STATE="tools/.r2-uploaded"
touch "$STATE"

echo "== Cloudflare sign-in"
if "${W[@]}" whoami 2>&1 | grep -qi "not authenticated"; then "${W[@]}" login || exit 1; fi

echo "== Upload media to R2 bucket '$BUCKET'"
total=0; sent=0; failed=0
while IFS= read -r f; do
  key="${f#media/}"
  sig="$key $(stat -f %z "$f") $(stat -f %m "$f")"
  total=$((total+1))
  grep -qxF "$sig" "$STATE" && continue
  case "$f" in *.mp4) ct=video/mp4;; *.jpg) ct=image/jpeg;; *) ct=application/octet-stream;; esac
  printf '  %-75s %4s MB … ' "$key" "$(( $(stat -f %z "$f") / 1000000 ))"
  if "${W[@]}" r2 object put "$BUCKET/$key" --file "$f" --content-type "$ct" \
       --cache-control "public, max-age=604800" --remote >/tmp/mxm-put.log 2>&1; then
    echo "$sig" >> "$STATE"; sent=$((sent+1)); echo ok
  else
    failed=$((failed+1)); echo FAILED; tail -3 /tmp/mxm-put.log | sed 's/^/      /'
  fi
done < <(find media -type f \( -name '*.mp4' -o -name '*.jpg' \) ! -name '*.part.*' | sort)
echo "== $total files: $sent uploaded now, $failed failed, $((total-sent-failed)) already in R2"
[ "$failed" -gt 0 ] && echo "Run again to retry the failed files."
