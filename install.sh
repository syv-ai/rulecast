#!/bin/sh
# Installs rulecast's standalone binary.
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
# In a terminal it first shows what it will do and asks: proceed, customize or cancel. With no
# terminal to ask through (CI, an agent, a container build) it uses the defaults and says so. Pass
# options after `sh -s --`, as in `curl -LsSf … | sh -s -- -y`; run with --help to list them.
#
# Linux and macOS, x64 and arm64. Anywhere else: npm install -g @syv-ai/rulecast.
set -u

VERSION="0.11.0"

say() { printf 'rulecast: %s\n' "$*"; }
fail() {
  printf 'rulecast: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Installs rulecast $VERSION's standalone binary and puts it on your PATH.

usage: install.sh [options]      (piped: curl -LsSf <url> | sh -s -- [options])

  -y, --yes               Ask nothing: install with the defaults and any options given
      --install-dir DIR   Install as DIR/rulecast (default: \$XDG_BIN_HOME, else ~/.local/bin)
      --no-modify-path    Change no shell startup file
  -h, --help              Print this and exit

Each has an environment variable, for setups that can't pass options: RULECAST_YES=1,
RULECAST_INSTALL_DIR=DIR, RULECAST_NO_MODIFY_PATH=1. RULECAST_DOWNLOAD_URL points at a mirror
of the release assets.
EOF
}

# $1 with $HOME shown as ~, for messages.
tilde() {
  case "$1" in
    "${HOME:-/nonexistent}" | "${HOME:-/nonexistent}"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Why $1 can't be the install directory, or nothing. It goes into the startup files inside double
# quotes, under $HOME through $HOME, so only the rest has to be safe there.
dir_problem() {
  case "$1" in
    /*) ;;
    *)
      printf 'the install directory must be an absolute path, not %s' "$1"
      return
      ;;
  esac
  case "$1" in
    "${HOME:-/nonexistent}"/*) rest="${1#"$HOME"}" ;;
    *) rest="$1" ;;
  esac
  case "$rest" in
    *[\"\$\`\\]*) printf 'the install directory cannot contain ", $, ` or \\: %s' "$1" ;;
  esac
}

# Sets `shown` (the install directory as the startup files name it) and `env_line` (the line that
# sources its env file) for the current `dir`.
naming() {
  case "$dir" in
    "${HOME:-/nonexistent}"/*) shown="\$HOME${dir#"$HOME"}" ;;
    *) shown="$dir" ;;
  esac
  env_line=". \"$shown/env\""
}

on_path() {
  case ":${PATH:-}:" in
    *:"$dir":*) return 0 ;;
  esac
  return 1
}

# The startup files the install will add the source line to, one per line: none when the
# directory is on the PATH already, PATH changes are off, or there is no HOME.
planned_files() {
  if on_path || [ "$modify_path" != 1 ] || [ -z "${HOME:-}" ]; then return 0; fi
  for file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    case "$file" in
      "$HOME/.bashrc" | "$HOME/.bash_profile") [ -f "$file" ] || continue ;;
      "$HOME/.zshrc")
        case "${SHELL:-}" in */zsh) ;; *) [ -f "$file" ] || continue ;; esac
        ;;
    esac
    if [ -f "$file" ] && grep -qxF "$env_line" "$file"; then continue; fi
    printf '%s\n' "$file"
  done
}

summary() {
  naming
  printf '\nrulecast %s will be installed:\n\n  binary   %s/rulecast\n' "$VERSION" "$(tilde "$dir")"
  files="$(planned_files)"
  if on_path; then
    printf '  PATH     already has %s\n' "$(tilde "$dir")"
  elif [ "$modify_path" != 1 ]; then
    printf '  PATH     no startup file changed; you add %s yourself\n' "$(tilde "$dir")"
  elif [ -n "$files" ]; then
    list=""
    while IFS= read -r file; do list="${list:+$list, }$(tilde "$file")"; done <<EOF
$files
EOF
    printf '  PATH     add %s in %s\n' "$(tilde "$dir")" "$list"
  else
    printf '  PATH     your startup files already add %s\n' "$(tilde "$dir")"
  fi
}

