#!/bin/bash
# Double-click to push the site to github.com/netfuel/mxm. Cloudflare Pages redeploys on every push to main.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
git status --short
if [ -n "$(git status --porcelain)" ]; then
  git add -A && git commit -m "Update site" && echo "Committed local changes."
fi
git push -u origin HEAD && echo "Pushed $(git branch --show-current). Cloudflare Pages will deploy in about a minute."
read -r -p "Press Return to close"
