#!/usr/bin/env sh
# install-claw.sh — Cross-distro installer for Claw-Code (DeepSeek default proxy fork)
#
# Supports:
#   - Debian / Ubuntu (apt-get)
#   - Arch / Manjaro  (pacman)
#   - Fedora / RHEL / CentOS / Rocky / AlmaLinux (dnf / yum)
#   - openSUSE        (zypper)
#   - Alpine          (apk)
#   - macOS           (brew)
#   - WSL2 Ubuntu     (apt-get + proxy hint)
#
# Strategy:
#   1) Detect package manager and install: git, curl, ca-certificates, build-essential equivalents
#   2) Install rustup if cargo not found (no system Rust packages — they're usually too old)
#   3) Clone repo (skip if --dir exists)
#   4) cargo build --release -p rusty-claude-cli
#   5) Symlink ~/.local/bin/claw  (no sudo)
#   6) Inject idempotent block into the user's shell rc (bash/zsh/fish)
#   7) Detect WSL and print proxy guidance only when relevant
#   8) Final doctor: cargo, claw --help, claw subagent batch --help
#
# Usage:
#   ./install-claw.sh                            # default install to $HOME/tools/Claw-Code-DeepSeek-Default-Proxy
#   ./install-claw.sh --dir /opt/claw            # custom install dir
#   ./install-claw.sh --skip-deps                # skip package-manager install
#   ./install-claw.sh --no-rc                    # do not touch shell rc files
#   ./install-claw.sh --help

set -eu

REPO_URL="https://github.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy.git"
DEFAULT_DIR="$HOME/tools/Claw-Code-DeepSeek-Default-Proxy"
INSTALL_DIR="$DEFAULT_DIR"
SKIP_DEPS=0
NO_RC=0

# ----- pretty printing (no colors if not a TTY) -----
if [ -t 1 ]; then
    C_R="$(printf '\033[31m')"; C_G="$(printf '\033[32m')"
    C_Y="$(printf '\033[33m')"; C_B="$(printf '\033[34m')"
    C_0="$(printf '\033[0m')"
else
    C_R=""; C_G=""; C_Y=""; C_B=""; C_0=""
fi
info()  { printf '%s[INFO]%s %s\n'  "$C_B" "$C_0" "$*"; }
warn()  { printf '%s[WARN]%s %s\n'  "$C_Y" "$C_0" "$*" >&2; }
err()   { printf '%s[ERR ]%s %s\n'  "$C_R" "$C_0" "$*" >&2; }
ok()    { printf '%s[ OK ]%s %s\n'  "$C_G" "$C_0" "$*"; }

usage() {
    cat <<EOF
install-claw.sh — Cross-distro installer for Claw-Code DeepSeek default proxy

Options:
  --dir PATH       Install dir (default: $DEFAULT_DIR)
  --skip-deps      Don't install system packages (assume already present)
  --no-rc          Don't modify ~/.profile / ~/.zshrc / fish config
  -h, --help       Show this help

After install:
  source ~/.profile     # or .zshrc / restart shell (or open a new terminal)
  claw --help
  claw subagent batch --help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dir) INSTALL_DIR="$2"; shift 2 ;;
        --skip-deps) SKIP_DEPS=1; shift ;;
        --no-rc) NO_RC=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) err "Unknown option: $1"; usage; exit 1 ;;
    esac
done

# ----- detect environment -----
detect_os() {
    UNAME_S="$(uname -s)"
    case "$UNAME_S" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *) err "Unsupported OS: $UNAME_S"; exit 1 ;;
    esac

    IS_WSL=0
    if [ "$OS" = "linux" ] && [ -r /proc/version ]; then
        if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
            IS_WSL=1
        fi
    fi
}

detect_pkg_mgr() {
    if [ "$OS" = "macos" ]; then
        if command -v brew >/dev/null 2>&1; then
            PKG_MGR="brew"
        else
            warn "brew not found. Install from https://brew.sh first, or pass --skip-deps."
            PKG_MGR="none"
        fi
        return
    fi

    for cand in apt-get dnf yum pacman zypper apk; do
        if command -v "$cand" >/dev/null 2>&1; then
            PKG_MGR="$cand"
            return
        fi
    done
    PKG_MGR="none"
}

