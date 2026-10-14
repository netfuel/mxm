#!/usr/bin/env python3
"""Resumable web encode in small steps, for shells that can only run a few minutes at a time.
Same output spec as encode.sh. Run repeatedly until it prints ALL DONE.
  python3 site/tools/encode_chunked.py [budget_seconds]
Video is encoded in 20 s pieces (fixed 2 s GOP, so pieces join losslessly), audio in one pass,
then each track is assembled with +faststart."""
import json, math, os, shutil, subprocess, sys, time

T0 = time.time()
BUDGET = float(sys.argv[1]) if len(sys.argv) > 1 else 140
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(SITE, "..", "output", "youtube-16x9")
MEDIA = os.path.join(SITE, "media")
WORK = os.path.join(SITE, "tools", "_work")
SEG = 20  # seconds per piece
FPS = 30

V1080 = ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "5M", "-bufsize", "10M",
         "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0"]
V720 = ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5M",
        "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0"]


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def left():
    return BUDGET - (time.time() - T0)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def done(slug):
    d = os.path.join(MEDIA, slug)
    f = os.path.join(d, "1080.mp4")
    return os.path.isfile(f) and not os.path.islink(f) and os.path.isfile(os.path.join(d, "preview.mp4"))


def step(slug):
    """Do the next unit of work for one track. Returns True when the track is finished."""
    src = os.path.join(SRC, slug + ".mp4")
    w = os.path.join(WORK, slug)
    os.makedirs(w, exist_ok=True)
    meta_p = os.path.join(w, "meta.json")
    if not os.path.exists(meta_p):
        json.dump({"dur": duration(src)}, open(meta_p, "w"))
    dur = json.load(open(meta_p))["dur"]
    n = math.ceil(dur / SEG)

    # 1) video pieces
    for i in range(n):
        a, b = os.path.join(w, f"v1080_{i:03d}.mp4"), os.path.join(w, f"v720_{i:03d}.mp4")
        if os.path.exists(a) and os.path.exists(b):
            continue
        frames = [] if i == n - 1 else ["-frames:v", str(SEG * FPS)]
        ff("-ss", str(i * SEG), "-i", src, "-an",
           "-filter_complex", "[0:v]split=2[a][b];[b]scale=-2:720:flags=lanczos[b7]",
           "-map", "[a]", *frames, *V1080, a + ".part.mp4",
           "-map", "[b7]", *frames, *V720, b + ".part.mp4")
        os.replace(a + ".part.mp4", a)
        os.replace(b + ".part.mp4", b)
        print(f"  {slug}: piece {i + 1}/{n}", flush=True)
        return False

    # 2) audio, once
    for br, name in (("192k", "a192.m4a"), ("128k", "a128.m4a")):
        p = os.path.join(w, name)
        if not os.path.exists(p):
            ff("-i", src, "-vn", "-c:a", "aac", "-b:a", br, "-ac", "2", p + ".part.m4a")
            os.replace(p + ".part.m4a", p)
            print(f"  {slug}: audio {br}", flush=True)
            return False

    # 3) assemble each rendition (lossless join + faststart)
    d = os.path.join(MEDIA, slug)
    os.makedirs(d, exist_ok=True)
    for res, aud in (("720", "a128.m4a"), ("1080", "a192.m4a")):
        stamp = os.path.join(w, f"assembled_{res}")
        if os.path.exists(stamp):
            continue
        lst = os.path.join(w, f"list_{res}.txt")
        with open(lst, "w") as fh:
            for i in range(n):
                fh.write(f"file 'v{res}_{i:03d}.mp4'\n")
        out = os.path.join(d, f"{res}.part.mp4")
        ff("-f", "concat", "-safe", "0", "-i", lst, "-i", os.path.join(w, aud),
           "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", "-shortest", out)
        final = os.path.join(d, f"{res}.mp4")
        if os.path.islink(final):
            os.remove(final)
        os.replace(out, final)
        open(stamp, "w").close()
        print(f"  {slug}: assembled {res}.mp4", flush=True)
        return False

    # 4) poster, thumb, preview loop
    t = round(min(90.0, dur * 0.25), 2)
    ff("-ss", str(t), "-i", src, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", os.path.join(d, "poster.jpg"))
    ff("-ss", str(t), "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", os.path.join(d, "thumb.jpg"))
    ff("-ss", str(t), "-t", "6", "-i", src, "-an", "-vf", "scale=640:-2,fps=30", "-c:v", "libx264", "-preset", "slow",
       "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.join(d, "preview.part.mp4"))
    os.replace(os.path.join(d, "preview.part.mp4"), os.path.join(d, "preview.mp4"))
    shutil.rmtree(w, ignore_errors=True)
    subprocess.run([sys.executable, os.path.join(SITE, "tools", "manifest.py")])
    print(f"DONE {slug}", flush=True)
    return True


def main():
    tracks = [t["slug"] for t in json.load(open(os.path.join(SITE, "tools", "tracks.json")))]
    # Wings already has a full-length stand-in, so encode it last
    tracks = [s for s in tracks if s != "MarceauxMarceaux-Wings"] + ["MarceauxMarceaux-Wings"]
    todo = [s for s in tracks if not done(s) and os.path.exists(os.path.join(SRC, s + ".mp4"))]
    last = None
    while todo and left() > 0:
        slug = todo[0]
        if slug != last:
            print(f"> {slug}", flush=True); last = slug
        if step(slug):
            todo.pop(0)
    remaining = [s for s in tracks if not done(s)]
    print(f"elapsed {time.time() - T0:.0f}s | finished {len(tracks) - len(remaining)}/{len(tracks)}"
          + ("" if remaining else " | ALL DONE"))


if __name__ == "__main__":
    main()
