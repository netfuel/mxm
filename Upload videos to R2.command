#!/bin/bash
# Double-click to upload new or changed videos to the Cloudflare R2 bucket "mxm".
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null
if ! command -v npx >/dev/null; then
  echo "Node.js isn't installed. Get the LTS installer from https://nodejs.org, then double-click this again."
  read -r -p "Press Return to close"; exit 1
fi
W=(npx --yes wrangler@4.151.0)
if ! "${W[@]}" whoami 2>&1 | grep -qi "associated with"; then
  echo "Signing in to Cloudflare: approve the request in your browser."
  "${W[@]}" login || { read -r -p "Sign-in failed. Press Return to close"; exit 1; }
fi
bash tools/upload-media.sh 2>&1 | tee tools/upload.log
read -r -p "Press Return to close"
