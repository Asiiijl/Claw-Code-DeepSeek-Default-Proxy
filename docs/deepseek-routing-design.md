# Claw Code 模型路由机制 — 从终端输入到 API 响应的完整旅程

## 目录

1. [现状：已经修复了，不再需要 `openai/` 前缀](#1-现状)
2. [完整链路追踪：从 `claw prompt "hello"` 到 DeepSeek API](#2-完整链路追踪)
3. [关键代码文件与结构体映射](#3-关键代码文件与结构体映射)
4. [DeepSeek 路由修复详解](#4-deepseek-路由修复详解)
5. [怎么读这个代码库](#5-怎么读这个代码库)

---

<a name="现状"></a>

## 1. 现状：已经修复了，不再需要 `openai/` 前缀

当前代码已经完成了修复，现在**不需要** `openai/` 前缀：

```bash
claw prompt "hello"                          # 默认就是 deepseek-chat，走 DeepSeek
claw --model deepseek-chat prompt "hello"    # 规范写法
claw --model openai/deepseek-chat prompt "hello"  # 仍然兼容
```

修复涉及 **3 个文件、4 处修改**（详见第 4 节）。

---

<a name="完整链路追踪"></a>

## 2. 完整链路追踪：从 `claw prompt "hello"` 到 DeepSeek API

### 第一阶段：main.rs → 解析参数

用户在终端输入:

```
D:\work\rust\claw-code> claw prompt "hello"
                         ↑     ↑       ↑
                     argv[0] argv[1] argv[2]  ← 程序名、子命令、参数
```

**文件**: `rust/crates/rusty-claude-cli/src/main.rs`

**步骤 1** — `main()` 函数 [L200]:

```rust
fn main() {
    if let Err(error) = run() {
        // 如果 run() 返回 Err → 打印错误信息并 exit(1)
        let message = error.to_string();
        classify_error_kind(&message);
        // ...
        std::process::exit(1);
    }
}
```

**步骤 2** — `run()` 函数 [L1196]:

```rust
fn run() -> Result<(), Box<dyn std::error::Error>> {
    // 1. 加载 .claw.json 中的代理设置 [L1201-1228]
    //    读取 env.HTTPS_PROXY / HTTP_PROXY → std::env::set_var
    let cwd = std::env::current_dir().ok();
    if let Some(cwd) = cwd.as_ref() {
        let loader = runtime::ConfigLoader::default_for(cwd);
        if let Ok(config) = loader.load() {
            if let Some(env_obj) = config.get("env").and_then(|v| v.as_object()) {
                for proxy_key in &["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", ...] {
                    if let Some(val) = env_obj.get(*proxy_key).and_then(|v| v.as_str()) {
                        if !val.is_empty() && std::env::var(*proxy_key).is_err() {
                            std::env::set_var(proxy_key, val);
                        }
                    }
                }
            }
        }
    }

    // 2. 收集命令行参数，跳过 argv[0]（程序路径）
    let args: Vec<String> = env::args().skip(1).collect();
    //    现在 args = ["prompt", "hello"]

    // 3. 解析参数 → CliAction 枚举
    match parse_args(&args)? {
        CliAction::Prompt { prompt, model, ... } => {
            // ... 执行 prompt ...
        }
        // ...
    }
}
```

**步骤 3** — `parse_args()` 函数 [L1794]:

```rust
fn parse_args(args: &[String]) -> Result<CliAction, String> {
    // model 初始化为 DEFAULT_MODEL = "deepseek-chat"（第 65 行）
    let mut model = DEFAULT_MODEL.to_string();
    let mut model_flag_raw: Option<String> = None;
    let mut output_format = CliOutputFormat::Text;
    let mut rest: Vec<String> = Vec::new();
    let mut index = 0;

    // 遍历所有参数
    while index < args.len() {
        match args[index].as_str() {
            "--model" => {
                // 如果传了 --model，覆盖默认值
                let value = args.get(index + 1).ok_or_else(|| ...)?;
                validate_model_syntax(value)?;
                model = resolve_model_alias_with_config(value);
                model_flag_raw = Some(value.clone());
                index += 2;
            }
            "--help" | "-h" => wants_help = true,
            // ... 其他 flag 处理 ...

            // 非 flag 参数 → 追加到 rest
            other => {
                rest.push(other.to_string());
                index += 1;
            }
        }
    }

    // 此时 rest = ["prompt", "hello"]

    // rest 非空 → 匹配第一个子命令
    match rest[0].as_str() {
        "prompt" => {
            let prompt = rest[1..].join(" ");  // "hello"
            Ok(CliAction::Prompt {
                prompt,                 // "hello"
                model,                  // "deepseek-chat"
                output_format,
                allowed_tools,
                permission_mode,
                compact: false,
                base_commit: None,
                reasoning_effort: None,
                allow_broad_cwd: false,
            })
        }
        "subagent" => { /* ... */ }
        // ...
    }
}
```

**关键常量** — `DEFAULT_MODEL` [L65]:

```rust
const DEFAULT_MODEL: &str = "deepseek-chat";
```

**解析结果结构体** — `CliAction` 枚举 [L1424]:

```rust
enum CliAction {
    Prompt {
        prompt: String,             // "hello"
        model: String,              // "deepseek-chat"
        output_format: CliOutputFormat,
        allowed_tools: Option<AllowedToolSet>,
        permission_mode: PermissionMode,
        compact: bool,
        base_commit: Option<String>,
        reasoning_effort: Option<String>,
        allow_broad_cwd: bool,
    },
    Repl { model, ... },
    SubagentSpawn { prompt, model, ... },
    SubagentBatch { tasks, parallel, model, ... },
    // ... 还有十几个变体
}
```

---

### 第二阶段：run() → 匹配 CliAction::Prompt

```rust
// [L1280] run() 函数中的 match
CliAction::Prompt {
    prompt, model, output_format, allowed_tools,
    permission_mode, compact, base_commit,
    reasoning_effort, allow_broad_cwd,
} => {
    // 1. 检查是否在过宽目录运行
    enforce_broad_cwd_policy(allow_broad_cwd, output_format)?;

    // 2. 检查 stale base 提醒
    run_stale_base_preflight(base_commit.as_deref());

    // 3. 合并 stdin 上下文（管道模式）
    let stdin_context = if matches!(permission_mode, PermissionMode::DangerFullAccess) {
        read_piped_stdin()
    } else {
        None
    };
    let effective_prompt = merge_prompt_with_stdin(&prompt, stdin_context.as_deref());

    // 4. 核心：构建 LiveCli 并执行
    let prompt_result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut cli = LiveCli::new(
            model,            // "deepseek-chat" → 存入 cli.model
            true,
            allowed_tools,
            permission_mode,
        )?;
        cli.set_reasoning_effort(reasoning_effort);
        cli.run_turn_with_output(&effective_prompt, output_format, compact)?;
        Ok(())
    })();

    // 如果失败并且是 subagent 后台，写错误文件
    if let Err(e) = prompt_result {
        if let Some(ref sid) = subagent_session_id {
            // 写 subagent 完成文件
        }
        return Err(e);
    }
}
```

---

### 第三阶段：LiveCli → 准备运行环境

**LiveCli 结构体** [L9379]:

```rust
struct LiveCli {
    model: String,                        // "deepseek-chat"
    allowed_tools: Option<AllowedToolSet>,
    permission_mode: PermissionMode,
    system_prompt: String,
    runtime: BuiltRuntime,
    session: ManagedSession,
    prompt_history: Vec<PromptHistoryEntry>,
}
```

`run_turn_with_output()` [L6086] 根据输出格式分派:

```rust
fn run_turn_with_output(&mut self, input: &str, output_format, compact) {
    match output_format {
        CliOutputFormat::Text if compact => self.run_prompt_compact(input),
        CliOutputFormat::Text => self.run_turn(input),       // ⬅ 走这里
        CliOutputFormat::Json => self.run_prompt_json(input),
    }
}
```

`run_turn()` [L6038] — 显示 spinner 并执行:

```rust
fn run_turn(&mut self, input: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (mut runtime, hook_abort_monitor) = self.prepare_turn_runtime(true)?;
    let mut permission_prompter = CliPermissionPrompter::new(self.permission_mode);

    // 终端显示: 🦀 Thinking...
    let summary = runtime.run_turn(input, Some(&mut permission_prompter))?;

    let final_text = final_assistant_text(&summary);
    println!("{final_text}");  // 终端显示: 你好！有什么我可以帮你的吗？
    Ok(())
}
```

**prepare_turn_runtime()** [L6012] — 构建 ConversationRuntime:

```rust
fn prepare_turn_runtime(&self, emit_output: bool) -> Result<(...), Box<dyn std::error::Error>> {
    let runtime = build_runtime(
        self.runtime.session().clone(),
        &self.session.id,
        self.model.clone(),       // "deepseek-chat" 传入
        self.system_prompt.clone(),
        true,
        emit_output,
        self.allowed_tools.clone(),
        self.permission_mode,
        None,
    )?.with_hook_abort_signal(hook_abort_signal.clone());
    Ok((runtime, hook_abort_monitor))
}
```

`build_runtime()` [L9528] 创建 `ConversationRuntime`:

```rust
fn build_runtime(session, session_id, model, system_prompt, ...) -> Result<BuiltRuntime, ...> {
    ConversationRuntime::new_with_features(
        session,
        AnthropicRuntimeClient::new(  // ⬅ 名字叫 Anthropic 但可以路由到任何 provider！
            session_id,
            model,                    // "deepseek-chat"
            enable_tools,
            emit_output,
            allowed_tools,
            tool_registry,
            progress_reporter,
        )?,
        CliToolExecutor::new(...),
        policy,
        system_prompt,
        &feature_config,
    )
}
```

---

### 第四阶段：AnthropicRuntimeClient::new() → provider 路由决策 ⭐

**⭐ 核心路由函数！** `AnthropicRuntimeClient::new()` [L9660]:

```rust
impl AnthropicRuntimeClient {
    fn new(session_id, model, ...) -> Result<Self, ...> {
        // 1. 解析模型别名
        let resolved_model = api::resolve_model_alias(&model);
        //    "deepseek-chat" 不是已知别名 → 原样返回

        // 2. ⭐ 检测 provider 类型
        let client = match detect_provider_kind(&resolved_model) {
            //    ↑ resolved_model = "deepseek-chat"
            //    ↑ 调用 api/src/providers/mod.rs 的 detect_provider_kind()

            ProviderKind::Anthropic => {
                // 走 Anthropic API
                ApiProviderClient::Anthropic(inner)
            }
            ProviderKind::Xai | ProviderKind::OpenAi => {
                // ✅ "deepseek-chat" 走到这里！
                ApiProviderClient::from_model_with_anthropic_auth(
                    &resolved_model,    // "deepseek-chat"
                    None,               // 没有 Anthropic auth
                )?
            }
        };

        Ok(Self { model, client, ... })
    }
}

struct AnthropicRuntimeClient {
    runtime: tokio::runtime::Runtime,   // Rust 异步运行时
    client: ApiProviderClient,           // ← 实际 API 客户端（枚举）
    model: String,                       // "deepseek-chat"
    enable_tools: bool,
    emit_output: bool,
    allowed_tools: Option<AllowedToolSet>,
    tool_registry: GlobalToolRegistry,
    progress_reporter: Option<InternalPromptProgressReporter>,
    reasoning_effort: Option<String>,
}
```

**`detect_provider_kind()`** — `api/src/providers/mod.rs` [L355]:

```rust
pub fn detect_provider_kind(model: &str) -> ProviderKind {
    // 第 1 步：前缀匹配（metadata_for_model）
    if let Some(metadata) = metadata_for_model(model) {
        return metadata.provider;
        //        ↑ "deepseek-chat" 在这里返回 ProviderKind::OpenAi！
    }
    // 第 2 步：OPENAI_BASE_URL + OPENAI_API_KEY 都设了 → OpenAi
    if std::env::var_os("OPENAI_BASE_URL").is_some()
       && openai_compat::has_api_key("OPENAI_API_KEY")
    { return ProviderKind::OpenAi; }
    // 第 3 步：ANTHROPIC_API_KEY 设了 → Anthropic
    if anthropic::has_auth_from_env_or_saved().unwrap_or(false) {
        return ProviderKind::Anthropic;
    }
    // 第 4 步：OPENAI_API_KEY 设了 → OpenAi
    if openai_compat::has_api_key("OPENAI_API_KEY") { return ProviderKind::OpenAi; }
    // 第 5 步：XAI_API_KEY 设了 → Xai
    if openai_compat::has_api_key("XAI_API_KEY") { return ProviderKind::Xai; }
    // 最后兜底
    ProviderKind::Anthropic
}
```

**⭐ `metadata_for_model()`** — `api/src/providers/mod.rs` [L231]:

```rust
pub fn metadata_for_model(model: &str) -> Option<ProviderMetadata> {
    let canonical = resolve_model_alias(model);

    // 1. "claude" → Anthropic
    if canonical.starts_with("claude") { /* ... */ }
    // 2. "grok" → xAI
    if canonical.starts_with("grok") { /* ... */ }
    // 3. "openai/" 或 "gpt-" → OpenAI
    if canonical.starts_with("openai/") || canonical.starts_with("gpt-") {
        return Some(ProviderMetadata {
            provider: ProviderKind::OpenAi,
            auth_env: "OPENAI_API_KEY",
            base_url_env: "OPENAI_BASE_URL",
            default_base_url: openai_compat::DEFAULT_OPENAI_BASE_URL,
        });
    }
    // 4. "qwen/" 或 "qwen-" → DashScope
    if canonical.starts_with("qwen/") || canonical.starts_with("qwen-") { /* ... */ }
    // 5. "kimi/" 或 "kimi-" → DashScope
    if canonical.starts_with("kimi/") || canonical.starts_with("kimi-") { /* ... */ }

    // 6. ⭐ "deepseek/" 或 "deepseek-" → OpenAI（修复 3）
    if canonical.starts_with("deepseek/") || canonical.starts_with("deepseek-") {
        return Some(ProviderMetadata {
            provider: ProviderKind::OpenAi,
            auth_env: "OPENAI_API_KEY",       // 读 OPENAI_API_KEY
            base_url_env: "OPENAI_BASE_URL",   // 读 OPENAI_BASE_URL
            default_base_url: openai_compat::DEFAULT_OPENAI_BASE_URL,
        });
    }
    None
}
```

**ProviderMetadata 结构体** [mod.rs L64]:

```rust
pub struct ProviderMetadata {
    pub provider: ProviderKind,       // Anthropic / Xai / OpenAi
    pub auth_env: &'static str,       // 读哪个 env var 拿 key
    pub base_url_env: &'static str,   // 读哪个 env var 拿 URL
    pub default_base_url: &'static str,
}

pub enum ProviderKind {
    Anthropic,
    Xai,
    OpenAi,     // ⬅ DeepSeek 走这个变体！
}
```

**本阶段结果**:

```
detect_provider_kind("deepseek-chat")
  → metadata_for_model("deepseek-chat")
    → starts_with("deepseek-")? YES！
    → Some(ProviderMetadata {
        provider: ProviderKind::OpenAi,
        auth_env: "OPENAI_API_KEY",
        base_url_env: "OPENAI_BASE_URL",
      })
  → return ProviderKind::OpenAi ✅
```

---

### 第五阶段：ProviderClient → 构建 HTTP 客户端

**文件**: `rust/crates/api/src/client.rs` [L20-58]

```rust
impl ProviderClient {
    pub fn from_model_with_anthropic_auth(
        model: &str,
        anthropic_auth: Option<AuthSource>,
    ) -> Result<Self, ApiError> {
        let resolved_model = providers::resolve_model_alias(model);
        match providers::detect_provider_kind(&resolved_model) {
            ProviderKind::Anthropic => { /* 构建 AnthropicClient */ }
            ProviderKind::Xai => { /* 构建 xAI client */ }
            ProviderKind::OpenAi => {
                // ← DeepSeek 走到这里！

                // 判断是不是 DashScope（qwen/kimi 系列）
                let config = match providers::metadata_for_model(&resolved_model) {
                    Some(meta) if meta.auth_env == "DASHSCOPE_API_KEY" => {
                        OpenAiCompatConfig::dashscope()
                    }
                    _ => OpenAiCompatConfig::openai(),
                    //   ↑ DeepSeek 走到这里！
                    //   config.provider_name = "OpenAI"
                    //   config.api_key_env = "OPENAI_API_KEY"
                    //   config.base_url_env = "OPENAI_BASE_URL"
                };

                Ok(Self::OpenAi(OpenAiCompatClient::from_env(config)?))
                //   ↑ 枚举变体 OpenAi(OpenAiCompatClient)
            }
        }
    }
}

pub enum ProviderClient {
    Anthropic(AnthropicClient),           // Anthropic API
    Xai(OpenAiCompatClient),              // xAI (Grok) API
    OpenAi(OpenAiCompatClient),           // OpenAI-compat API
    //   ↑ DeepSeek 走这个变体！
}
```

**OpenAiCompatClient::from_env()** — `openai_compat.rs` [L117]:

```rust
impl OpenAiCompatClient {
    pub fn from_env(config: OpenAiCompatConfig) -> Result<Self, ApiError> {
        Ok(Self {
            http: build_http_client_or_default(),

            api_key: /* 从 $OPENAI_API_KEY 环境变量读取 */,

            config: config,   // OpenAiCompatConfig::openai()

            base_url: read_base_url(config),
            //   ↑ read_base_url() 实现:
            //     1. std::env::var("OPENAI_BASE_URL")
            //     2. 如果设了 → 用 "https://api.deepseek.com/v1"
            //     3. 如果没设 → 用 default "https://api.openai.com/v1"
            //   → 你设了 OPENAI_BASE_URL=https://api.deepseek.com/v1
            //   → base_url = "https://api.deepseek.com/v1" ✅
        })
    }
}

pub struct OpenAiCompatConfig {
    pub provider_name: &'static str,    // "OpenAI"
    pub api_key_env: &'static str,      // "OPENAI_API_KEY"
    pub base_url_env: &'static str,     // "OPENAI_BASE_URL"
    pub default_base_url: &'static str, // "https://api.openai.com/v1"
    pub max_request_body_bytes: usize,
}
```

---

### 第六阶段：对话循环 → 发送请求

**文件**: `rust/crates/runtime/src/conversation.rs` [L316]

`ConversationRuntime::run_turn()` — 进入对话循环:

```rust
// [L316]
pub fn run_turn(&mut self, user_input: impl Into<String>,
                mut prompter: Option<&mut dyn PermissionPrompter>) -> Result<TurnSummary, RuntimeError>
{
    // 1. 记录用户输入到 session
    self.session.push_user_text(user_input.into());

    // 2. 进入循环（AI 可能多次调用工具）
    loop {
        // 构建 API 请求
        let request = ApiRequest {
            system_prompt: self.system_prompt.clone(),
            messages: self.session.messages.clone(),
        };

        // ⭐ 调用 API 客户端
        let events = match self.api_client.stream(request) {
            Ok(events) => events,
            Err(error) => return Err(error),
        };

        // 解析 assistant 消息
        let (assistant_message, usage, _) = match build_assistant_message(events) {
            Ok(result) => result,
            Err(error) => return Err(error),
        };

        // 如果没有 tool calls → 对话结束
        if assistant_message.tool_calls.is_empty() {
            self.session.push_assistant_message(assistant_message);
            break;
        }

        // 如果有 tool calls → 执行工具、追加结果、继续循环
        // ...
    }

    Ok(TurnSummary { final_text, usage, ... })
}
```

### 第七阶段：AnthropicRuntimeClient::stream → MessageRequest → wire_model

**AnthropicRuntimeClient::stream()** [main.rs L9736]:

```rust
impl ApiClient for AnthropicRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        // 构建 MessageRequest
        let message_request = MessageRequest {
            model: self.model.clone(),        // "deepseek-chat"
            max_tokens: max_tokens_for_model(&self.model),
            messages: convert_messages(&request.messages),
            system: request.system_prompt.join("\n\n"),
            tools: self.enable_tools.then(|| filter_tool_specs(...)),
            stream: true,
            reasoning_effort: self.reasoning_effort.clone(),
            ..Default::default()
        };

        // 发送
        self.consume_stream(&message_request, ...).await
    }
}

// 分发到对应的 provider
async fn consume_stream(&self, message_request: &MessageRequest, ...) -> ... {
    let mut stream = self.client.stream_message(message_request).await?;
    // client = ProviderClient::OpenAi(OpenAiCompatClient)
    // → 调用 OpenAiCompatClient::stream_message()
}
```

**OpenAiCompatClient::stream_message()** — 构建 HTTP 请求, 在 openai_compat.rs 中:

发送前调用 `wire_model_for_base_url()` 决定线缆上的模型名:

```rust
fn wire_model_for_base_url<'a>(
    model: &'a str,         // "deepseek-chat"
    config: OpenAiCompatConfig,
    base_url: &str,         // "https://api.deepseek.com/v1"
) -> Cow<'a, str> {
    // 查找 '/' 分隔符
    let Some(pos) = model.find('/') else {
        // ← "deepseek-chat" 没有 '/' !
        return Cow::Borrowed(model);
        //    ↑ 原样返回 "deepseek-chat" ✅
    };

    let lowered_prefix = model[..pos].to_ascii_lowercase();

    if lowered_prefix == "openai" {
        let trimmed_base_url = base_url.trim_end_matches('/');
        let default_openai = DEFAULT_OPENAI_BASE_URL.trim_end_matches('/');
        if config.provider_name == "OpenAI" && trimmed_base_url != default_openai {
            // 自定义 base_url → 判断要不要保留前缀
            if trimmed_base_url.contains("deepseek") {
                // "openai/deepseek-chat" → "deepseek-chat"
                return Cow::Borrowed(&model[pos + 1..]);
            }
            return Cow::Borrowed(model);  // OpenRouter: 保留前缀
        }
        return Cow::Borrowed(&model[pos + 1..]);
    }

    // "xai" / "grok" / "qwen" / "kimi" / "deepseek" → 剥离前缀
    if matches!(lowered_prefix.as_str(),
               "xai" | "grok" | "qwen" | "kimi" | "deepseek") {
        return Cow::Borrowed(&model[pos + 1..]);
        //    ↑ "deepseek/deepseek-chat" → "deepseek-chat" (修复 4)
    }

    Cow::Borrowed(model)
}
```

**本阶段结果**: `wire_model_for_base_url("deepseek-chat", ...)` → `"deepseek-chat"`（不变，没有 `/`）

最终发出的 HTTP 请求:
```
POST https://api.deepseek.com/v1/chat/completions
Authorization: Bearer sk-xxxxx
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "hello"}],
  "stream": true,
  "max_tokens": 4096
}
```

---

### 第八阶段：DeepSeek 服务器 → SSE 响应 → 终端输出

```
DeepSeek API 收到 { "model": "deepseek-chat" }
  → 内部解析 "deepseek-chat" → deepseek-v4-flash
  → 调用模型 → 生成回答
  → 返回 SSE 流:

data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}
data: {"choices":[{"delta":{"content":"你"},"index":0}]}
data: {"choices":[{"delta":{"content":"好"},"index":0}]}
data: {"choices":[{"delta":{"content":"！"},"index":0}]}
data: {"choices":[{"delta":{"content":"有"},"index":0}]}
...
data: {"choices":[{"delta":{},"finish_reason":"stop"}],
       "usage":{"prompt_tokens":10,"completion_tokens":20}}

  ↓

OpenAiCompatClient 解析 SSE 流
  → StreamState::ingest_chunk() — 逐块解析
  → 转换为 AssistantEvent::TextDelta("你")
  → 转换为 AssistantEvent::TextDelta("好")
  → ...
  → AssistantEvent::MessageStop
  → AssistantEvent::Usage { input: 10, output: 20 }

  ↓

ConversationRuntime::run_turn() 聚合事件
  → build_assistant_message(events)
  → 返回 TurnSummary { final_text: "你好！...", usage: ... }

  ↓

LiveCli::run_turn()
  → final_assistant_text(&summary)
  → println!("{final_text}")

  ↓

终端显示:
  ✔ ✨ Done
  你好！有什么我可以帮你的吗？
```

---

<a name="关键代码文件与结构体映射"></a>

## 3. 关键代码文件与结构体映射

### 文件索引

| 文件 | 核心职责 | 关键函数 / 结构体 / 常量 |
|---|---|---|
| `rust/crates/rusty-claude-cli/src/main.rs` | CLI 入口、参数解析、运行时构建 | `main()` L200, `run()` L1196, `parse_args()` L1794, `AnthropicRuntimeClient` L9648, `CliAction` L1424, `DEFAULT_MODEL` L65, `validate_model_syntax()` L2573, `build_runtime()` L9528, `LiveCli` L9379 |
| `rust/crates/api/src/providers/mod.rs` | 模型名 → Provider 路由 | `metadata_for_model()` L231, `detect_provider_kind()` L355, `resolve_model_alias()` L202, `ProviderKind` L57, `ProviderMetadata` L64 |
| `rust/crates/api/src/providers/openai_compat.rs` | OpenAI-compat 客户端实现 | `OpenAiCompatClient` L85, `wire_model_for_base_url()` L926, `OpenAiCompatConfig` L30 |
| `rust/crates/api/src/client.rs` | Provider 枚举和工厂方法 | `ProviderClient` L10, `from_model_with_anthropic_auth()` L20 |
| `rust/crates/api/src/http_client.rs` | HTTP 代理配置 | `ProxyConfig` L16, `build_http_client_with()` L83 |
| `rust/crates/runtime/src/conversation.rs` | 对话循环 | `ConversationRuntime::run_turn()` L316, `ApiClient` trait L57 |

### 核心枚举与结构体

#### `ProviderKind` [mod.rs L57-62]

```rust
pub enum ProviderKind {
    Anthropic,  // → AnthropicClient（Anthropic API）
    Xai,        // → OpenAiCompatClient（xAI config）
    OpenAi,     // → OpenAiCompatClient（openai / dashscope config）
                //   ↑ DeepSeek 走这个变体！
}
```

#### `ProviderMetadata` [mod.rs L64-70]

```rust
pub struct ProviderMetadata {
    pub provider: ProviderKind,      // 路由到哪个 provider
    pub auth_env: &'static str,      // 读哪个环境变量拿 API key
    pub base_url_env: &'static str,  // 读哪个环境变量拿 base URL
    pub default_base_url: &'static str,
}
```

#### `ProviderClient` [client.rs L10-14]

```rust
pub enum ProviderClient {
    Anthropic(AnthropicClient),      // Anthropic API
    Xai(OpenAiCompatClient),         // xAI (Grok)
    OpenAi(OpenAiCompatClient),      // OpenAI-compat（含 DeepSeek、DashScope）
}
```

#### `AnthropicRuntimeClient` [main.rs L9648]

```rust
struct AnthropicRuntimeClient {
    runtime: tokio::runtime::Runtime,
    client: ApiProviderClient,    // ← 实际客户端（枚举）
    model: String,                // "deepseek-chat"
    enable_tools: bool,
    emit_output: bool,
    allowed_tools: Option<AllowedToolSet>,
    tool_registry: GlobalToolRegistry,
    progress_reporter: Option<InternalPromptProgressReporter>,
    reasoning_effort: Option<String>,
}
```

### 完整调用链速查

```
parse_args(model=DEFAULT_MODEL="deepseek-chat")     [main.rs L1794]
  │
  ▼
run() match CliAction::Prompt { model }             [main.rs L1231 → L1280]
  │
  ▼
LiveCli::new(model)                                  [main.rs L5929]
  │ model → self.model
  ▼
prepare_turn_runtime()                               [main.rs L6012]
  │
  ▼
build_runtime(..., model)                            [main.rs L9528]
  │ model = "deepseek-chat"
  ▼
AnthropicRuntimeClient::new(session_id, model, ...)  [main.rs L9660]
  │
  ├─ resolve_model_alias("deepseek-chat")            [mod.rs L202]
  │   = "deepseek-chat"
  │
  └─ detect_provider_kind("deepseek-chat")           [mod.rs L355]
       │
       └─ metadata_for_model("deepseek-chat")        [mod.rs L231]
            ├─ "claude"? NO
            ├─ "grok"? NO
            ├─ "openai/"? / "gpt-"? NO
            ├─ "qwen/"? / "qwen-"? NO
            ├─ "kimi/"? / "kimi-"? NO
            ├─ ⭐ "deepseek/"? / "deepseek-"? YES!
            │  → return ProviderMetadata {
            │      provider: ProviderKind::OpenAi,
            │      auth_env: "OPENAI_API_KEY",
            │      base_url_env: "OPENAI_BASE_URL" }
            └─ return ProviderKind::OpenAi
       │
       ▼
     ProviderClient::from_model_with_anthropic_auth("deepseek-chat", None)
       [client.rs L20]
       │
       ├─ detect_provider_kind("deepseek-chat") = OpenAi
       ├─ OpenAiCompatConfig::openai()
       └─ OpenAiCompatClient::from_env(config)      [openai_compat.rs L117]
            ├─ 读取 OPENAI_API_KEY = "sk-xxxxx"
            ├─ 读取 OPENAI_BASE_URL = "https://api.deepseek.com/v1"
            └─ 返回 ProviderClient::OpenAi(client)
       │
       ▼
     AnthropicRuntimeClient { model: "deepseek-chat", client: OpenAi(...) }
       │
       ▼
     stream() → MessageRequest { model: "deepseek-chat" }  [main.rs L9770]
       │
       ▼
     wire_model_for_base_url("deepseek-chat", ...)        [openai_compat.rs L926]
       │ 没有 '/' → 原样返回 "deepseek-chat" ✅
       │
       ▼
     POST https://api.deepseek.com/v1/chat/completions
     Body: { "model": "deepseek-chat", "messages": [...] }
       │
       ▼
     DeepSeek → deepseek-v4-flash → SSE 流
       │
       ▼
     ← AssistantEvent::TextDelta("你好！")
     ← AssistantEvent::MessageStop
       │
       ▼
     build_assistant_message() → TurnSummary
       │
       ▼
     println!("你好！...")
     终端: ✔ ✨ Done
           你好！有什么我可以帮你的吗？
```

---

<a name="DeepSeek-路由修复详解"></a>

## 4. DeepSeek 路由修复详解

### 修复前的问题链条

修复前，`deepseek-chat` 不能直接使用的原因：

1. **`validate_model_syntax()`** — 要求 provider/model 格式（含 `/`），或已知别名（`opus`/`sonnet`/`haiku`）。`deepseek-chat` 不含 `/` → 被拒
2. **`metadata_for_model()`** — 不认识 `deepseek-` 前缀 → 返回 `None`
3. **`detect_provider_kind()`** — 回退到环境变量嗅探。如果 `ANTHROPIC_API_KEY` 存在 → 路由到 Anthropic
4. **`DEFAULT_MODEL`** — 是 `"openai/deepseek-chat"`，用户必须显式传 `--model`

### 修复 1：validate_model_syntax — 放行 deepseek 裸模型名

**文件**: `rust/crates/rusty-claude-cli/src/main.rs` [L2573-2625]

```rust
fn validate_model_syntax(model: &str) -> Result<(), String> {
    let trimmed = model.trim();
    // 已知别名
    match trimmed {
        "opus" | "sonnet" | "haiku" => return Ok(()),
        _ => {}
    }

    // ⬇⬇⬇ 新增: [L2585-2587] ⬇⬇⬇
    // Known bare DeepSeek models are valid (no provider/ prefix needed).
    if trimmed.starts_with("deepseek-") || trimmed.starts_with("deepseek/") {
        return Ok(());
    }

    // provider/model 格式检查 (含 '/')
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        let mut err_msg = format!("invalid model syntax: '{}'. ...", trimmed);
        // ... 特殊提示 ...
        // ⬇ 新增: deepseek 特殊提示 [L2618-2619]
        } else if trimmed.starts_with("deepseek") {
            err_msg.push_str("\nDeepSeek models can be used without a provider prefix. \
                              Make sure OPENAI_API_KEY and OPENAI_BASE_URL are set.");
        // ⬆
        return Err(err_msg);
    }
    Ok(())
}
```

### 修复 2：DEFAULT_MODEL — 改为 deepseek-chat

**文件**: `rust/crates/rusty-claude-cli/src/main.rs` [L65]

```rust
// old: const DEFAULT_MODEL: &str = "openai/deepseek-chat";
// new:
const DEFAULT_MODEL: &str = "deepseek-chat";
```

效果：所有命令默认使用 DeepSeek，不再需要 `--model`。

### 修复 3：metadata_for_model — 添加 deepseek 前缀路由

**文件**: `rust/crates/api/src/providers/mod.rs` [L291-302]

添加在 `kimi/` 检查之后、`None` 返回之前：

```rust
    // ⬇⬇⬇ 新增 ⬇⬇⬇
    // DeepSeek models via OpenAI-compatible endpoint.
    // Routes deepseek/* and bare deepseek-* model names to the
    // OpenAI-compat client using OPENAI_BASE_URL + OPENAI_API_KEY.
    if canonical.starts_with("deepseek/") || canonical.starts_with("deepseek-") {
        return Some(ProviderMetadata {
            provider: ProviderKind::OpenAi,
            auth_env: "OPENAI_API_KEY",
            base_url_env: "OPENAI_BASE_URL",
            default_base_url: openai_compat::DEFAULT_OPENAI_BASE_URL,
        });
    }
```

为什么放这里：`metadata_for_model()` 按优先级顺序检查前缀。deepseek 作为非 Anthropic 提供者，
放在 `qwen`/`kimi` 同级是合理的。这样 `detect_provider_kind()` 在第 1 步前缀匹配中就能正确路由，
**不会**掉到第 3 步被 `ANTHROPIC_API_KEY` 抢走。

### 修复 4：wire_model_for_base_url — 添加 deepseek 前缀剥离

**文件**: `rust/crates/api/src/providers/openai_compat.rs` [L956-959]

```rust
    // ⬇⬇⬇ 新增 ⬇⬇⬇
    // "deepseek/deepseek-chat" → "deepseek-chat" on the wire.
    if lowered_prefix == "deepseek" {
        return Cow::Borrowed(&model[pos + 1..]);
    }
```

对 `deepseek-chat`（无前缀，当前默认值）来说，`model.find('/')` 返回 `None`，函数第一行就直接返回了：

```rust
    let Some(pos) = model.find('/') else {
        return Cow::Borrowed(model);  // ← "deepseek-chat" 走这里
    };
```

所以修复 4 主要覆盖 `deepseek/deepseek-chat`（显式前缀）的使用场景。

### 修复前后对比

| 维度 | 修复前 | 修复后 |
|---|---|---|
| `DEFAULT_MODEL` | `"openai/deepseek-chat"` | `"deepseek-chat"` |
| `validate_model_syntax("deepseek-chat")` | ❌ 报错 | ✅ 通过 |
| `metadata_for_model("deepseek-chat")` | `None` | `Some(OpenAi)` |
| `claw prompt "hello"` | ❌ 需要 `--model openai/deepseek-chat` | ✅ 默认 DeepSeek |
| `claw --model deepseek-chat prompt "hello"` | ❌ 路由错误 | ✅ 正确路由 |
| `claw --model openai/deepseek-chat prompt "hello"` | ✅ | ✅（兼容） |

---

<a name="怎么读这个代码库"></a>

## 5. 怎么读这个代码库

### 追踪 "model" 字符串的流向

按这个顺序看文件：

```
1. main.rs     L65   const DEFAULT_MODEL      ← 模型名的起点
2. main.rs    L1795  parse_args: let mut model  ← 变量诞生
3. main.rs    L1867  match rest[0] → "prompt"   ← 路由到 CliAction
4. main.rs    L1280  run(): CliAction::Prompt   ← match arm
5. main.rs    L1307  LiveCli::new(model)        ← 传入 LiveCli
6. main.rs    L6018  build_runtime(..., model)  ← 传入 build_runtime
7. main.rs    L9532  AnthropicRuntimeClient::new(..., model)
8. main.rs    L9710  resolve_model_alias(model) ← 别名解析
9. mod.rs     L355   detect_provider_kind(model)← provider 路由 ⭐
10. client.rs L20   from_model_with_anthropic_auth(model)
11. client.rs L35-50 OpenAiCompatClient::from_env(config)
12. openai_compat.rs L117-130 读取环境变量
13. main.rs   L9770  MessageRequest { model }  ← 构建请求
14. openai_compat.rs L926 wire_model_for_base_url  ← 线缆转换 ⭐
15. 实际 HTTP 请求到 https://api.deepseek.com/v1/chat/completions
```

### 决策树速查

用户输入 model 字符串后的完整决策树:

```
model = "deepseek-chat" (或 DEFAULT_MODEL)
  │
  ├─ validate_model_syntax()                     [main.rs L2573]
  │   ├─ 是 "opus"/"sonnet"/"haiku"? → ✅
  │   ├─ starts_with("deepseek-")? → ✅ (修复 1)
  │   ├─ 含 '/' 且 provider/model 格式 → ✅
  │   └─ 否则 → ❌ "invalid model syntax"
  │
  ├─ resolve_model_alias(model)                  [mod.rs L202]
  │   ├─ 在 MODEL_REGISTRY 中? → 返回标准名
  │   └─ 不在 → 原样返回
  │
  ├─ metadata_for_model(model)                   [mod.rs L231]
  │   ├─ "claude-"? → Anthropic
  │   ├─ "grok"? → Xai
  │   ├─ "openai/" / "gpt-"? → OpenAi
  │   ├─ "qwen/" / "qwen-"? → DashScope
  │   ├─ "kimi/" / "kimi-"? → DashScope
  │   ├─ ⭐ "deepseek/" / "deepseek-"? → OpenAi (修复 3)
  │   └─ 都不匹配 → None
  │
  ├─ detect_provider_kind(model)                 [mod.rs L355]
  │   ├─ metadata 有值 → 直接返回 metadata.provider
  │   ├─ OPENAI_BASE_URL + OPENAI_API_KEY → OpenAi
  │   ├─ ANTHROPIC_API_KEY → Anthropic
  │   ├─ OPENAI_API_KEY → OpenAi
  │   ├─ XAI_API_KEY → Xai
  │   └─ 兜底 → Anthropic
  │
  ├─ ProviderClient::from_model_with_anthropic_auth() [client.rs L20]
  │   ├─ Anthropic → AnthropicClient
  │   ├─ Xai → OpenAiCompatClient (xAI config)
  │   └─ OpenAi → OpenAiCompatClient (openai / dashscope config)
  │              ↑ DeepSeek 走到这里！
  │
  └─ OpenAiCompatClient::from_env(config)        [openai_compat.rs L117]
      ├─ 读取 config.api_key_env → OPENAI_API_KEY
      ├─ 读取 config.base_url_env → OPENAI_BASE_URL = https://api.deepseek.com/v1
      └─ 构建 HTTP 客户端（带代理配置）
```

### 怎么快速定位问题

| 症状 | 可能原因 | 检查位置 |
|---|---|---|
| `invalid model syntax` | `validate_model_syntax()` 拒绝 | main.rs L2573 |
| `missing Anthropic credentials` | 模型被路由到 Anthropic | mod.rs L355 `detect_provider_kind()` |
| 请求发到了 api.openai.com | `OPENAI_BASE_URL` 没设 | client.rs L117 `from_env()` |
| WebSearch 超时 | 代理没配 | main.rs L1201 配置引导, tools/lib.rs build_http_client() |
| 模型名带 `openai/` 前缀被 API 拒绝 | `wire_model_for_base_url` 没剥离 | openai_compat.rs L926 |
| `deepseek-chat` 路由到 Anthropic | `metadata_for_model` 不认识 deepseek- 前缀 | mod.rs L231 → L291 (修复 3) |
