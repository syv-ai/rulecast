#!/bin/sh
# Installs rulecast's standalone binary, the way uv's installer does.
#
#   curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
#
# That is the latest release. For a fixed version, use the script attached to its release:
#
#   curl -LsSf https://github.com/syv-ai/rulecast/releases/download/vX.Y.Z/install.sh | sh
#
# It downloads the binary for this machine and its .sha256 from the release, checks one against
# the other, and installs it as <dir>/rulecast. Then it makes sure <dir> is on your PATH: it writes
# <dir>/env and sources it from your shell's startup files, and prints every file it changed.
#
#   RULECAST_INSTALL_DIR     where to install (default: $XDG_BIN_HOME, else ~/.local/bin)
#   RULECAST_NO_MODIFY_PATH  set to 1 to change no startup file
#   RULECAST_DOWNLOAD_URL    where the release assets are (for mirrors)
#
# Linux and macOS, x64 and arm64. Anywhere else: npm install -g @syv-ai/rulecast.
set -u

VERSION="0.9.0"

say() { printf 'rulecast: %s\n' "$*"; }
fail() {
  printf 'rulecast: %s\n' "$*" >&2
  exit 1
}

# Appends the line that sources <dir>/env to $1, unless it is already there.
source_from() {
  if [ -f "$1" ] && grep -qxF "$env_line" "$1"; then return 0; fi
  printf '\n# Added by the rulecast installer\n%s\n' "$env_line" >>"$1" || fail "could not write $1"
  changed="$changed $1"
}

main() {
  command -v curl >/dev/null 2>&1 || fail "curl is needed to download rulecast; nothing was installed"
  if command -v shasum >/dev/null 2>&1; then
    sha256="shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256="sha256sum"
  else
    fail "shasum or sha256sum is needed to check the download; nothing was installed"
  fi

  # The targets scripts/build-binary.ts builds.
  case "$(uname -sm)" in
    "Linux x86_64") target=linux-x64 ;;
    "Linux aarch64" | "Linux arm64") target=linux-arm64 ;;
    "Darwin arm64") target=darwin-arm64 ;;
    "Darwin x86_64") target=darwin-x64 ;;
    *) fail "no standalone binary for $(uname -sm); install it with npm: npm install -g @syv-ai/rulecast" ;;
  esac

  dir="${RULECAST_INSTALL_DIR:-}"
  [ -n "$dir" ] || dir="${XDG_BIN_HOME:-}"
  if [ -z "$dir" ]; then
    [ -n "${HOME:-}" ] || fail "HOME is not set; set RULECAST_INSTALL_DIR to where rulecast should go"
    dir="$HOME/.local/bin"
  fi
  base="${RULECAST_DOWNLOAD_URL:-https://github.com/syv-ai/rulecast/releases/download/v$VERSION}"
  asset="rulecast-$target"

  tmp="$(mktemp -d)" || fail "could not create a temporary directory"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' HUP INT TERM

  say "downloading rulecast $VERSION for $target"
  (cd "$tmp" && curl --proto '=https' --tlsv1.2 -fsSLO "$base/$asset" &&
    curl --proto '=https' --tlsv1.2 -fsSLO "$base/$asset.sha256") ||
    fail "could not download $base/$asset; nothing was installed"
  (cd "$tmp" && $sha256 -c "$asset.sha256" >/dev/null 2>&1) ||
    fail "the download does not match its checksum; nothing was installed"

  # Written beside the old one and renamed over it, so a hook running the old rulecast never runs a
  # half-written file.
  mkdir -p "$dir" || fail "could not create $dir"
  part="$dir/.rulecast.$$.tmp"
  if ! { cp "$tmp/$asset" "$part" && chmod 755 "$part" && mv -f "$part" "$dir/rulecast"; }; then
    rm -f "$part"
    fail "could not install $dir/rulecast"
  fi
  installed="$("$dir/rulecast" --version 2>/dev/null)" || fail "installed $dir/rulecast, but it does not run here"
  say "installed rulecast $installed at $dir/rulecast"

  # <dir> as the startup files name it: under $HOME, through $HOME, so a shared dotfile works anywhere.
  case "$dir" in
    "${HOME:-/nonexistent}"/*) shown="\$HOME${dir#"$HOME"}" ;;
    *) shown="$dir" ;;
  esac
  env_line=". \"$shown/env\""
  cat >"$dir/env" <<EOF || fail "could not write $dir/env"
#!/bin/sh
# Written by the rulecast installer: puts $shown on the PATH, once.
case ":\${PATH}:" in
  *:"$shown":*) ;;
  *) export PATH="$shown:\$PATH" ;;
esac
EOF

  if [ -n "${GITHUB_PATH:-}" ] && ! grep -qxF "$dir" "$GITHUB_PATH" 2>/dev/null; then
    printf '%s\n' "$dir" >>"$GITHUB_PATH" || fail "could not write $GITHUB_PATH"
    say "added $dir to \$GITHUB_PATH"
  fi
  case ":${PATH:-}:" in
    *:"$dir":*) return 0 ;;
  esac
  if [ "${RULECAST_NO_MODIFY_PATH:-}" = 1 ] || [ -z "${HOME:-}" ]; then
    say "$dir is not on your PATH. Add this line to your shell's startup file: $env_line"
    return 0
  fi

  changed=""
  source_from "$HOME/.profile"
  [ -f "$HOME/.bashrc" ] && source_from "$HOME/.bashrc"
  [ -f "$HOME/.bash_profile" ] && source_from "$HOME/.bash_profile"
  case "${SHELL:-}" in
    */zsh) source_from "$HOME/.zshrc" ;;
    *) [ -f "$HOME/.zshrc" ] && source_from "$HOME/.zshrc" ;;
  esac
  case "${SHELL:-}" in
    */fish) say "for fish, run: fish_add_path $dir" ;;
  esac
  if [ -n "$changed" ]; then
    for file in $changed; do say "added $dir to the PATH in $file"; done
    say "to use rulecast in this shell now, run: $env_line"
  fi
  return 0
}

main "$@"
