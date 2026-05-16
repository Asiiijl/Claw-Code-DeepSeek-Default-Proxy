# Claw Code — DeepSeek Subagent Fork

<p align="center">
  <a href="https://github.com/ultraworkers/claw-code">upstream: ultraworkers/claw-code</a>
</p>

> **This fork** is customized for **DeepSeek API** integration with automatic proxy support
> and a working `subagent spawn` CLI command. Designed for users behind firewalls (China/GFW)
> who need DuckDuckGo web search and OpenAI-compatible model access through a proxy tunnel.

---

## ✨ What's Different from Upstream

| Feature | Upstream | This Fork |
|---|---|---|
| **Default LLM Backend** | Anthropic Claude | **DeepSeek** (`openai/deepseek-chat`) |
| **`subagent spawn`** | Stub / no implementation | Fully working, no `--model` needed |
| **`subagent batch`** | — | Parallel agent cluster: dispatch N concurrent subagents from a file / stdin / args |
| **WebSearch proxy** | No proxy support | Reads `HTTP_PROXY` / `HTTPS_PROXY` from env & config |
| **CLI default model** | `claude-opus-4-6` | `openai/deepseek-chat` (no `--model` flag required) |
| **Config-based proxy** | — | Loads proxy from `.claw.json` `"env"` block (Windows-safe) |
| **`openai/` prefix routing** | Always preserves prefix | Strips `openai/` prefix for DeepSeek API (which rejects it) |

---

## 🚀 Quick Start (DeepSeek)

### 1. Prerequisites

