#!/bin/sh
set -eu

launcher=$(readlink -f -- "$0")
app_dir=${launcher%/*}

# Explicit host font configuration takes precedence over the bundled fallback.
if [ -z "${FONTCONFIG_FILE:-}${FONTCONFIG_PATH:-}${FONTCONFIG_SYSROOT:-}" ]; then
  if font_config=$(sh "$app_dir/resources/native-fonts/prepare-fonts.sh" "$app_dir/resources/native-fonts"); then
    export FONTCONFIG_FILE="$font_config"
  else
    printf '%s\n' 'Manuslip: native font cache unavailable; using system fonts.' >&2
  fi
fi

# Keep the caller's working directory, arguments, environment and umask.
exec "$launcher-bin" "$@"
