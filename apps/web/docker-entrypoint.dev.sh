#!/bin/sh
set -e
cd /repo
export CI=1
# Volume nomeado começa vazio — reinstala deps de forma não interativa
pnpm install --frozen-lockfile
exec pnpm dev