run_sudo() {
    # Run a command as root: prefer sudo, fall back to su -c (Alpine etc.), fall back to direct (already root)
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        warn "No sudo available; attempting su -c"
        su -c "$*"
    fi
}

install_deps() {
    if [ "$SKIP_DEPS" -eq 1 ]; then
        info "--skip-deps given; not installing system packages."
        return
    fi

    info "Installing build dependencies via $PKG_MGR ..."
    case "$PKG_MGR" in
        apt-get)
            run_sudo apt-get update -y
            run_sudo apt-get install -y --no-install-recommends \
                git curl ca-certificates build-essential pkg-config
            ;;
        dnf)
            run_sudo dnf install -y git curl ca-certificates @development-tools pkgconf-pkg-config || \
                run_sudo dnf install -y git curl ca-certificates gcc make pkgconf-pkg-config
            ;;
        yum)
            run_sudo yum install -y git curl ca-certificates gcc gcc-c++ make pkgconfig
            ;;
        pacman)
            run_sudo pacman -Sy --needed --noconfirm git curl ca-certificates base-devel pkgconf
            ;;
        zypper)
            run_sudo zypper --non-interactive install git curl ca-certificates gcc gcc-c++ make pkg-config
            ;;
        apk)
            run_sudo apk add --no-cache git curl ca-certificates build-base pkgconf
            ;;
        brew)
            brew install git pkg-config || true
            ;;
        none)
            warn "Unknown package manager — skipping system deps. Make sure git/curl/cc/make are installed."
            ;;
    esac
    ok "System dependencies ready."
}

install_rust() {
    if command -v cargo >/dev/null 2>&1; then
        ok "Rust already installed: $(cargo --version)"
        return
    fi
    info "Installing rustup (stable, minimal profile, no prompt) ..."
    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required to install rustup. Aborting."
        exit 1
    fi
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
    ok "Rust installed: $(cargo --version)"
}

clone_or_update() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Repo already exists at $INSTALL_DIR — fetching latest ..."
        (cd "$INSTALL_DIR" && git fetch --all --prune) || warn "git fetch failed; continuing with existing checkout"
    else
        info "Cloning $REPO_URL → $INSTALL_DIR ..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi
    ok "Source ready at $INSTALL_DIR"
}

build_binary() {
    info "Building rusty-claude-cli (release) ..."
    (cd "$INSTALL_DIR/rust" && cargo build --release -p rusty-claude-cli)
    BIN_PATH="$INSTALL_DIR/rust/target/release/claw"
    [ -x "$BIN_PATH" ] || { err "Build produced no binary at $BIN_PATH"; exit 1; }
    ok "Built $BIN_PATH"
}

install_symlink() {
    mkdir -p "$HOME/.local/bin"
    LINK="$HOME/.local/bin/claw"
    if [ -L "$LINK" ] || [ -e "$LINK" ]; then
        rm -f "$LINK"
    fi
    ln -s "$BIN_PATH" "$LINK"
    ok "Symlinked $LINK → $BIN_PATH"
}

