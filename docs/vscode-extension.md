# VS Code Extension

The VS Code integration lives in [`../vscode-extension`](../vscode-extension)
and is intentionally a thin shell over the local `claw` CLI. The extension does
not reimplement the Rust runtime.

## Capabilities

- Command palette entries for prompt, REPL terminal, status, doctor, DeepSeek
  setup, subagent spawn, and subagent notification inspection.
- Activity bar views for provider status, saved sessions, and subagents.
- JSON-only CLI integration for machine-readable commands.
- Integrated terminal execution for interactive or credentialed flows.

## CLI lookup

The extension resolves the binary in this order:

1. VS Code setting `claw.path`
2. Workspace `rust/target/release/claw` or `claw.exe`
3. `claw` from `PATH`

## Settings

- `claw.path`: explicit CLI path.
- `claw.defaultModel`: default model passed to prompt/subagent commands.
- `claw.openaiBaseUrl`: OpenAI-compatible base URL such as DeepSeek.
- `claw.envFile`: optional local env file loaded at runtime.
- `claw.useIntegratedTerminal`: run prompt/subagent flows in VS Code terminal.
- `claw.outputFormat`: currently fixed to `json` for automation.

Do not put API keys in workspace settings. Use process environment variables,
machine-local config, or VS Code user SecretStorage outside the repository.

## Local development

```bash
cd vscode-extension
npm install
npm run compile
npm test
npm run package
```

`npm run package` requires `vsce` through `npx` and produces a local VSIX file.
Generated `out/`, `node_modules/`, and `*.vsix` files are ignored by git.

## Manual smoke

1. Build the Rust CLI with `cd rust && cargo build --release -p rusty-claude-cli`.
2. Open this repository in VS Code.
3. Run `Claw: Doctor` and `Claw: Status`.
4. Set `claw.openaiBaseUrl` to `https://api.deepseek.com/v1` and
   `claw.defaultModel` to `openai/deepseek-chat`.
5. Run `Claw: Open REPL Terminal` or `Claw: Prompt`.
6. Run `Claw: Spawn Subagent` and inspect the Subagents view.

