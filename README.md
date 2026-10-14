# MarceauxMarceaux videos

Static site: drifting 16:9 video cards (adapted from MWG 094), a fullscreen player that expands from the clicked card, and Bandcamp / SoundCloud / Instagram pinned to the bottom of the screen.

- **Site** (~250 KB): Cloudflare Pages project `mxm`, deployed from `github.com/netfuel/mxm` on every push to `main`.
- **Video** (5.2 GB): R2 bucket `mxm`, served on the site's own domain at `/media/*` by a Pages Function that supports byte ranges for seeking. Video never goes in git.

```
public/                        what Pages serves
  index.html
  assets/                      style.css, script.js, fonts/, vendor/ (GSAP, ScrollTrigger, Lenis)
  assets/videos.js             generated track list
  _headers                     caching rules
  media -> ../media            local-preview link (gitignored)
functions/media/[[path]].js    streams /media/* from R2 (binding MEDIA)
wrangler.toml                  Pages config: output dir public/, R2 binding MEDIA → bucket mxm
media/<slug>/                  (gitignored) 1080.mp4, 720.mp4, poster.jpg, thumb.jpg, preview.mp4
tools/
  tracks.json                  titles, artists, order (edit to rename or reorder)
  encode.sh                    encodes ../output/youtube-16x9 → media/ (native, fast)
  encode_chunked.py            same encode, resumable in short runs
  shrink_1080.py               re-encodes one 1080.mp4 under R2's 300 MiB upload limit
  manifest.py                  rebuilds public/assets/videos.js
  upload-media.sh              uploads media/ to R2 (run via the .command)
Upload videos to R2.command    double-click: upload new or changed video
Push to GitHub.command         double-click: commit and push, which deploys
```

## Publishing

**Site changes:** double-click **Push to GitHub.command**. Pages rebuilds and deploys in about a minute.

**Video changes:** double-click **Upload videos to R2.command** (needs Node.js). It signs in to Cloudflare in your browser the first time, then uploads only new or changed files. If you added or renamed tracks, push afterwards so `videos.js` updates.

### One-time Cloudflare setup

Workers & Pages → Create → Pages → Connect to Git → `netfuel/mxm`. Production branch `main`, framework preset none, build command empty, build output directory `public`. The R2 binding comes from `wrangler.toml`; if the dashboard doesn't show it under Settings → Bindings after the first deploy, add an R2 binding named `MEDIA` → bucket `mxm` there. Add a custom domain in the project's Custom domains tab whenever you're ready; nothing in the site changes.

## Encoding

Each 16:9 render (~14 Mbps, ~600 MB) becomes:

| File | Spec | Use |
|---|---|---|
| `1080.mp4` | H.264 High, CRF 21, capped 5 Mbps, AAC 192k | player, large screens |
| `720.mp4` | H.264 High, CRF 23, capped 2.5 Mbps, AAC 128k | player, phones and slow connections |
| `preview.mp4` | 640 px, 6 s, silent | card hover/center loop |
| `thumb.jpg` / `poster.jpg` | 640 / 1280 px | card image, player poster |

All MP4s have `+faststart` and a fixed 2 s keyframe interval, so playback starts quickly and seeking is fast over range requests. R2 uploads cap at 300 MiB per file: Future and Hyperballad use a 4.4 Mbps cap to fit (`tools/shrink_1080.py <slug>` does this for any track).

## Local preview

```sh
cd public && python3 -m http.server 8000   # open http://localhost:8000
```

## Player controls

Click a card to open. ← / → previous / next (Shift + arrows while the video has focus), F fullscreen, Space play/pause, Esc close. Tracks auto-advance at the end. The social bar hides while a video is open.
