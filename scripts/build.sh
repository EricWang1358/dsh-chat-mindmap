#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in \
    "$HOME/dsh-harness" \
    "$HOME/dsh" \
    "$HOME/.dsh/dsh-harness" \
    "/d/Program Files/nodejs/node_global/node_modules/@deepseek-ai/dsh"; do
    if [ -d "$candidate/packages" ] || [ -d "$candidate/node_modules" ]; then CHECKOUT="$candidate"; break; fi
  done
fi

if [ -z "$CHECKOUT" ]; then
  echo "build: set DSH_CHECKOUT to the DSH checkout or installed package root" >&2
  exit 1
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  TSC="$(command -v tsc || true)"
fi
if [ -z "$TSC" ]; then
  echo "build: TypeScript compiler not found" >&2
  exit 1
fi

# Build against the installed DSH package graph without copying host code.
link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    return 1
  fi
  node -e "const fs=require('fs');const path=require('path');const link=path.resolve(process.argv[1]);const target=path.resolve(process.argv[2]);fs.rmSync(link,{recursive:true,force:true});fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir')" "node_modules/$1" "$target"
}

mkdir -p node_modules/@deepseek-ai
if [ -d "$CHECKOUT/packages" ]; then
  link_pkg cordis vendor/cordis || true
  link_pkg @deepseek-ai/dsh-tools packages/core/tools || true
  link_pkg @deepseek-ai/dsh-host-webserver packages/host/webserver || true
  link_pkg @deepseek-ai/dsh-client-ui-slots packages/client/ui-slots || true
  link_pkg @deepseek-ai/dsh-client-runtime packages/client/runtime || true
else
  # Installed DSH distribution: link its published dependency graph into this
  # plugin so Node can resolve peer imports during host-entry smoke tests.
  for pkg in "$CHECKOUT/node_modules/@deepseek-ai"/*; do
    [ -d "$pkg" ] || continue
    base="$(basename "$pkg")"
    node -e "const fs=require('fs');const path=require('path');const link=path.resolve(process.argv[1]);const target=path.resolve(process.argv[2]);fs.rmSync(link,{recursive:true,force:true});fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir')" "node_modules/@deepseek-ai/$base" "$pkg" || true
  done
  if [ -d "$CHECKOUT/node_modules/cordis" ]; then
    node -e "const fs=require('fs');const path=require('path');const link=path.resolve('node_modules/cordis');const target=path.resolve(process.argv[1]);fs.rmSync(link,{recursive:true,force:true});fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir')" "$CHECKOUT/node_modules/cordis"
  fi
fi

if [ -n "${TSC:-}" ]; then
  "$TSC" -p tsconfig.json
else
  npx.cmd tsc -p tsconfig.json
fi

if [ -x "node_modules/.bin/tsdown" ] || [ -f "node_modules/.bin/tsdown.cmd" ]; then
  npm run build:client
fi

NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${ROOT}/.npm-cache}" npm pack --dry-run
