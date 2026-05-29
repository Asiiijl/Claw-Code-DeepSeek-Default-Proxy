import * as assert from "assert";
import {
  buildJsonArgs,
  buildTerminalArgs,
  parseEnvFile,
  resolveClawPath,
  shellQuote,
} from "../src/clawCli";

export function runClawCliTests(): void {
  assert.strictEqual(
    resolveClawPath({ clawPath: "/opt/claw" }, "linux", () => false),
    "/opt/claw",
  );

  assert.strictEqual(
    resolveClawPath(
      { workspaceRoot: "/repo" },
      "linux",
      (candidate) => candidate === "/repo/rust/target/release/claw",
    ),
    "/repo/rust/target/release/claw",
  );

  assert.strictEqual(
    resolveClawPath({ workspaceRoot: "C:\\repo" }, "win32", () => false),
    "claw",
  );

  assert.deepStrictEqual(buildJsonArgs(["status"], "openai/deepseek-chat"), [
    "--output-format",
    "json",
    "--model",
    "openai/deepseek-chat",
    "status",
  ]);

  assert.deepStrictEqual(buildJsonArgs(["subagent", "list"], "openai/deepseek-chat"), [
    "--output-format",
    "json",
    "--model",
    "openai/deepseek-chat",
    "subagent",
    "list",
  ]);

  assert.deepStrictEqual(buildTerminalArgs(["prompt", "hello"], "sonnet"), [
    "--model",
    "sonnet",
    "prompt",
    "hello",
  ]);

  assert.deepStrictEqual(
    parseEnvFile("OPENAI_BASE_URL=https://api.deepseek.com/v1\nexport NO_PROXY='localhost,127.0.0.1'\n# comment\n"),
    {
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      NO_PROXY: "localhost,127.0.0.1",
    },
  );

  assert.strictEqual(shellQuote("simple/path"), "simple/path");
  assert.strictEqual(shellQuote("hello world"), "'hello world'");
}
