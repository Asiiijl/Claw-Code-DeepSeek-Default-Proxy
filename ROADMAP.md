# Agent 语义链执行引擎 — 路线图

> 我们不再构建"更好的 Agent"，我们要构建** Agent 的执行器（executor）**。
>
> 这不是一个增量改进。这是一次架构级别的范式转换。

---

## 核心理念

### 问题

现在的 Agent 架构（Claw-Code、Zed Agent、几乎所有 LLM Agent 框架）是**线性对话**的：

```
用户输入 → 构造 Prompt → LLM 推理 → 工具调用 → 返回结果 → 下一轮
```

每一个 Agent 实例都是：
- **状态与执行耦合** — 一个线程 = 一个会话 = 一个 LLM 调用循环
- **上下文高度冗余** — 每个 Prompt 都携带完整的消息历史，但大部分是重复的
- **并行困难** — 多个 Agent 各自拥有独立的上下文，无法共享缓存、无法智能分配任务
- **缓存浪费** — 每次 LLM 调用，prefix caching 命中率低，因为每条消息链都不同

### 解决方案：语义链块（Semantic Chain Block）

我们引入**中央服务器（Chain Server）**，所有 Agent 上下文、工具调用被拆解为**语义链块（SCB）**：

```
              ┌─────────────────────────────────────┐
              │            Chain Server              │
              │                                      │
              │  ┌──────┐ ┌──────┐ ┌──────┐         │
              │  │ SCB  │ │ SCB  │ │ SCB  │  ...    │  ← 语义链块池
              │  │ #1   │ │ #2   │ │ #3   │         │
              │  └──────┘ └──────┘ └──────┘         │
              │                                      │
              │  调度器：每次挑选最短、满足要求的链块  │
              │                                      │
              └──────────┬───────────────┬───────────┘
                         │               │
                         ▼               ▼
                 ┌────────────┐   ┌────────────┐
                 │ Executor 1 │   │ Executor 2 │  ...  ← 无状态执行器
                 │ (线程/进程)│   │ (线程/进程)│
                 └────────────┘   └────────────┘
```

#### 语义链块（SCB）是什么

一个 SCB 是一段**自包含的、带语义标签的执行单元**：

```json
{
  "id": "scb_abc123",
  "type": "tool_call | user_message | agent_response | system_prompt",
  "semantic_hash": "sha256 of canonical content",
  "dependencies": ["scb_xyz789"],
  "content": { ... },
  "token_cost": 142,
  "cache_key": "prefix-cache-key-for-this-block",
  "created_at": "...",
  "expires_at": "..."
}
```

SCB 的关键特性：
- **不可变** — 创建后内容不变，通过 `semantic_hash` 唯一标识
- **可缓存** — 相同的 SCB 在不同执行上下文中共享缓存命中
- **可组合** — 多个 SCB 可以被拼接成一个执行链
- **可调度** — 调度器根据任务要求选择最短的 SCB 链

---

## 架构

### 1. Chain Server（中央服务器）

```
chain-server/
├── scb_store/          # SCB 存储（SQLite + content-addressed cache）
│   ├── insert_scb()
│   ├── query_scb(hash | tags | time_range)
│   └── prune_expired()
├── scheduler/          # 调度器
│   ├── plan_task(task_spec) → [SCB IDs]
│   │   # 给定任务规格，找出最短的、满足要求的 SCB 链
│   ├── select_executor(scb_chain) → ExecutorID
│   │   # 选择合适的执行器（考虑负载/缓存亲和性/延迟）
│   └── dispatch(executor, scb_chain)
├── executor_pool/      # 执行器管理
│   ├── register(executor)
│   ├── heartbeat(timeout)
│   └── detect_dead()
├── cache_coordinator/  # 跨执行器缓存协调
│   ├── track_cache_key(scb_hash, executor_id)
│   └── advise_prefetch(executor_id, [scb_hashes])
├── observer/           # 可观测性
│   ├── trace_scb_chain(chain_id, executor_id)
│   ├── collect_metrics()
│   └── emit_events()
└── api/                # gRPC / HTTP API
    ├── SubmitTask(task_spec) → TaskID
    ├── GetResult(task_id) → Result
    ├── WatchChain(chain_id) → Event Stream
    └── Admin()
```

