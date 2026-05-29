# Claw Code VS Code Extension

This extension is a thin VS Code control surface over the local `claw` CLI.
It does not reimplement the Rust runtime.

## Development

```bash
npm install
npm run compile
npm test
```

Build the CLI first if you want workspace-local binary discovery:

```bash
cd ../rust
cargo build --release -p rusty-claude-cli
```

## Settings

- `claw.path`: explicit path to the `claw` binary.
- `claw.defaultModel`: default model for prompt and subagent commands.
- `claw.openaiBaseUrl`: OpenAI-compatible base URL, defaulting to DeepSeek.
- `claw.envFile`: optional local env file loaded at runtime.
- `claw.useIntegratedTerminal`: run interactive flows in a terminal.
- `claw.outputFormat`: fixed to `json` for machine-readable integration.

Do not commit provider secrets. Use user environment variables, VS Code user
settings, or machine-local files outside version control.

