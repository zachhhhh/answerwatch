#!/bin/bash
# Publishes AnswerWatch to github.com/zachhhhh/answerwatch (public). Never commits .env.
set -e
cd "$(dirname "$0")"
[ -d .git ] || git init -q
git branch -M main
git add -A
git reset -q .env 2>/dev/null || true
git commit -qm "AnswerWatch v0.1: first measurements" || true
git remote get-url origin >/dev/null 2>&1 || git remote add origin https://github.com/zachhhhh/answerwatch.git
git push -u origin main
echo "Published. Now enable Pages: repo Settings > Pages > Branch main, folder /docs."
