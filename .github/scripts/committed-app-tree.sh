#!/usr/bin/env bash
set -euo pipefail

if [[ $(git rev-parse --verify HEAD) != "${GITHUB_SHA:?Missing workflow source SHA}" ]]; then
  echo 'App checkout must match the exact triggering commit.' >&2
  exit 1
fi
changes=$(git status --porcelain --untracked-files=all --ignored=matching -- app/)
if [[ -n "$changes" ]]; then
  echo 'App checkout contains changes or files outside the committed package.' >&2
  exit 1
fi
git rev-parse --verify HEAD:app
