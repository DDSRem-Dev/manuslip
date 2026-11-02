#!/bin/sh
set -eu
umask 077

resource_dir=$1
font_source="$resource_dir/NotoSansCJKsc-VF.ttf"
font_hash=$(sha256sum < "$font_source")
font_hash=${font_hash%% *}
cache_root="${XDG_CACHE_HOME:-${HOME:?}/.cache}/Manuslip/native-fonts"
mkdir -p -- "$cache_root"
cache_root=$(CDPATH= cd -- "$cache_root" && pwd -P)
font_dir="$cache_root/$font_hash"
mkdir -p -- "$font_dir"
font_tmp=''
config_tmp=''
license_tmp=''
trap 'rm -f -- "$font_tmp" "$config_tmp" "$license_tmp"' EXIT
trap 'exit 1' HUP INT TERM

cached_hash=''
if [ -f "$font_dir/NotoSansCJKsc-VF.ttf" ]; then
  cached_hash=$(sha256sum < "$font_dir/NotoSansCJKsc-VF.ttf")
  cached_hash=${cached_hash%% *}
fi
if [ "$cached_hash" != "$font_hash" ]; then
  font_tmp=$(mktemp "$font_dir/.font.XXXXXX")
  cp -- "$font_source" "$font_tmp"
  mv -f -- "$font_tmp" "$font_dir/NotoSansCJKsc-VF.ttf"
  font_tmp=''
fi
if ! cmp -s -- "$resource_dir/OFL.txt" "$font_dir/OFL.txt"; then
  license_tmp=$(mktemp "$font_dir/.license.XXXXXX")
  cp -- "$resource_dir/OFL.txt" "$license_tmp"
  mv -f -- "$license_tmp" "$font_dir/OFL.txt"
  license_tmp=''
fi

xml_escape() {
  printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}
config_tmp=$(mktemp "$font_dir/.config.XXXXXX")
cat > "$config_tmp" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <cachedir>$(xml_escape "$cache_root/cache")</cachedir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>$(xml_escape "$font_dir")</dir>
</fontconfig>
EOF
if cmp -s -- "$config_tmp" "$font_dir/fonts.conf"; then
  rm -f -- "$config_tmp"
else
  mv -f -- "$config_tmp" "$font_dir/fonts.conf"
fi
config_tmp=''
printf '%s\n' "$font_dir/fonts.conf"
