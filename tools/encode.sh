#!/usr/bin/env bash
# Re-encode the 16:9 renders for the web, then rebuild assets/videos.js.
# Run from anywhere:  bash site/tools/encode.sh
# Re-run whenever new renders land; finished tracks are skipped,
# and tracks without a render use the placeholder video.
# Env: SRC=<render folder> (default ../output/youtube-16x9), ONLY=<slug>
set -uo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$SITE/../output/youtube-16x9}"
OUT="$SITE/media"
mkdir -p "$OUT"
now=$(date +%s)

for f in "$SRC"/*.mp4; do
  [ -e "$f" ] || continue
  slug=$(basename "$f" .mp4)
  [ -n "${ONLY:-}" ] && [ "$slug" != "$ONLY" ] && continue
  d="$OUT/$slug"
  if [ -f "$d/1080.mp4" ] && [ "$d/1080.mp4" -nt "$f" ]; then echo "skip   $slug (up to date)"; continue; fi
  age=$(( now - $(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f") ))
  if [ "$age" -lt 120 ]; then echo "skip   $slug (still being written)"; continue; fi
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f") || { echo "skip   $slug (unreadable)"; continue; }
  t=$(python3 -c "print(round(min(90.0, float('$dur')*0.25),2))")
  mkdir -p "$d"
  echo "encode $slug (${dur%.*}s, poster @ ${t}s)"

  # One decode, two renditions: 1080p (~5 Mbps) and 720p (~2.5 Mbps).
  # Fixed 2 s GOP + faststart so playback starts and seeks quickly over HTTP range requests.
  ffmpeg -y -hide_banner -loglevel error -i "$f" \
    -filter_complex "[0:v]split=2[a][b];[b]scale=-2:720:flags=lanczos[b7]" \
    -map "[a]" -map 0:a:0 -c:v libx264 -preset medium -crf 21 -maxrate 5M -bufsize 10M \
      -profile:v high -level 4.1 -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 192k -ac 2 -movflags +faststart "$d/1080.part.mp4" \
    -map "[b7]" -map 0:a:0 -c:v libx264 -preset medium -crf 23 -maxrate 2500k -bufsize 5M \
      -profile:v high -level 4.0 -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 128k -ac 2 -movflags +faststart "$d/720.part.mp4" \
  && mv "$d/1080.part.mp4" "$d/1080.mp4" && mv "$d/720.part.mp4" "$d/720.mp4" \
  || { echo "FAILED $slug"; rm -f "$d"/*.part.mp4; continue; }

  # Poster (player) + thumbnail (cards) + 6 s silent preview loop (cards)
  ffmpeg -y -hide_banner -loglevel error -ss "$t" -i "$f" -frames:v 1 -vf "scale=1280:-2" -q:v 3 "$d/poster.jpg"
  ffmpeg -y -hide_banner -loglevel error -ss "$t" -i "$f" -frames:v 1 -vf "scale=640:-2" -q:v 4 "$d/thumb.jpg"
  ffmpeg -y -hide_banner -loglevel error -ss "$t" -t 6 -i "$f" -an -vf "scale=640:-2,fps=30" \
    -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart "$d/preview.mp4"
  ls -lh "$d" | awk 'NR>1{print "         "$5"\t"$9}'
done

python3 "$SITE/tools/manifest.py"
