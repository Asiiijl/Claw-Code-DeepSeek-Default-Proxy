# Claw Code 模型路由机制 — 为什么需要 `openai/` 前缀

## 问题陈述

调用 DeepSeek API 时必须使用 `openai/deepseek-chat` 作为模型名，而不能直接用 `deepseek-chat`。这看起来不直观，
原因是 claw-code 上游的**路由架构决策**所致，而非 DeepSeek 本身的限制。

---

## 路由架构概览

```
用户输入模型名 "openai/deepseek-chat"
    │
    ▼
┌─────────────────────────────────────────────────┐
│ parse_args()                                    │
│  main.rs                                         │
│  判断：model == DEFAULT_MODEL → 自动检测          │
│  否则：使用 --model 传入的值                       │
│  输出：模型字符串传递到 CliAction                   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ detect_provider_kind(model)                     │
│  api/src/providers/mod.rs                        │
│  路由选择器 — 返回 ProviderKind                   │
│  • "openai/..." → OpenAi                        │
│  • "gpt-..."    → OpenAi                        │
│  • "claude-..." → Anthropic                     │
│  • "grok..."    → Xai                           │
│  • "qwen..."    → OpenAi (DashScope)            │
│  • "kimi..."    → OpenAi (DashScope)            │
│  • 其他 → 根据环境变量嗅探                          │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ wire_model_for_base_url(model, base_url)         │
│  api/src/providers/openai_compat.rs              │
│  线缆模型名转换 — 决定实际发送到 API 的模型名字符串  │
│  • 如果 base_url 包含 "deepseek" → 剥离 openai/   │
│    发送 "deepseek-chat" 而非 "openai/deepseek-chat"│
│  • 其他自定义 base_url → 保留前缀 (OpenRouter)    │
│  • 默认 OpenAI → 剥离前缀                         │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
            DeepSeek API ← 收到 "deepseek-chat" ✅
```

---

## 为什么必须用 `openai/` 前缀

### 核心原因：路由优先于认证嗅探

`detect_provider_kind()` 在 `api/src/providers/mod.rs:343` 的实现逻辑是：

```rust
pub fn detect_provider_kind(model: &str) -> ProviderKind {
    // 1. 先检查 model 前缀匹配
    if let Some(metadata) = metadata_for_model(model) {
        return metadata.provider;    // ← 这里路由到对应 provider
    }
    // 2. 嗅探 OPENAI_BASE_URL + OPENAI_API_KEY
    if std::env::var_os("OPENAI_BASE_URL").is_some()
       && openai_compat::has_api_key("OPENAI_API_KEY") {
        return ProviderKind::OpenAi;
    }
    // 3. 嗅探 ANTHROPIC_API_KEY
    if anthropic::has_auth_from_env_or_saved().unwrap_or(false) {
        return ProviderKind::Anthropic;  // ← 如果 ANTHROPIC_API_KEY 存在，会走到这里！
    }
    // 4. 最后兜底
    ProviderKind::Anthropic
}
```

**关键问题**：`metadata_for_model()` 只识别以特定前缀开头的模型名：
- `claude-` → Anthropic
- `openai/` → OpenAi
- `gpt-` → OpenAi
- `grok` → Xai
- `qwen/` → OpenAi (DashScope)
- `kimi/` → OpenAi (DashScope)

**`deepseek-chat` 不符合任何前缀规则**，所以 `metadata_for_model("deepseek-chat")` 返回 `None`。
然后 `detect_provider_kind` 回退到环境变量嗅探 —— 如果环境中有 `ANTHROPIC_API_KEY`，
请求会被错误地路由到 Anthropic 而不是 DeepSeek。

### 为什么不能简单地加一个 `deepseek-` 前缀规则

可以在 `metadata_for_model()` 中加 `canonical.starts_with("deepseek-")`，
但上游架构中每个路由前缀都对应一个**固定的 provider 配置**（auth_env + base_url_env + default_base_url）：

```rust
if canonical.starts_with("openai/") || canonical.starts_with("gpt-") {
    return Some(ProviderMetadata {
        provider: ProviderKind::OpenAi,
        auth_env: "OPENAI_API_KEY",          // ← 固定
        base_url_env: "OPENAI_BASE_URL",      // ← 固定
        default_base_url: "https://api.openai.com/v1", // ← 固定
    });
}
```

DeepSeek 需要 `OPENAI_API_KEY` + `OPENAI_BASE_URL = https://api.deepseek.com/v1`。
默认的 `base_url_env` 是 `OPENAI_BASE_URL`，这确实对 DeepSeek 来说是相同的 env var。
所以理论上可以加，但需要考虑优先级冲突（比如同时设了 `OPENAI_API_KEY` 和 `ANTHROPIC_API_KEY` 时）。

---

## 涉及的代码文件

| 文件 | 职责 |
|---|---|
| `rust/crates/api/src/providers/mod.rs` | `metadata_for_model()` (L249-310), `detect_provider_kind()` (L343-381) |
| `rust/crates/api/src/providers/openai_compat.rs` | `wire_model_for_base_url()` (L926-955) — 线缆级模型名转换 |
| `rust/crates/rusty-claude-cli/src/main.rs` | `detect_subagent_model_from_env()` (L306-327), `DEFAULT_MODEL` (L61), `parse_args()` 中的 subagent 分支 (L1057-1095) |
| `rust/crates/api/src/http_client.rs` | `ProxyConfig::from_env()` — 代理配置读取（与路由无关但影响网络连通性） |

