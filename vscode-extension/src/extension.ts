import * as vscode from "vscode";
import {
  buildEnv,
  buildJsonArgs,
  buildTerminalArgs,
  notificationDir,
  readNotificationFiles,
  resolveClawPath,
  runClawJson,
  shellQuote,
  type ClawExtensionConfig,
} from "./clawCli";

type TreeKind = "provider" | "sessions" | "subagents";

class ClawTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    description?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
  }
}

class JsonTreeProvider implements vscode.TreeDataProvider<ClawTreeItem> {
  private readonly changed = new vscode.EventEmitter<ClawTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly kind: TreeKind,
    private readonly load: (kind: TreeKind) => Promise<unknown>,
  ) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(element: ClawTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ClawTreeItem[]> {
    try {
      const data = await this.load(this.kind);
      return objectToItems(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = new ClawTreeItem("Unavailable", undefined, message);
      item.iconPath = new vscode.ThemeIcon("warning");
      return [item];
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new JsonTreeProvider("provider", loadTreeData);
  const sessions = new JsonTreeProvider("sessions", loadTreeData);
  const subagents = new JsonTreeProvider("subagents", loadTreeData);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("claw.providerStatus", provider),
    vscode.window.registerTreeDataProvider("claw.sessions", sessions),
    vscode.window.registerTreeDataProvider("claw.subagents", subagents),
    command("claw.prompt", prompt),
    command("claw.openReplTerminal", openReplTerminal),
    command("claw.status", () => showJsonCommand("status", ["status"])),
    command("claw.doctor", () => showJsonCommand("doctor", ["doctor"])),
    command("claw.configureDeepSeek", configureDeepSeek),
    command("claw.spawnSubagent", spawnSubagent),
    command("claw.showSubagentNotifications", showSubagentNotifications),
    command("claw.refreshViews", () => {
      provider.refresh();
      sessions.refresh();
      subagents.refresh();
    }),
  );
}

export function deactivate(): void {
  // No persistent background process is owned by the extension.
}

function command(name: string, handler: (...args: unknown[]) => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(name, handler);
}

async function prompt(): Promise<void> {
  const text = await vscode.window.showInputBox({
    title: "Claw Prompt",
    prompt: "Send a one-shot prompt to claw",
    ignoreFocusOut: true,
  });
  if (!text?.trim()) {
    return;
  }

  const config = readConfig();
  if (useIntegratedTerminal()) {
    sendToTerminal("Claw Prompt", ["prompt", text], config.defaultModel);
    return;
  }

  await showJsonCommand("prompt", ["prompt", text]);
}

function openReplTerminal(): void {
  const config = readConfig();
  sendToTerminal("Claw REPL", [], config.defaultModel);
}

async function configureDeepSeek(): Promise<void> {
  const config = vscode.workspace.getConfiguration("claw");
  await config.update(
    "openaiBaseUrl",
    "https://api.deepseek.com/v1",
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "defaultModel",
    "openai/deepseek-chat",
    vscode.ConfigurationTarget.Workspace,
  );
  vscode.window.showInformationMessage(
    "Claw DeepSeek settings updated. Set OPENAI_API_KEY in your user environment or machine-local config.",
  );
}

async function spawnSubagent(): Promise<void> {
  const text = await vscode.window.showInputBox({
    title: "Spawn Claw Subagent",
    prompt: "Task for the background subagent",
    ignoreFocusOut: true,
  });
  if (!text?.trim()) {
    return;
  }

  sendToTerminal("Claw Subagent", ["subagent", "spawn", text], readConfig().defaultModel);
}

async function showSubagentNotifications(): Promise<void> {
  const files = readNotificationFiles(notificationDir());
  await showJsonDocument(
    "claw-notifications.json",
    files.length === 0 ? { notifications: [], count: 0 } : { notifications: files, count: files.length },
  );
}

async function showJsonCommand(title: string, commandArgs: string[]): Promise<void> {
  const config = readConfig();
  const binary = resolveClawPath(config);
  const args = buildJsonArgs(commandArgs, config.defaultModel);
  const data = await runClawJson(binary, args, config.workspaceRoot, buildEnv(process.env, config));
  await showJsonDocument(`claw-${title}.json`, data);
}

async function showJsonDocument(name: string, data: unknown): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: `${JSON.stringify(data, null, 2)}\n`,
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function loadTreeData(kind: TreeKind): Promise<unknown> {
  const config = readConfig();
  const binary = resolveClawPath(config);
  const env = buildEnv(process.env, config);
  if (kind === "provider") {
    return runClawJson(binary, buildJsonArgs(["status"], config.defaultModel), config.workspaceRoot, env);
  }
  if (kind === "sessions") {
    return runClawJson(binary, buildJsonArgs(["session", "list"], config.defaultModel), config.workspaceRoot, env);
  }
  return runClawJson(binary, buildJsonArgs(["subagent", "list"], config.defaultModel), config.workspaceRoot, env);
}

function sendToTerminal(name: string, commandArgs: string[], model?: string): void {
  const config = readConfig();
  const binary = resolveClawPath(config);
  const args = buildTerminalArgs(commandArgs, model);
  const terminal = vscode.window.createTerminal({
    name,
    cwd: config.workspaceRoot,
    env: buildEnv(process.env, config) as Record<string, string>,
  });
  terminal.show();
  terminal.sendText([binary, ...args].map(shellQuote).join(" "));
}

function readConfig(): ClawExtensionConfig {
  const config = vscode.workspace.getConfiguration("claw");
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return {
    clawPath: config.get<string>("path") || undefined,
    workspaceRoot,
    defaultModel: config.get<string>("defaultModel") || "openai/deepseek-chat",
    openaiBaseUrl: config.get<string>("openaiBaseUrl") || undefined,
    envFile: config.get<string>("envFile") || undefined,
  };
}

function useIntegratedTerminal(): boolean {
  return vscode.workspace.getConfiguration("claw").get<boolean>("useIntegratedTerminal", true);
}

function objectToItems(data: unknown): ClawTreeItem[] {
  if (Array.isArray(data)) {
    return data.slice(0, 50).map((value, index) => itemForValue(String(index), value));
  }
  if (data && typeof data === "object") {
    return Object.entries(data as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, value]) => itemForValue(key, value));
  }
  return [new ClawTreeItem(String(data))];
}

function itemForValue(key: string, value: unknown): ClawTreeItem {
  if (value && typeof value === "object") {
    const item = new ClawTreeItem(key, vscode.TreeItemCollapsibleState.Collapsed);
    item.tooltip = JSON.stringify(value, null, 2);
    return item;
  }
  return new ClawTreeItem(key, undefined, value === undefined ? "" : String(value));
}