### 2. Executor（无状态执行器）

Executor 是**纯粹的 LLM 调用执行器**，没有任何会话状态：

```
executor/
├── llm_client/         # LLM 调用封装
│   ├── build_prompt(scb_chain) → Prompt
│   │   # 将 SCB 链组装成给 LLM 的 Prompt
│   ├── call_llm(prompt, cache_config) → Response
│   └── parse_response(response) → New SCBs
├── tool_runner/        # 工具执行
│   ├── run_tool(tool_call_scb) → ToolResult SCB
│   └── validate_tool_result()
├── cache/              # 本地缓存
│   └── prefix_cache    # 从 Chain Server 获取的缓存提示
└── reporter/           # 结果报告
    └── emit_scbs(new_scbs) → Chain Server
```

### 3. 调度算法

核心算法：**给定任务规格，找出最短的、满足要求的 SCB 链**

```
Input:  TaskSpec { required_capabilities, context_tags, max_tokens, max_latency }
Output: [SCB IDs] — 最短可行链

Algorithm:
1. 从 SCB 池中筛选满足 required_capabilities 的候选块
2. 构建依赖图（DAG）
3. 从依赖根节点开始 BFS，收集所有可达路径
4. 对每条路径计算：
   a. 总 token 成本（已知 SCB token_cost + 未知执行估计）
   b. prefix cache 命中率估计（基于 cache_key 在 executor 上的分布）
   c. 预期延迟
5. 选择满足 max_tokens/max_latency 约束的、总成本最低的路径
6. 如果没有任何路径满足要求 → 调用 LLM 生成新的 SCB
```

#### 缓存优先策略

调度器优先选择**能在已缓存 prefix 上执行**的 SCB 链：

```
Executor A: 缓存了 [system_prompt_scb, tool_def_scb, user_msg_scb_1]
Executor B: 缓存了 [system_prompt_scb, tool_def_scb, user_msg_scb_2]

新任务：需要 [system_prompt, tool_def, user_msg_1, user_msg_3]

→ 调度到 Executor A（prefix cache 命中率更高）
→ 只需要为 user_msg_3 支付新的 KV cache 成本
```

---

## 项目结构

```
chain-server/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── scb_store/
│   │   ├── mod.rs
│   │   ├── schema.rs
│   │   ├── insert.rs
│   │   └── query.rs
│   ├── scheduler/
│   │   ├── mod.rs
│   │   ├── planner.rs      # DAG 构建 + 路径搜索
│   │   ├── cost_model.rs   # token/延迟成本估计
│   │   └── dispatcher.rs   # 执行器选择
│   ├── executor_pool/
│   │   ├── mod.rs
│   │   └── pool.rs
│   ├── cache_coordinator/
│   │   ├── mod.rs
│   │   └── coordinator.rs
│   ├── observer/
│   │   ├── mod.rs
│   │   ├── tracing.rs
│   │   └── metrics.rs
│   └── api/
│       ├── mod.rs
│       ├── grpc.rs
│       └── http.rs

executor/
├── Cargo.toml
└── src/
    ├── main.rs
    ├── llm_client.rs
    ├── tool_runner.rs
    ├── cache.rs
    └── reporter.rs

sdk/                    # 客户端 SDK（集成到 Claw-Code / Zed Agent）
├── python/
├── rust/
└── typescript/
```

---

## 里程碑

### Phase 0：奠基（当前 → 2周）

- [ ] 定义 SCB 数据格式和序列化协议（protobuf 或 flatbuffers）
- [ ] 实现 `scb_store` 基本 CRUD（SQLite + content-addressed storage）
- [ ] 实现 `semantic_hash` 算法（规范化 + SHA256）
- [ ] 编写 SCB 兼容性测试套件

### Phase 1：Chain Server 核心（2周 → 6周）