---

## 修复方案 A（推荐）

让 `deepseek-` 开头的模型名自动路由到 OpenAi provider。按上游 prefix 规则走 `metadata_for_model`。

### 步骤 1：在 `metadata_for_model()` 中添加 deepseek 路由

编辑 `api/src/providers/mod.rs`，在 `canonical.starts_with("kimi/")` 块之后添加：

```rust
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

### 步骤 2：在 `wire_model_for_base_url()` 中添加 deepseek 前缀剥离

编辑 `api/src/providers/openai_compat.rs`，在 `if lowered_prefix == "openai"` 分支后添加：

```rust
    // "deepseek/deepseek-chat" → "deepseek-chat"
    if lowered_prefix == "deepseek" {
        return Cow::Borrowed(&model[pos + 1..]);
    }
```

### 步骤 3：更新 `DEFAULT_MODEL`

```rust
const DEFAULT_MODEL: &str = "deepseek-chat";
```

### 结果

修复后以下都能工作：
```bash
claw prompt "hello"                          # DEFAULT_MODEL = deepseek-chat ✅
claw --model deepseek-chat prompt "hello"    # 规范方式 ✅
claw --model deepseek/deepseek-chat prompt "hello"  # 显式前缀 ✅
claw --model openai/deepseek-chat prompt "hello"    # 向后兼容 ✅
```

---

## 修复方案 B（最小改动，5 行）

仅修改 `detect_provider_kind()`，在 `metadata_for_model` 检查之后添加：

```rust
pub fn detect_provider_kind(model: &str) -> ProviderKind {
    if let Some(metadata) = metadata_for_model(model) {
        return metadata.provider;
    }
    // DeepSeek models → OpenAI-compatible provider
    let canonical = model.trim().to_ascii_lowercase();
    if canonical.starts_with("deepseek") {
        return ProviderKind::OpenAi;
    }
    // ... existing auth-sniffer ...
}
```

然后改 `DEFAULT_MODEL`：
```rust
const DEFAULT_MODEL: &str = "deepseek-chat";
```

---

## 方案对比

| 维度 | 方案 A（推荐） | 方案 B（最小改动） |
|---|---|---|
| 改动行数 | ~20 行 | ~5 行 |
| 支持调用方式 | `deepseek-chat`、`deepseek/deepseek-chat`、`openai/deepseek-chat` | 仅 `deepseek-chat` |
| 与上游架构一致 | ✅ 按 prefix 规则走 `metadata_for_model` | ❌ 绕过 metadata 层 |
| 风险 | 低 | 低 |

---

## 控制台提示：调用失败时给出正确方法

在 `rusty-claude-cli/src/main.rs` 的 `run()` 函数中，当 `CliAction::Prompt` 返回错误时检测 DeepSeek 相关失败：

```rust
// 在 run() 中，匹配 Prompt 分支的地方
CliAction::Prompt { model, prompt, .. } => {
    let result = run_prompt_impl(model, prompt, ...);
    if let Err(ref e) = result {
        let msg = e.to_string();
        let is_deepseek = model.to_ascii_lowercase().contains("deepseek");
        let is_routing_err = msg.contains("missing Anthropic credentials")
            || msg.contains("401")
            || msg.contains("unauthorized");

        if is_deepseek && is_routing_err {
            eprintln!(
                "💡 DeepSeek 调用失败。检查环境变量：\n\
                 OPENAI_API_KEY=sk-...\n\
                 OPENAI_BASE_URL=https://api.deepseek.com/v1\n\
                 （不需要 ANTHROPIC_API_KEY）"
            );
        }
    }
    result
}
```

或者在 `detect_subagent_model_from_env()` 中也加一个调试日志：
```rust
fn detect_subagent_model_from_env() -> String {
    let has_openai_base = ...;
    let has_openai_key = ...;
    if has_openai_base && has_openai_key {
        let model = "deepseek-chat";
        eprintln!("🦀 自动检测到 DeepSeek: --model {model}");
        return String::from(model);
    }
    // ...
}
```

---

## 当前 fork 中的状态

在 `CCChisato/Claw-Code-DeepSeek-Default-Proxy` 中，当前代码：

- `DEFAULT_MODEL` = `"openai/deepseek-chat"` — 所有命令默认走 DeepSeek
- `wire_model_for_base_url()` 检测到 `deepseek` 在 base URL 中时，自动剥离 `openai/` 前缀
- 如果 `ANTHROPIC_API_KEY` 存在且没有 `OPENAI_API_KEY`，`detect_provider_kind()` 仍然会路由到 Anthropic
- `metadata_for_model()` 中没有 `deepseek-` 前缀规则，所以 `deepseek-chat`（不带 `openai/`）绕过了前缀路由层

**这就是为什么当前必须使用 `openai/deepseek-chat` 而不是 `deepseek-chat`**。