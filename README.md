# Claw Code — DeepSeek Subagent Fork

<p align="center">
  <img src="./assets/claw-hero.jpeg" alt="ClawCode Banner" width="100%" />
</p>

<p align="center">
  <strong>Creative Engineering Cockpit for Serious AI Builders.</strong><br />
  <em>Open-source AI coding agent with terminal-native execution, multi-agent orchestration, and DeepSeek-first integration.</em>
</p>

<p align="center">
  <a href="https://github.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy"><img src="https://img.shields.io/badge/fork-Asiiijl%2FClaw--Code--DeepSeek--Default--Proxy-blue" alt="Fork" /></a>
  <a href="https://github.com/ultraworkers/claw-code"><img src="https://img.shields.io/badge/upstream-ultraworkers%2Fclaw--code-lightgrey" alt="Upstream" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [What's Different from Upstream](#-whats-different-from-upstream)
- [Architecture](#-architecture)
- [Quick Start (DeepSeek)](#-quick-start-deepseek)
- [Non-Blocking Subagent System](#-non-blocking-subagent-system)
- [Subagent Batch (Parallel Agent Cluster)](#-subagent-batch-parallel-agent-cluster)
- [Proxy Configuration](#-proxy-configuration)
- [DeepSeek API Integration Details](#-deepseek-api-integration-details)
- [Cross-Distro Installer](#-cross-distro-installer)
- [Code Changes Summary](#-code-changes-summary)
- [Verification Checklist](#-verification-checklist)
- [Troubleshooting](#-troubleshooting)
- [Additional Documentation](#-additional-documentation)
- [License](#-license)

---

## 🎯 Overview

> **This fork** is customized for **DeepSeek API** integration with automatic proxy support
> and a working `subagent spawn` CLI command. Designed for users behind firewalls (China/GFW)
> who need DuckDuckGo web search and OpenAI-compatible model access through a proxy tunnel.

### Cooperative with Zed Agent

This fork works cooperatively with the [Zed Agent hack fork](https://github.com/CCChisato/Zed-Agent-Auto-Merge-Hack):

- Both the `claw` CLI and the Zed agent have been modified for **non-blocking subagent** cooperation
- Subagents dispatched via `claw subagent spawn` or Zed's native `spawn_agent` tool run **in the background** without blocking the caller
- When they complete, results are automatically written to a shared notification directory (`~/.claw/sessions/notifications/`)
- Results are injected into the agent's message stream on the next turn
- **No human approval needed** — all tool permissions are auto-granted

---

## ✨ What's Different from Upstream

| Feature | Upstream (`ultraworkers/claw-code`) | This Fork |
|---|---|---|
| **Default LLM Backend** | Anthropic Claude | **DeepSeek** (`openai/deepseek-chat`) |
| **`subagent spawn`** | Stub / no implementation | **Fully working**, no `--model` needed |
| **`subagent status`** | Basic | **Enhanced** with structured `##SUBAGENT_REPORT##` parsing |
| **`subagent batch`** | — | **Parallel agent cluster**: dispatch N concurrent subagents from file / stdin / args |
| **Non-blocking subagent** | — | Detached background process with `DETACHED_PROCESS` (Windows) / fork (Linux/macOS) |
| **Structured reporting** | — | Auto-appended `##SUBAGENT_REPORT##` format instruction + machine-readable notification files |
| **Notification directory** | — | `~/.claw/sessions/notifications/<id>.notification.json` for cooperative consumption |
| **WebSearch proxy** | No proxy support | Reads `HTTP_PROXY` / `HTTPS_PROXY` from env & config |
| **CLI default model** | `claude-opus-4-6` | `openai/deepseek-chat` (no `--model` flag required) |
| **Config-based proxy** | — | Loads proxy from `.claw.json` `"env"` block (Windows-safe) |
| **`openai/` prefix routing** | Always preserves prefix | Strips `openai/` prefix for DeepSeek API (which rejects it) |
| **DeepSeek V4 reasoning** | — | Properly handles `reasoning_content` in streaming responses |
| **Cross-distro installer** | — | Single `install-claw.sh` script supporting Ubuntu/Debian, Fedora/RHEL, Arch, openSUSE, Alpine, WSL2, macOS |
| **`~/.profile` injection** | — | Writes env vars to `~/.profile` for non-interactive login shells (VS Code tasks, CI, cron) |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────┐
│                   CLI Layer (Rust)                │
│   CLI parsing, REPL, stream rendering, sandbox    │
├──────────────────────────────────────────────────┤
│              Agent Orchestration Layer            │
│   Multi-agent dispatch, subagent spawn/batch,     │
│   tool calling, MCP protocol, skill system        │
├──────────────────────────────────────────────────┤
│              Session & Memory Management          │
│   JSONL persistence, conversation history,        │
│   compaction, session fork/switch/delete          │
├──────────────────────────────────────────────────┤
│              LLM Backend Adapter Layer             │
│   Anthropic Claude, OpenAI-compatible (DeepSeek), │
│   model routing, prefix stripping, V4 reasoning   │
├──────────────────────────────────────────────────┤
│              Security & Sandbox                    │
│   Permission modes (read-only to full-access),    │
│   namespace isolation, filesystem restrictions    │
└──────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Rust for CLI, Python for agents** | Rust provides performance & safety for the CLI; Python offers flexibility for agent logic |
| **`subagent spawn` as detached process** | Ensures subagents survive parent exit; critical for non-blocking workflows |
| **`##SUBAGENT_REPORT##` structured format** | Machine-parsable output enables cooperative agent workflows |
| **Proxy in `.claw.json` env block** | Windows-safe; child processes spawned by agents inherit proxy settings |
| **`~/.profile` not `~/.bashrc`** | Non-interactive login shells (VS Code tasks, cron) skip `~/.bashrc` but source `~/.profile` |

---

## 🚀 Quick Start (DeepSeek)

### 1. Prerequisites

- [Rust](https://rustup.rs/) 1.80+
- A [DeepSeek API key](https://platform.deepseek.com/api_keys)
- (Optional, in China) A proxy client like Clash Verge / v2ray running on `http://127.0.0.1:7897`

### 2. Clone and Build

```bash
git clone https://github.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy.git claw-code
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

**Optional — model override (defaults to `deepseek-chat` -> `deepseek-v4-flash`):**

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
# Quick prompt - verifies DeepSeek API connectivity
claw prompt "say hello"
```

> **No `--model` flag needed!** The compiled default is now `openai/deepseek-chat`.

### 5. Use `subagent spawn`

The killer feature. Spawn a sub-agent that has web search + file read + bash access:

```bash
claw subagent spawn "check the weather in Beijing"
claw subagent spawn "Search the web for latest AI news and summarize"
```

Override per-command if needed:

```bash
claw --model openai/gpt-4.1-mini subagent spawn "use a different model"
```

### 6. Use `subagent batch` — Parallel Agent Cluster

Dispatch many subagent tasks concurrently from the CLI:

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

---

## 🔄 Non-Blocking Subagent System

### How It Works

1. **Parent** calls `claw subagent spawn "task description"`
2. **Parent prints session_id** and exits immediately
3. **Child process** runs independently as a detached process
   - On Windows: uses `CREATE_DETACHED_PROCESS` flag to break out of the parent's Job Object
   - On Linux/macOS: standard fork with `Command::new`
4. **Child** executes the task using `claw --compact --output-format json prompt <msg>`
5. **On completion**, child writes:
   - Structured `##SUBAGENT_REPORT##` in its output
   - Notification file to `~/.claw/sessions/notifications/<id>.notification.json`
6. **Parent** (or Zed agent) can check `claw subagent status <id>` for results

### Structured Report Format

The subagent's prompt is automatically appended with the following instruction:

```
##SUBAGENT_REPORT##
- task: <task description>
- status: <success/partial/failed>
- summary: <one-line summary>
- key_findings: <key findings, max 3 points>
- raw_output: <raw output data if needed>
```

### Commands

```bash
# Spawn a subagent
claw subagent spawn "task description"

# Spawn without structured report suffix
claw subagent spawn --raw "task description"

# Check subagent status
claw subagent status <session-id>

# Full raw output
claw subagent status --full <session-id>

# List all subagent sessions
claw subagent list

# Steer / send additional instructions to a running subagent
claw subagent steer <session-id> "focus on performance"
```

### Notification Directory

```
~/.claw/sessions/notifications/
  +-- <id>.notification.json    # Structured report
  +-- ...
```

Each notification file contains:

```json
{
  "session_id": "abc123",
  "task": "task description",
  "status": "success",
  "summary": "one-line summary",
  "key_findings": ["finding 1", "finding 2"],
  "raw_output": "...",
  "completed_at": 1712345678
}
```

---

## 📦 Subagent Batch (Parallel Agent Cluster)

### Features

| Feature | Description |
|---|---|
| **Concurrent execution** | Up to 32 parallel subagents (default 4) |
| **Multiple input sources** | File (`-f`), stdin (`-`), positional args |
| **JSON output** | Machine-readable batch report via `--output-format json` |
| **Exit code propagation** | Non-zero exit if any task fails (composes with `&&` / CI) |
| **Attributed output** | Each result printed under `[i/N] OK (842ms) :: <task>` banner |

### Architecture

```
subagent batch
  -> ThreadPool (N workers)
  -> Each worker: Command::new(claw).arg("subagent").arg("spawn").arg(task)
  -> Collect results in shared Vec<TaskResult>
  -> Print attributed output / JSON report
  -> Exit with status code
```

---

## 🔧 Proxy Configuration

### Problem

On **Windows**, the `terminal` tool used by AI agents spawns `claw` in a separate `sh`/cmd process that **does not inherit** PowerShell profile environment variables (`$env:HTTPS_PROXY`). This causes DuckDuckGo `WebSearch` requests to fail with timeouts behind the GFW.

### Solution: Dual-Layer Proxy Injection

This fork applies proxy settings at **two independent layers**:

#### Layer 1: Environment Variables (fast path)

`HTTPS_PROXY` / `HTTP_PROXY` are read by `api::ProxyConfig::from_env()` at runtime. Works on macOS/Linux and when the terminal shell has the variables set.

#### Layer 2: `.claw.json` Config Bootstrap (Windows-safe path)

In `main.rs` -> `run()`, claw loads `.claw.json` and `.claw/settings.json` **before any network call**, reads the `"env"` block, and injects `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` into `std::env`. This happens at the process level, so child `reqwest::Client` builders can see them.

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

This is **required for Windows** when `claw` is invoked by an AI agent via the `terminal` tool. Without it, `WebSearch` (DuckDuckGo) calls will fail silently.

### How Web Search Routes Through Proxy

```
claw subagent spawn "weather"
  -> main.rs: loads .claw.json -> sets env vars (Layer 2)
  -> parse_args: detect_subagent_model_from_env()
  -> tools/build_http_client: api::build_blocking_http_client_with(ProxyConfig::from_env())
  -> reqwest::Client with Proxy::https("http://127.0.0.1:7897") + Proxy::http(...)
  -> WebSearch -> DuckDuckGo via proxy (OK)
  -> WebFetch -> wttr.in directly (no proxy needed, DDNS reachable)
```

---

## 🔌 DeepSeek API Integration Details

### Model Routing

When you use `openai/deepseek-chat` as the model name:

1. The `openai/` prefix routes the request to the **OpenAI-compatible provider**
2. The wire function `wire_model_for_base_url()` detects the base URL contains `"deepseek"` and **strips** the `openai/` prefix, sending `deepseek-chat` on the wire
3. DeepSeek server resolves `deepseek-chat` -> `deepseek-v4-flash` internally

### V4 Reasoning Content

DeepSeek V4 models (`deepseek-v4-pro`, `deepseek-v4-flash`) return `reasoning_content` in their streaming responses. This fork properly:

- Detects V4 models via `model_requires_reasoning_content_in_history()`
- Echoes prior `reasoning_content` back in assistant history messages
- Emits `thinking` blocks before text blocks in non-streaming responses

### Required Environment Variables

| Variable | Required | Value |
|---|---|---|
| `OPENAI_API_KEY` | Yes | `sk-...` (DeepSeek API key) |
| `OPENAI_BASE_URL` | Yes | `https://api.deepseek.com/v1` |
| `HTTPS_PROXY` | China-only | `http://127.0.0.1:7897` |
| `HTTP_PROXY` | China-only | `http://127.0.0.1:7897` |
| `NO_PROXY` | China-only | `localhost,127.0.0.1` |

### Optional Variables

| Variable | Effect |
|---|---|
| `ANTHROPIC_MODEL` | Override the auto-detected model name |
| `CLAW_CONFIG_HOME` | Custom config directory (defaults to `~/.claw`) |

---

## 📥 Cross-Distro Installer

Install on most Linux distros (Ubuntu/Debian, Fedora/RHEL, Arch, openSUSE, Alpine), WSL2, and macOS (via Homebrew) with a single script:

```bash
curl -fsSL https://raw.githubusercontent.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy/main/install-claw.sh -o install-claw.sh
chmod +x install-claw.sh
./install-claw.sh                  # default install
./install-claw.sh --dir /opt/claw  # custom path
./install-claw.sh --skip-deps      # if you already have git/cc/make/rustup
./install-claw.sh --no-rc          # don't touch ~/.profile / ~/.zshrc / fish config
```

### What It Does

1. Detects package manager (`apt-get` / `dnf` / `yum` / `pacman` / `zypper` / `apk` / `brew`)
2. Installs build tools (git, cc, make, rustup)
3. Clones this fork
4. Runs `cargo build --release -p rusty-claude-cli`
5. Symlinks `~/.local/bin/claw`
6. Optionally injects env vars into shell rc files:
   - `~/.profile` for bash
   - `~/.zshrc` for zsh
   - `~/.config/fish/config.fish` for fish
7. Prints WSL-specific proxy hint when detected

> **Why `~/.profile` for bash and not `~/.bashrc`?** Debian/Ubuntu's default `~/.bashrc` starts with `case $- in *i*) ;; *) return;; esac`, which causes **non-interactive login shells** (e.g. `bash -lc 'claw ...'` invoked by VS Code tasks, CI runners, or cron) to skip everything after that line. Putting env vars in `~/.profile` (which is sourced by every login shell, interactive or not) makes the credentials reliably available in every context.

---

## 🧩 Code Changes Summary

### Non-Blocking Subagent System (`rust/crates/rusty-claude-cli/src/main.rs`)

#### `subagent spawn` — Detached Background Process
- Replaced `std::thread::spawn` (killed on Windows when parent exits) with **detached child process**
- Uses `CREATE_DETACHED_PROCESS` flag on Windows to break out of the parent's Job Object
- On Linux/macOS: standard process spawn (processes are naturally independent)
- Child runs `claw --compact --output-format json prompt <msg>` independently
- Environment variable `CLAW_SUBAGENT_SESSION_ID` is passed to the child so it auto-writes completion

#### Structured Report (`##SUBAGENT_REPORT##`)
- On spawn, the prompt is automatically appended with formatting instructions
- Subagent is asked to output a `##SUBAGENT_REPORT##` section at the end
- `claw subagent status` parses the JSONL session dump to extract the report
- Default view shows structured fields: `task`, `status`, `summary`, `key_findings`, `raw_output`
- `claw subagent status --full` shows raw JSONL

#### Notification Directory
- On completion, writes `~/.claw/sessions/notifications/<id>.notification.json`
- Contains the parsed report for cooperative consumption by the Zed agent

#### `subagent status` Improvements
- `--output-format json` now includes a `report` field with parsed structured data
- `--full` flag shows the original completion JSON instead of the parsed report
- `--raw` / `--no-summary` on spawn skips appending the `##SUBAGENT_REPORT##` instruction

#### Auto-Detached Process (Windows Fix)
- Parent process exits immediately after printing session_id
- Child process survives independently via `DETACHED_PROCESS` creation flag
- PID is recorded in `.meta.json` for process inspection

### Subagent Batch (`rust/crates/rusty-claude-cli/src/main.rs`)

- `subagent batch` dispatches parallel `subagent spawn` invocations
- Each task is run as a separate `Command::new(claw).arg("subagent").arg("spawn").arg(task)`
- Thread pool with configurable concurrency (default 4, max 32)
- Input sources: file (`-f`), stdin (`-`), positional args
- JSON output mode for CI/scripting

### Proxy & DeepSeek Integration

#### `rust/crates/api/src/http_client.rs`
- Added `build_blocking_http_client_with()` — shared proxy logic for blocking (sync) clients
- Added `ProxyBuilder` trait to abstract proxy injection over `ClientBuilder` + `blocking::ClientBuilder`
- Sets 20s timeout, redirect limit, and user-agent

#### `rust/crates/api/Cargo.toml`
- Added `blocking` feature to `reqwest` dependency

#### `rust/crates/tools/src/lib.rs`
- `build_http_client()` now delegates to `api::build_blocking_http_client_with(api::ProxyConfig::from_env())`
- Removed duplicate proxy-reading code

#### `rust/crates/rusty-claude-cli/src/main.rs`
- **Default model changed** from `claude-opus-4-6` to `openai/deepseek-chat` — no `--model` flag needed
- Added **config bootstrap** in `run()` — loads proxy from `.claw.json` `"env"` block before network
- `parse_args()`: `"subagent"` match arm with `spawn`/`status`/`list`/`steer`/`batch` subcommands
- `detect_subagent_model_from_env()`: auto-detects DeepSeek when `OPENAI_BASE_URL` + `OPENAI_API_KEY` are set

#### `rust/crates/api/src/providers/openai_compat.rs`
- `wire_model_for_base_url()`: strips `openai/` prefix for DeepSeek base URL

#### `.claw.json`
- Added `"env"` block with proxy configuration

### Installer (`install-claw.sh`)

- Cross-distro package manager detection (apt-get, dnf, yum, pacman, zypper, apk, brew)
- Automatic rustup installation if cargo is missing
- `~/.profile` injection for non-interactive login shell compatibility
- WSL detection and proxy hint
- Optional `--dir`, `--skip-deps`, `--no-rc` flags

---

## 🧪 Verification Checklist

After setup, run these to confirm everything works:

```bash
# 1. Build succeeds
cargo build --release -p rusty-claude-cli

# 2. CLI reports correct version
./rust/target/release/claw --version

# 3. Doctor passes basic checks
./rust/target/release/claw doctor

# 4. Subagent commands are available
./rust/target/release/claw subagent list

# 5. Batch command parses correctly
./rust/target/release/claw subagent batch --help 2>&1

# 6. DeepSeek API responds (requires API key)
claw prompt "hello"

# 7. Subagent spawn works
claw subagent spawn "say done"

# 8. WebSearch goes through proxy (should complete < 2s)
claw subagent spawn "Use WebSearch to search for test and say done"

# 9. WebFetch fallback works
claw subagent spawn "Fetch https://wttr.in/Beijing?format=4 and summarize"

# 10. Batch execution works
claw subagent batch "echo hello" "echo world"
```

---

## 🔍 Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|---|---|---|
| `missing OpenAI credentials` in VS Code tasks | Non-interactive shell doesn't source `~/.bashrc` | Use `install-claw.sh` or manually add env vars to `~/.profile` |
| WebSearch times out (China/GFW) | No proxy configured | Set `HTTPS_PROXY` in `.claw.json` `"env"` block |
| `claw: command not found` | Binary not in PATH | Symlink to `~/.local/bin/` or add to PATH |
| `error: unknown subagent subcommand` | Wrong claw binary | Ensure you built from this fork, not upstream |
| DeepSeek returns 400 Bad Request | `openai/` prefix sent to DeepSeek API | This fork strips it automatically; verify you're using `openai/deepseek-chat` |
| Build fails with `rustup could not choose a version` | No default toolchain | Run `rustup default stable` |

### Debugging

```bash
# Check binary version and build info
claw --version

# Run health check
claw doctor

# Check sandbox status
claw sandbox

# View current workspace status
claw status

# Test subagent spawn with verbose output
claw subagent spawn --raw "echo hello"
```

---

## 📚 Additional Documentation

- [`USAGE.md`](./USAGE.md) — upstream usage guide (build, auth, CLI, session management, parity harness)
- [`rust/README.md`](./rust/README.md) — crate map, workspace layout, CLI surface, features
- [`docs/navigation-file-context.md`](./docs/navigation-file-context.md) — terminal navigation, scrollback, `@path` file context
- [`docs/local-openai-compatible-providers.md`](./docs/local-openai-compatible-providers.md) — Ollama/llama.cpp/vLLM, OpenRouter, local skills
- [`docs/windows-install-release.md`](./docs/windows-install-release.md) — Windows release install, provider switching, notification smoke paths
- [`docs/upstream-sync.md`](./docs/upstream-sync.md) — upstream merge workflow and fork-delta guardrails
- [`docs/fork-delta.md`](./docs/fork-delta.md) — DeepSeek fork invariants that must survive upstream syncs
- [`docs/vscode-extension.md`](./docs/vscode-extension.md) — VS Code extension architecture and local development flow
- [`PARITY.md`](./PARITY.md) — Rust-port parity status and migration notes
- [`ROADMAP.md`](./ROADMAP.md) — active roadmap and cleanup backlog
- [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), [`SUPPORT.md`](./SUPPORT.md), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

---

## 📄 License

MIT — see [`LICENSE`](./LICENSE).

*This repository is not affiliated with, endorsed by, or maintained by Anthropic or DeepSeek.*
