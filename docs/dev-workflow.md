# Claw Code Development Workflow

This workspace is a Rust-first CLI with Python support scripts and release
validation docs. The goal is to keep local dogfood work, DeepSeek defaults, and
open-source maintenance checks aligned.

## Local Environment

- Primary shell: WSL2 or Linux.
- Rust entrypoint: `rust/Cargo.toml`.
- Python entrypoint: root-level `tests/` and `.github/scripts/`.
- Formatting entrypoint: `scripts/fmt.sh --check` from the repository root.
- Build cache: `rust/target/`, which is local-only and must not be committed.

DeepSeek/OpenAI-compatible development should use environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export HTTPS_PROXY="http://127.0.0.1:7897"
export HTTP_PROXY="http://127.0.0.1:7897"
export NO_PROXY="localhost,127.0.0.1"
```

Do not write API keys into `.claw.json`, `.claude.json`, README examples, test
fixtures, or committed session files.

## Baseline Checks

Run these after setup and before broad work:

```bash
scripts/fmt.sh --check
cd rust && cargo check --workspace
cd ..
python3 -m unittest discover -s tests -v
python3 .github/scripts/check_doc_source_of_truth.py
python3 .github/scripts/check_release_readiness.py
```

For shared runtime or CLI changes, add:

```bash
cd rust
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
./scripts/run_mock_parity_harness.sh
python3 scripts/run_mock_parity_diff.py --no-run
```

For provider or subagent work, split checks into credential-free smoke tests and
live credential tests. Credential-free tests should cover local commands such as
`help`, `status`, `config env`, and `doctor`. Live tests may cover `prompt`,
`subagent spawn`, and `subagent batch` only when the required API key and proxy
environment are available.

## Workspace Hygiene Classification

Preserve:

- Rust crates, Python support modules, tests, and release scripts.
- `README.md`, `USAGE.md`, `PARITY.md`, `ROADMAP.md`, and policy docs.
- G002-G012 verification maps under `docs/`.
- `.omx/cc2` and `.omx/ultragoal` evidence files when they are referenced by
  release-readiness or roadmap reports.

Sanitize:

- `.claw.json` may keep proxy-only defaults but no credentials.
- `.claude.json` dogfood permission defaults must be documented as local
  dogfood context, not user-facing safety guidance.
- Historical logs should stay only when they are cited release or roadmap
  evidence.

Delete or keep untracked:

- `.claw/sessions/`
- `.claude/sessions/`
- `.port_sessions/`
- `rust/target/`
- ad hoc logs and scratch files that are not release evidence

## Roadmap Execution

Use the existing G-stream evidence as the long-running development backbone:

- G002-G006: security, boot/session, events/reports, branch recovery, and task
  policy.
- G007/G011: plugin, MCP, ACP/Zed discoverability, and ecosystem UX.
- G009-G012: Windows, release docs, session hygiene, and final release gates.

Do not sweep hundreds of ROADMAP pinpoints in one change. Group each pinpoint by
stream, implement a small behavior slice, add focused tests, then rerun the
stream's verification map.