inject_rc() {
    if [ "$NO_RC" -eq 1 ]; then
        info "--no-rc given; skipping shell rc injection."
        return
    fi

    # Pick rc file based on $SHELL.
    #
    # IMPORTANT: bash's default ~/.bashrc starts with `case $- in *i*) ;; *) return;; esac`
    # which causes non-interactive login shells (e.g. `bash -lc 'claw ...'` invoked by
    # CI / VS Code tasks / cron) to skip the export block entirely. So for bash we write
    # to ~/.profile, which is *always* sourced by login shells regardless of interactivity.
    # (Debian/Ubuntu's default ~/.profile already sources ~/.bashrc when interactive, so
    # both modes pick the env up.)
    case "${SHELL:-}" in
        */zsh) RC="$HOME/.zshrc" ;;
        */fish)
            RC="$HOME/.config/fish/config.fish"
            mkdir -p "$(dirname "$RC")"
            ;;
        *) RC="$HOME/.profile" ;;
    esac

    MARK_BEGIN="# >>> claw-code installer >>>"
    MARK_END="# <<< claw-code installer <<<"

    if [ -f "$RC" ] && grep -qF "$MARK_BEGIN" "$RC"; then
        info "RC ($RC) already has claw block — leaving alone."
        return
    fi

    info "Appending claw block to $RC ..."
    case "${SHELL:-}" in
        */fish)
            {
                printf '\n%s\n' "$MARK_BEGIN"
                printf 'set -gx PATH $HOME/.local/bin $PATH\n'
                printf 'if test -f $HOME/.cargo/env.fish\n    source $HOME/.cargo/env.fish\nend\n'
                printf '# DeepSeek default proxy (uncomment + fill in)\n'
                printf '# set -gx OPENAI_API_KEY "sk-..."\n'
                printf '# set -gx OPENAI_BASE_URL "https://api.deepseek.com/v1"\n'
                printf '# set -gx ANTHROPIC_MODEL "openai/deepseek-chat"\n'
                printf '%s\n' "$MARK_END"
            } >> "$RC"
            ;;
        *)
            {
                printf '\n%s\n' "$MARK_BEGIN"
                printf '# Loaded by login shells (incl. non-interactive `bash -lc`),\n'
                printf '# so VS Code / CI tasks reliably see these vars.\n'
                printf 'export PATH="$HOME/.local/bin:$PATH"\n'
                printf '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"\n'
                printf '# DeepSeek default proxy (uncomment + fill in)\n'
                printf '# export OPENAI_API_KEY="sk-..."\n'
                printf '# export OPENAI_BASE_URL="https://api.deepseek.com/v1"\n'
                printf '# export ANTHROPIC_MODEL="openai/deepseek-chat"\n'
                printf '%s\n' "$MARK_END"
            } >> "$RC"
            ;;
    esac
    ok "Injected block into $RC"
}

wsl_proxy_hint() {
    if [ "$IS_WSL" -eq 1 ]; then
        cat <<EOF

${C_Y}[WSL detected]${C_0} If you use a Windows-side proxy (Clash, V2Ray, etc.),
add a $HOME/.claw.json file like:

  {
    "env": {
      "HTTPS_PROXY": "http://127.0.0.1:7890",
      "HTTP_PROXY":  "http://127.0.0.1:7890",
      "NO_PROXY":    "localhost,127.0.0.1"
    }
  }

Change the port to match your proxy (Clash default 7890, V2Ray often 10809).
On native Linux / macOS without a proxy, you can skip this step.
EOF
    fi
}

doctor() {
    info "Final check ..."
    if "$HOME/.local/bin/claw" --help >/dev/null 2>&1; then
        ok "claw --help works"
    else
        warn "claw --help failed; PATH may not include ~/.local/bin yet (re-source your rc)"
    fi
    if "$HOME/.local/bin/claw" subagent batch --help 2>&1 | grep -q -- '--report-file'; then
        ok "subagent batch (with --timeout/--retries/--report-file) is available"
    else
        warn "subagent batch help is missing new flags — please re-run build."
    fi
}

# ----- main -----
info "Claw-Code installer starting"
detect_os
info "OS=$OS  WSL=$IS_WSL"
detect_pkg_mgr
info "Package manager: $PKG_MGR"

install_deps
install_rust
clone_or_update
build_binary
install_symlink
inject_rc
wsl_proxy_hint
doctor

cat <<EOF

${C_G}=== All done ===${C_0}
Next steps:
  1. Re-source your shell rc:    . "\$HOME/.profile"   (or .zshrc / restart shell)
  2. Set your DeepSeek key:      export OPENAI_API_KEY=sk-...
                                  export OPENAI_BASE_URL=https://api.deepseek.com/v1
                                  export ANTHROPIC_MODEL=openai/deepseek-chat
  3. Try it:                     claw --help
                                  claw subagent batch -p 2 -R /tmp/r.json "say hi" "say bye"
                                  cat /tmp/r.json | jq .

Repo: $INSTALL_DIR
EOF
