#!/usr/bin/env python3
"""Re-encode one track's 1080.mp4 with a lower bitrate cap so it fits Cloudflare's
300 MiB per-file upload limit. Resumable in short runs, like encode_chunked.py.
  python3 site/tools/shrink_1080.py <slug> [maxrate] [budget_seconds]"""
import json, math, os, shutil, subprocess, sys, time

T0 = time.time()
slug = sys.argv[1]
MAXRATE = sys.argv[2] if len(sys.argv) > 2 else "4400k"
BUDGET = float(sys.argv[3]) if len(sys.argv) > 3 else 125
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(SITE, "..", "output", "youtube-16x9", slug + ".mp4")
w = os.path.join(SITE, "tools", "_work", "shrink-" + slug)
out = os.path.join(SITE, "media", slug, "1080.mp4")
SEG, FPS = 20, 30
V = ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", MAXRATE, "-bufsize", "8800k",
     "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0"]
LIMIT = 300 * 1024 * 1024


def ff(*a):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *a], check=True)


if os.path.getsize(out) < LIMIT * 0.97:
    print(f"{slug}: already {os.path.getsize(out)/2**20:.0f} MiB, OK"); sys.exit()
os.makedirs(w, exist_ok=True)
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                           capture_output=True, text=True).stdout)
n = math.ceil(dur / SEG)
for i in range(n):
    p = os.path.join(w, f"v_{i:03d}.mp4")
    if os.path.exists(p):
        continue
    if time.time() - T0 > BUDGET:
        print(f"{slug}: {i}/{n} pieces"); sys.exit()
    frames = [] if i == n - 1 else ["-frames:v", str(SEG * FPS)]
    ff("-ss", str(i * SEG), "-i", src, "-an", *frames, *V, p + ".part.mp4")
    os.replace(p + ".part.mp4", p)
a = os.path.join(w, "a192.m4a")
if not os.path.exists(a):
    ff("-i", src, "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2", a + ".part.m4a"); os.replace(a + ".part.m4a", a)
lst = os.path.join(w, "list.txt")
open(lst, "w").write("".join(f"file 'v_{i:03d}.mp4'\n" for i in range(n)))
tmp = out.replace(".mp4", ".part.mp4")
ff("-f", "concat", "-safe", "0", "-i", lst, "-i", a, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
   "-movflags", "+faststart", "-shortest", tmp)
size = os.path.getsize(tmp)
assert size < LIMIT, f"still {size/2**20:.0f} MiB"
os.replace(tmp, out)
shutil.rmtree(w, ignore_errors=True)
print(f"DONE {slug}: {size/2**20:.0f} MiB")
