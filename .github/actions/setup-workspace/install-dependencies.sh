#!/usr/bin/env bash
set -euo pipefail

if [[ "${PNPM_CACHE_RESTORE_OUTCOME:-success}" != "success" && "${PNPM_CACHE_RESTORE_OUTCOME:-success}" != "skipped" ]]; then
  echo "::warning::pnpm cache restoration failed; using a fresh dependency store."
  export npm_config_store_dir
  npm_config_store_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bb-pnpm-fallback.XXXXXX")
  export pnpm_config_store_dir="$npm_config_store_dir"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "npm_config_store_dir=$npm_config_store_dir" >> "$GITHUB_ENV"
    echo "pnpm_config_store_dir=$pnpm_config_store_dir" >> "$GITHUB_ENV"
  fi
fi

if [[ "${TURBO_CACHE_RESTORE_OUTCOME:-success}" != "success" && "${TURBO_CACHE_RESTORE_OUTCOME:-success}" != "skipped" ]]; then
  echo "::warning::Turbo cache restoration failed; clearing incomplete task archives."
  rm -rf .turbo/cache
fi

started=$SECONDS
npm_config_fetch_retries=2 \
  npm_config_fetch_retry_mintimeout=1000 \
  npm_config_fetch_retry_maxtimeout=5000 \
  pnpm_config_fetch_retries=2 \
  pnpm_config_fetch_retry_mintimeout=1000 \
  pnpm_config_fetch_retry_maxtimeout=5000 \
  pnpm install --frozen-lockfile --prefer-offline --fetch-timeout=30000 "$@"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Dependency installation: $((SECONDS - started))s; pnpm restore: ${PNPM_CACHE_RESTORE_OUTCOME:-not requested}; Turbo restore: ${TURBO_CACHE_RESTORE_OUTCOME:-not requested}." >> "$GITHUB_STEP_SUMMARY"
fi
