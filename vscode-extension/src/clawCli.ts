import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface ClawExtensionConfig {
  clawPath?: string;
  workspaceRoot?: string;
  defaultModel?: string;
  openaiBaseUrl?: string;
  envFile?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type PathExists = (candidate: string) => boolean;

export function resolveClawPath(
  config: ClawExtensionConfig,
  platform = process.platform,
  pathExists: PathExists = fs.existsSync,
): string {
  const explicit = config.clawPath?.trim();
  if (explicit) {
    return explicit;
  }

  if (config.workspaceRoot) {
    const binaryName = platform === "win32" ? "claw.exe" : "claw";
    const candidate = path.join(
      config.workspaceRoot,
      "rust",
      "target",
      "release",
      binaryName,
    );
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return "claw";
}

export function buildJsonArgs(command: string[], model?: string): string[] {
  const args = ["--output-format", "json"];
  if (model && ["prompt", "status", "subagent"].includes(command[0])) {
    args.push("--model", model);
  }
  return [...args, ...command];
}

export function buildTerminalArgs(command: string[], model?: string): string[] {
  const args: string[] = [];
  if (model) {
    args.push("--model", model);
  }
  return [...args, ...command];
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

export function buildEnv(
  baseEnv: NodeJS.ProcessEnv,
  config: ClawExtensionConfig,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  if (config.envFile) {
    try {
      Object.assign(env, parseEnvFile(fs.readFileSync(config.envFile, "utf8")));
    } catch {
      // Missing local env files should not prevent non-credentialed commands.
    }
  }

  if (config.openaiBaseUrl?.trim()) {
    env.OPENAI_BASE_URL = config.openaiBaseUrl.trim();
  }

  return env;
}

export function runClaw(
  binary: string,
  args: string[],
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        cwd,
        env,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || stdout.trim() || error.message;
          reject(new Error(detail));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export async function runClawJson<T = unknown>(
  binary: string,
  args: string[],
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<T> {
  const result = await runClaw(binary, args, cwd, env);
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`claw returned non-JSON output: ${reason}\n${result.stdout}`);
  }
}

export function notificationDir(home = os.homedir()): string {
  return path.join(home, ".claw", "sessions", "notifications");
}

export function readNotificationFiles(dir: string): Array<{ name: string; data: unknown }> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".notification.json"))
    .sort()
    .map((name) => {
      const fullPath = path.join(dir, name);
      const text = fs.readFileSync(fullPath, "utf8");
      return { name, data: JSON.parse(text) };
    });
}