customize() {
  while :; do
    printf 'Install rulecast where? [%s]: ' "$(tilde "$dir")"
    read -r answer <&3 || answer=""
    case "$answer" in
      "") answer="$dir" ;;
      "~") answer="$HOME" ;;
      "~"/*) answer="$HOME/${answer#"~/"}" ;;
    esac
    problem="$(dir_problem "$answer")"
    if [ -z "$problem" ]; then
      dir="${answer%/}"
      break
    fi
    say "$problem"
  done
  naming
  if on_path || [ -z "${HOME:-}" ]; then return 0; fi
  printf 'Add %s to your PATH in your shell startup files? [Y/n]: ' "$(tilde "$dir")"
  read -r answer <&3 || answer=""
  case "$answer" in
    n | N | no | No | NO) modify_path=0 ;;
    *) modify_path=1 ;;
  esac
}

main() {
  yes=""
  [ "${RULECAST_YES:-}" = 1 ] && yes=1
  dir="${RULECAST_INSTALL_DIR:-}"
  modify_path=1
  [ "${RULECAST_NO_MODIFY_PATH:-}" = 1 ] && modify_path=0
  # Where the questions are read from: the terminal, also when the script itself arrives on stdin.
  # RULECAST_INSTALL_TTY replaces it, for tests.
  tty="${RULECAST_INSTALL_TTY:-/dev/tty}"
  while [ $# -gt 0 ]; do
    case "$1" in
      -y | --yes) yes=1 ;;
      --install-dir)
        [ $# -ge 2 ] || fail "--install-dir needs a directory"
        dir="$2"
        shift
        ;;
      --install-dir=*) dir="${1#*=}" ;;
      --no-modify-path) modify_path=0 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) fail "unknown option $1 (run with --help to list them)" ;;
    esac
    shift
  done

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

  [ -n "$dir" ] || dir="${XDG_BIN_HOME:-}"
  if [ -z "$dir" ]; then
    [ -n "${HOME:-}" ] || fail "HOME is not set; pass --install-dir to say where rulecast should go"
    dir="$HOME/.local/bin"
  fi
  problem="$(dir_problem "$dir")"
  [ -z "$problem" ] || fail "$problem"
  dir="${dir%/}"
  naming

  if [ -z "$yes" ] && (: <"$tty") 2>/dev/null; then
    exec 3<"$tty"
    while :; do
      summary
      printf '\n1) Proceed (default)\n2) Customize\n3) Cancel\n> '
      read -r choice <&3 || choice=3
      case "$choice" in
        "" | 1) break ;;
        2) customize ;;
        3)
          say "cancelled; nothing was installed"
          exit 1
          ;;
        *) say "answer 1, 2 or 3" ;;
      esac
    done
    exec 3<&-
    printf '\n'
  elif [ -z "$yes" ]; then
    say "no terminal to ask through: installing with the defaults (--help lists the options)"
  fi
  base="${RULECAST_DOWNLOAD_URL:-https://github.com/syv-ai/rulecast/releases/download/v$VERSION}"
  asset="rulecast-$target"

  part=""
  tmp="$(mktemp -d)" || fail "could not create a temporary directory"
  trap 'rm -rf "$tmp"; [ -z "$part" ] || rm -f "$part"' EXIT
  trap 'exit 1' HUP INT TERM

  say "downloading rulecast $VERSION for $target"
  (cd "$tmp" && curl --proto '=https' --tlsv1.2 -fsSLO "$base/$asset" &&
    curl --proto '=https' --tlsv1.2 -fsSLO "$base/$asset.sha256") ||
    fail "could not download $base/$asset; nothing was installed"
  # The first field of the .sha256 is the hash, compared here rather than by `-c`, which some
  # implementations pass on an empty or garbled file.
  read -r expected _ <"$tmp/$asset.sha256" || expected=""
  actual="$($sha256 "$tmp/$asset")" || actual=""
  actual="${actual%% *}"
  case "$expected" in
    "" | *[!0-9a-f]*) fail "the release's checksum file is not a SHA-256 hash; nothing was installed" ;;
  esac
  [ "$actual" = "$expected" ] || fail "the download does not match its checksum; nothing was installed"

  # Written beside the old one, tried, and only then renamed over it: a hook running the old
  # rulecast never runs a half-written file, and one that does not run here replaces nothing.
  mkdir -p "$dir" || fail "could not create $dir"
  part="$dir/.rulecast.$$.tmp"
  { cp "$tmp/$asset" "$part" && chmod 755 "$part"; } || fail "could not write $part"
  installed="$("$part" --version 2>/dev/null)" ||
    fail "the $target binary does not run on this machine; nothing was installed. Use npm instead: npm install -g @syv-ai/rulecast"
  mv -f "$part" "$dir/rulecast" || fail "could not install $dir/rulecast"
  part=""
  say "installed rulecast $installed at $dir/rulecast"

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
  if on_path; then return 0; fi
  if [ "$modify_path" != 1 ] || [ -z "${HOME:-}" ]; then
    say "$dir is not on your PATH. Add this line to your shell's startup file: $env_line"
    return 0
  fi
  files="$(planned_files)"
  if [ -n "$files" ]; then
    while IFS= read -r file; do
      printf '\n# Added by the rulecast installer\n%s\n' "$env_line" >>"$file" || fail "could not write $file"
      say "added $dir to the PATH in $file"
    done <<EOF
$files
EOF
  fi
  case "${SHELL:-}" in
    */fish) say "for fish, run: fish_add_path $dir" ;;
  esac
  say "to use rulecast in this shell now, run: $env_line"
  return 0
}

main "$@"
