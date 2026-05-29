# Fork Delta Contract

This document records the behavior this fork must preserve when merging from
`ultraworkers/claw-code`.

## Provider and auth defaults

- Default user path is DeepSeek via OpenAI-compatible routing.
- `OPENAI_API_KEY` plus `OPENAI_BASE_URL=https://api.deepseek.com/v1` must route
  to DeepSeek without requiring `ANTHROPIC_API_KEY`.
- `openai/` model prefixes are routing hints for Claw, but DeepSeek wire
  requests must send bare model names such as `deepseek-chat`.
- DeepSeek V4 streaming must preserve `reasoning_content` as machine-visible
  thinking content before normal assistant text.
- Provider selection must prefer explicit model prefixes over ambient
  environment variables.

## Proxy and local environment

- Proxy config may come from `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, or
  non-secret `.claw.json` env entries.
- API keys, bearer tokens, and provider secrets must never be written into
  tracked config, docs fixtures, or release artifacts.
- WSL2 and Windows PowerShell examples must remain separated so users know when
  they are configuring Linux login shells versus native Windows shells.

## Subagent contract

- `claw subagent spawn` starts a detached background task and returns promptly.
- `claw subagent batch` runs multiple spawn tasks with bounded parallelism and
  non-zero exit propagation when any task fails.
- Subagent summaries remain parseable through `##SUBAGENT_REPORT##`.
- Notification consumers may rely on
  `~/.claw/sessions/notifications/*.notification.json` and subagent live JSON
  files for machine-readable status.

## JSON automation surfaces

The VS Code extension and other automation surfaces must consume JSON output
only. These commands are compatibility surfaces:

- `claw status --output-format json`
- `claw doctor --output-format json`
- `claw config env --output-format json`
- `claw subagent list --output-format json`
- `claw subagent status <id> --output-format json`
- `claw session list --output-format json`
- `claw session show <id|latest> --output-format json`

Fields may be added over time, but existing top-level `kind`, `status`, `error`,
and exit-code meanings must stay backward compatible.

## VS Code integration boundary

The VS Code extension is a thin UI/control layer over the `claw` CLI. It must
not duplicate Rust runtime behavior, parse human text output, or store provider
secrets in the repository.