- [ ] 实现 `scheduler/planner` — DAG 构建 + 拓扑排序 + 最短路径搜索
- [ ] 实现 `scheduler/cost_model` — token 成本 + cache 命中率 + 延迟估计
- [ ] 实现 `scheduler/dispatcher` — 执行器注册 + 选择 + 派发
- [ ] 实现 `executor_pool` — 心跳 + 死检测 + 自动扩缩
- [ ] 实现基础 gRPC API — `SubmitTask` / `GetResult` / `WatchChain`

### Phase 2：Executor（6周 → 10周）

- [ ] 实现 `llm_client` — 将 SCB 链组装为 Prompt + 调用 LLM + 解析 SCB
- [ ] 实现 `tool_runner` — 安全沙箱 + 工具执行 + 结果封装为 SCB
- [ ] 实现 `cache` — executor 端 prefix cache 管理
- [ ] 实现 `reporter` — 将新 SCB 写回 Chain Server

### Phase 3：缓存协调（10周 → 14周）

- [ ] `cache_coordinator` — 跟踪每个 executor 的缓存状态
- [ ] 缓存亲和性调度 — 调度到缓存命中率最高的 executor
- [ ] 预缓存提示 — 在派发前向 executor 推送可能需要的 SCB
- [ ] 缓存逐出策略 — LRU / LFU / semantic-aware

### Phase 4：集成（14周 → 18周）

- [ ] Rust SDK — 使 Claw-Code 和 Zed Agent 能提交任务到 Chain Server
- [ ] Claw-Code 集成 — 将 Agent 调用转为链块提交
- [ ] Zed Agent 集成 — 将工具调用转为链块提交
- [ ] 混合模式 — 保留本地执行能力，链块为可选加速

### Phase 5：高级调度（18周 → 24周）

- [ ] 语义去重 — 检测语义等价的 SCB 并合并
- [ ] 前瞻规划 — 根据历史模式预测下一步需要的 SCB
- [ ] 多目标优化 — Pareto frontier（成本 × 延迟 × 质量）
- [ ] 回退/恢复 — executor 崩溃时自动重调度

### Phase 6：可观测性与工具（24周 → 30周）

- [ ] Web UI — Chain Server 可视化仪表板
- [ ] 链追踪 — 端到端的 SCB 链执行追踪
- [ ] 成本分析 — 每个 SCB / 每次执行的 token 成本报告
- [ ] 缓存报告 — 命中率 / 节省的 token 数 / 优化建议

---

## 设计原则

1. **SCB 是不可变的** — 一旦创建，内容永不改变。这保证了可缓存性、可重放性、可验证性。
2. **Executor 是无状态的** — 所有状态在 Chain Server 中。Executor 可以随时销毁和重建。
3. **调度是可解释的** — 每次调度决策都要有日志，写明"为什么选这个链"和"为什么选这个 executor"。
4. **缓存是第一公民** — Prefix cache 不是事后优化，是调度算法的核心输入。
5. **渐进式采用** — Claw-Code 和 Zed Agent 可以先在现有架构上运行，链块作为可选加速层。
6. **失败是预期的** — Executor 崩溃、LLM 超时、网络分区——都是正常事件，系统必须优雅降级。

---

## 与 Claw-Code 的关系

Claw-Code 将成为链块架构的**第一个生产消费者**：

- Claw-Code 的子代理功能（`claw subagent spawn`）自然映射到 Chain Server 的任务提交
- 现有的会话文件（`~/.claw/sessions/`）可以作为 SCB 的历史数据源
- 非阻塞通知机制（文件通知 + HTTP callback）可以与 Chain Server 的 `WatchChain` API 统一
- `claw subagent batch` 命令可以成为 `SubmitTask` 的 CLI 封装

## 与 Zed Agent 的关系

Zed Agent 将成为链块架构的**本地执行端点**：

- 每个 Zed 实例可以作为一个 Executor 注册到 Chain Server
- 现有的 `ToolCallEventStream` 审批流程与调度无关——执行器无此概念
- 现有的 `spawn_agent` 工具可以远程提交任务到 Chain Server
- 多窗口/多实例 Zed 可以通过 Chain Server 共享缓存和执行结果

---

> "We are not building a better agent. We are building the executor of agents."