- [Rust](https://rustup.rs/) 1.80+
- A [DeepSeek API key](https://platform.deepseek.com/api_keys)
- (Optional, in China) A proxy client like Clash Verge / v2ray running on `http://127.0.0.1:7897`

### 2. Clone and Build

```bash
git clone <your-fork-url> claw-code
cd claw-code/rust
cargo build --release -p rusty-claude-cli
```

The binary is at `rust/target/release/claw` (or `claw.exe` on Windows).

### 3. Set Environment Variables

**Required — tells claw to use DeepSeek instead of Anthropic:**

```bash
export OPENAI_API_KEY="sk-<your-deepseek-key>"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
```

**Optional — model override (defaults to `deepseek-chat` → `deepseek-v4-flash`):**

```bash
export ANTHROPIC_MODEL="openai/deepseek-chat"
```

**Proxy (required in China / GFW environments):**

```bash
export HTTPS_PROXY="http://127.0.0.1:7897"
export HTTP_PROXY="http://127.0.0.1:7897"
export NO_PROXY="localhost,127.0.0.1"
```

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
$env:OPENAI_API_KEY = "sk-<your-deepseek-key>"
$env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"
$env:NO_PROXY = "localhost,127.0.0.1"
```

Add these to your PowerShell profile (`$PROFILE`) so they persist across terminal sessions:
```powershell
# Check profile path
$PROFILE

# Edit profile (creates if missing)
notepad $PROFILE
```

Paste the `$env:` lines above and save. Restart your terminal.
</details>

### 4. Health Check

```bash
# Quick prompt — verifies DeepSeek API connectivity
claw prompt "say hello"
```

> **No `--model` flag needed!** The compiled default is now `openai/deepseek-chat`.

### 5. Use `subagent spawn`

The killer feature. Spawn a sub-agent that has web search + file read + bash access:

```bash
claw subagent spawn "查一下北京现在的天气"
claw subagent spawn "Search the web for latest AI news and summarize"
```

Override per-command if needed:
```bash
claw --model openai/gpt-4.1-mini subagent spawn "use a different model"
```

### 6. Use `subagent batch` — Parallel Agent Cluster (new)

Dispatch many subagent tasks concurrently from the CLI. Each non-empty,
non-`#` line of the input becomes one independent `subagent spawn` invocation.
Concurrency is capped by `--parallel` (default `4`, hard max `32`).

```bash
# From a task file
cat > tasks.txt <<EOF
# lines starting with # are skipped
Use WebSearch to find the latest RISC-V CSR spec and summarize 3 points
Read README.md and list the top 5 missing-piece TODOs
Run \`make sim\` in the current dir and explain any errors
EOF
claw subagent batch --parallel 3 --file tasks.txt

# From stdin
printf 'task A\ntask B\ntask C\n' | claw subagent batch -

# As inline positional args
claw subagent batch "task one" "task two" "task three"

# JSON output for scripting / CI
claw --output-format json subagent batch -p 4 -f tasks.txt | jq '.batch'
```

Each task's stdout/stderr/exit_code/duration is captured and printed under a
banner like `[2/5] OK (842 ms) :: <task>`. The overall command exits non-zero
if any task failed, so it composes cleanly with `&&` / CI pipelines.

#### 6.1 Non-blocking report-back pattern (new)

A **main agent** that tails a child terminal can easily get stuck when the
child stays attached to a streaming UI. To avoid that, `subagent batch` now
supports three orthogonal flags:

| Flag | Short | Effect |
|------|-------|--------|
| `--timeout SECS` | `-t` | Per-task wall-clock timeout; the worker `kill()`s the child and records `exit_code=124`, `timed_out=true`. Max 86400s. |
| `--retries N`    | `-r` | Retry failed tasks up to N times (default 0, max 10). Timeouts are **not** retried by design. |
| `--report-file PATH` | `-R` | Atomically write the full JSON report to `PATH` on exit (writes `PATH.tmp` then `rename`). |

The recommended pattern for an automation main-agent is:

```bash
# 1. Fire-and-forget: parent does NOT need to tail the child terminal.
nohup claw subagent batch -p 4 -t 90 -r 1 \
    -R /tmp/claw_report.json -f tasks.txt > /tmp/claw_batch.log 2>&1 &

# 2. Do other work, then poll the report file (cheap, race-free).
while [ ! -f /tmp/claw_report.json ]; do
    do_other_things
    sleep 5
done

# 3. Consume the structured result.
jq '.batch, (.results[] | {index, exit_code, timed_out, attempts})' /tmp/claw_report.json
```

This eliminates the "main agent blocks on child stdout" anti-pattern: the
parent simply checks if the file exists. Inside, every task carries
`exit_code`, `duration_ms`, `attempts`, `timed_out`, `stdout`, `stderr`, and
the top-level `batch` block carries `total / parallel / failed / timed_out /
timeout_secs / retries / completed_at`.

### 7. Cross-distro installer

Install on most Linux distros (Ubuntu/Debian, Fedora/RHEL, Arch, openSUSE,
Alpine), WSL2, and macOS (via Homebrew) with a single script:

```bash
curl -fsSL https://raw.githubusercontent.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy/feat/batch-timeout-retries-report/install-claw.sh -o install-claw.sh
chmod +x install-claw.sh
./install-claw.sh                  # default install
./install-claw.sh --dir /opt/claw  # custom path
./install-claw.sh --skip-deps      # if you already have git/cc/make/rustup
./install-claw.sh --no-rc          # don't touch ~/.bashrc / ~/.zshrc
```

What it does: detects the package manager (`apt-get` / `dnf` / `yum` /
`pacman` / `zypper` / `apk` / `brew`), installs build tools, installs
`rustup` (minimal stable profile) if `cargo` is missing, clones this fork,
runs `cargo build --release -p rusty-claude-cli`, symlinks
`~/.local/bin/claw`, optionally injects an idempotent block into your
shell rc (`~/.bashrc` / `~/.zshrc` / fish), and prints a WSL-specific proxy
hint only when WSL is detected (`/proc/version` containing `microsoft`).

---

## 🔧 Proxy Configuration

### Problem

On **Windows**, the `terminal` tool used by AI agents spawns `claw` in a separate `sh`/cmd process
that **does not inherit** PowerShell profile environment variables (`$env:HTTPS_PROXY`).
This causes DuckDuckGo `WebSearch` requests to fail with timeouts behind the GFW,
even though wttr.in and httpbin.org work (they are directly reachable from China).

### Solution: Dual-Layer Proxy Injection

This fork applies proxy settings at **two independent layers**:

#### Layer 1: Environment Variables (fast path)

`HTTPS_PROXY` / `HTTP_PROXY` are read by `api::ProxyConfig::from_env()` at runtime.
Works on macOS/Linux and when the terminal shell has the variables set.

#### Layer 2: `.claw.json` Config Bootstrap (Windows-safe path)

In `main.rs` → `run()`, claw loads `.claw.json` and `.claw/settings.json` **before any network call**,
reads the `"env"` block, and injects `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` into `std::env`.
This happens at the process level, so child `reqwest::Client` builders can see them.

**To configure** — edit your `.claw.json` (project root):

```json
{
  "aliases": {
    "quick": "haiku"
  },
  "env": {
    "HTTPS_PROXY": "http://127.0.0.1:7897",
    "HTTP_PROXY": "http://127.0.0.1:7897",
    "NO_PROXY": "localhost,127.0.0.1"
  }
}
```

This is **required for Windows** when `claw` is invoked by an AI agent via the `terminal` tool.
Without it, `WebSearch` (DuckDuckGo) calls will fail silently.

### How Web Search Routes Through Proxy

```
claw subagent spawn "weather"
  → main.rs: loads .claw.json → sets env vars (Layer 2)
  → parse_args: detect_subagent_model_from_env()
  → tools/build_http_client: api::build_blocking_http_client_with(ProxyConfig::from_env())
  → reqwest::Client with Proxy::https("http://127.0.0.1:7897") + Proxy::http(...)
  → WebSearch → DuckDuckGo via proxy ✅
  → WebFetch → wttr.in directly (no proxy needed, DDNS reachable)
```

---

## 🔌 DeepSeek API Integration Details

### Model Routing

When you use `openai/deepseek-chat` as the model name:
- The `openai/` prefix routes the request to the **OpenAI-compatible provider**
- The wire function `wire_model_for_base_url()` detects the base URL contains `"deepseek"` and **strips** the `openai/` prefix, sending `deepseek-chat` on the wire
- DeepSeek server resolves `deepseek-chat` → `deepseek-v4-flash` internally

### V4 Reasoning Content

DeepSeek V4 models (`deepseek-v4-pro`, `deepseek-v4-flash`) return `reasoning_content` in their
streaming responses. This fork properly:
- Detects V4 models via `model_requires_reasoning_content_in_history()`
- Echoes prior `reasoning_content` back in assistant history messages
- Emits `thinking` blocks before text blocks in non-streaming responses

### Required Environment Variables

| Variable | Required | Value |
|---|---|---|
| `OPENAI_API_KEY` | ✅ Yes | `sk-...` (DeepSeek API key) |
| `OPENAI_BASE_URL` | ✅ Yes | `https://api.deepseek.com/v1` |
| `HTTPS_PROXY` | 🔶 China-only | `http://127.0.0.1:7897` |
| `HTTP_PROXY` | 🔶 China-only | `http://127.0.0.1:7897` |
| `NO_PROXY` | 🔶 China-only | `localhost,127.0.0.1` |

### Optional Variables

| Variable | Effect |
|---|---|
| `ANTHROPIC_MODEL` | Override the auto-detected model name |
| `CLAW_CONFIG_HOME` | Custom config directory (defaults to `~/.claw`) |

---

## 🧩 Code Changes Summary

### `rust/crates/api/src/http_client.rs`
- Added `build_blocking_http_client_with()` — shared proxy logic for blocking (sync) clients
- Added `ProxyBuilder` trait to abstract proxy injection over `ClientBuilder` + `blocking::ClientBuilder`
- Sets 20s timeout, redirect limit, and user-agent

### `rust/crates/api/Cargo.toml`
- Added `blocking` feature to `reqwest` dependency

### `rust/crates/tools/src/lib.rs`
- `build_http_client()` now delegates to `api::build_blocking_http_client_with(api::ProxyConfig::from_env())`
- Removed duplicate proxy-reading code (was reading env vars independently, missing `NO_PROXY` and `.no_proxy()`)

### `rust/crates/rusty-claude-cli/src/main.rs`
- **Default model changed** from `claude-opus-4-6` to `openai/deepseek-chat` — no `--model` flag needed
- Added **config bootstrap** in `run()` — loads proxy from `.claw.json` `"env"` block before network
- `parse_args()`: `"subagent"` match arm with `spawn`/`list`/`steer` subcommands
- `detect_subagent_model_from_env()`: auto-detects DeepSeek when `OPENAI_BASE_URL` + `OPENAI_API_KEY` are set
- Removed duplicate function definitions (cleanup)

### `rust/crates/api/src/providers/openai_compat.rs`
- `wire_model_for_base_url()`: strips `openai/` prefix for DeepSeek base URL (which rejects prefixed model names)

### `.claw.json`
- Added `"env"` block with proxy configuration consumed by the config bootstrap

---

## 🧪 Verification Checklist

After setup, run these to confirm everything works:

```bash
# 1. Build succeeds
cargo build --release -p rusty-claude-cli

# 2. DeepSeek API responds (no --model!)
claw prompt "hello"

# 3. Subagent spawn works
claw subagent spawn "北京天气"

# 4. WebSearch goes through proxy (should complete < 2s)
claw subagent spawn "Use WebSearch to search for test and say done"

# 5. WebFetch fallback works
claw subagent spawn "Fetch https://wttr.in/Beijing?format=4 and summarize"
```

---

## 📦 Arch Linux Migration

If migrating from Windows to Arch Linux, copy these portable files:

- `claw-code-arch-patches.patch` — all code changes in one git patch
- `claw-code-arch-setup.sh` — one-click setup: dependencies → clone → apply → build → `.bashrc`

The setup script handles:
```bash
# Install Rust, git, build deps
# Clone this repo
# Apply patch
# Build release
# Write .bashrc with env vars + PATH
```

---

## 📚 Additional Documentation

- [`USAGE.md`](./USAGE.md) — upstream usage guide (build, auth, CLI, session management, parity harness)
- [`rust/README.md`](./rust/README.md) — crate map, workspace layout, CLI surface, features
- [`docs/navigation-file-context.md`](./docs/navigation-file-context.md) — terminal navigation, scrollback, `@path` file context
- [`docs/local-openai-compatible-providers.md`](./docs/local-openai-compatible-providers.md) — Ollama/llama.cpp/vLLM, OpenRouter, local skills
- [`docs/windows-install-release.md`](./docs/windows-install-release.md) — Windows release install, provider switching, notification smoke paths
- [`PARITY.md`](./PARITY.md) — Rust-port parity status and migration notes
- [`ROADMAP.md`](./ROADMAP.md) — active roadmap and cleanup backlog
- [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), [`SUPPORT.md`](./SUPPORT.md), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

---

## License

MIT — see [`LICENSE`](./LICENSE).

*This repository is not affiliated with, endorsed by, or maintained by Anthropic or DeepSeek.*
