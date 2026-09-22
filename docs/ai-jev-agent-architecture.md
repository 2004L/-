# AI-Jev Agent 架构方案

版本：v0.1　编制日期：2026-09-22

## 1. 定位

AI-Jev 是 Hotel Agent OS 的通用酒店业务 Agent。它负责理解自然语言、补齐必要信息、生成业务计划、选择受控工具并解释结果；它不负责成为业务事实、权限边界或设备执行器。

核心原则：

1. **Jev 只提出决策，业务服务决定是否执行。** 模型不能直写数据库、账务、房态、公安登记或设备。
2. **每次行动都必须有上下文、策略判断、工具回执和可回放记录。**
3. **确定性规则优先于模型猜测。** 涉及身份、金额、房号、支付、退房、发卡和公安登记时，缺字段就澄清，冲突就暂停。
4. **先采用单 Agent + 技能模块。** 不在第一版拆成多个互相调用的 Agent，避免状态、权限和责任链分散。

## 2. 总体架构

```text
客人终端 / 员工后台 / 定时事件
              │
              ▼
        Jev 接入层
  session、酒店、入口、角色、trace
              │
              ▼
      服务端上下文编排器
  会话状态 │ 业务事实 │ 知识 │ 历史步骤
              │
              ▼
        AI-Jev 模型适配器
  system prompt + JSON Schema + tool calling
              │
              ▼
       输出校验与计划编译器
  结构化解析 │ 关键字段比对 │ 意图封装
              │
              ▼
        策略 / 风险 / 权限门
      直接回答 / 澄清 / 待确认 / 执行
              │
              ▼
          Tool Gateway
  Zod 校验 │ 入口工具集 │ 幂等键 │ 审计
              │
              ▼
       Workflow Engine 工作流
   workflow_runs / workflow_steps
     暂停、恢复、重试、人工接管
              │
              ▼
        确定性领域服务与连接器
  订单  房态  入住  账务  支付  设备  PMS
              │
              └──────────────┐
                             ▼
               工具回执 / 指标 / AI 决策回放
        ai_workflows / ai_intents / ai_plans
        ai_tool_calls / policy_decisions
```

## 3. Jev 的职责边界

| Jev 可以做 | Jev 不可以做 |
| --- | --- |
| 识别入住、退房、查询、服务和异常意图 | 直接访问 D1/SQLite 或读取整库 |
| 根据当前状态提出下一步 | 自行改变订单、房态、账务或入住状态 |
| 调用知识库回答酒店政策 | 自行编造政策、价格、余额或回执 |
| 生成线性多步计划 | 绕过工作流步骤或跳过前置条件 |
| 发起受控工具调用 | 自己调用设备 SDK、公安页面或 PMS 页面 |
| 解释工具结果和失败原因 | 把“已提交/未知”说成“已成功” |
| 发现需要人工介入的情况 | 代替员工完成高风险确认 |

模型输出永远是 `AssistantMessage`、`Clarification` 或 `ToolProposal` 三者之一；`ToolProposal` 只是建议，只有 Tool Gateway 执行成功后才是业务动作。

## 4. 一次请求的运行链路

### 4.1 输入

Jev 不直接接收浏览器传来的完整历史作为事实来源。请求应至少包含：

```ts
type JevAgentRequest = {
  request_id: string;
  tenant_id: string;
  hotel_id: string;
  entry_point: "IDENTITY" | "CREDENTIAL" | "STAFF" | "EVENT";
  session_id?: string;
  conversation_id?: string;
  actor: { type: "guest" | "admin" | "system"; id?: string; role?: string };
  subject?: { type: string; id: string };
  utterance: string;
  workflow_id?: string;
};
```

服务端根据 `session_id`、`hotel_id` 和 `entry_point` 组装上下文，前端提交的订单号、案件号和角色不能单独作为授权依据。

### 4.2 推理与执行

1. **会话门禁**：验证会话是否有效、是否属于当前酒店、身份核验等级是否足够。
2. **上下文组装**：读取当前会话允许的订单、房态、工作流步骤、知识片段和最近回执；先脱敏，再交给模型。
3. **Jev 推理**：只允许输出结构化消息或已登记工具；模型温度建议为 0，工具参数使用 JSON Schema。
4. **确定性复核**：用规则路由和关键字段提取结果与模型结果比对。手机号、金额、房号、日期等冲突时返回澄清，不执行。
5. **策略决策**：按入口、角色、酒店政策和风险等级判断 `allow`、`confirm`、`clarify`、`handoff` 或 `deny`。
6. **工具执行**：Tool Gateway 再次做 Zod 校验、权限校验、状态前置条件校验和幂等处理。
7. **工作流推进**：需要跨步骤的动作进入 `workflow_runs` / `workflow_steps`；外部命令未知时进入等待查询或人工接管，不盲目重试。
8. **回执绑定**：把真实执行结果写回 `ai_tool_calls`，更新工作流，再由 Jev 生成面向客人或员工的解释。
9. **完整记录**：持久化“表达 → 意图 → 计划 → 策略 → 工具 → 回执”，敏感信息只留脱敏摘要。

## 5. 技能组织

第一版使用一个 Jev 主 Agent，按入口加载技能，而不是让技能之间互相调用：

| 技能 | 允许的主要工具 | 典型场景 |
| --- | --- | --- |
| `guest.checkin` | 查询预订、身份读取、报价、支付、登记、发卡 | 预订入住、现场入住 |
| `guest.checkout` | 查询在住、退房报价、结算、退房 | 房卡入口退房 |
| `guest.policy` | 知识库检索、政策问答 | 早餐、停车、押金、退房政策 |
| `staff.operations` | 查房态、在住客人、客房服务、人工任务 | 前台和店长运营 |
| `staff.housekeeping` | 客房服务、报修、清洁状态 | 房务工作台 |
| `system.recovery` | 查询工作流、查询外部命令、创建人工接管 | 超时、未知回执、恢复任务 |

入口只加载所需工具子集：房卡入口不得调用建单工具，客人入口不得调用管理员级清理或数据浏览工具，系统事件入口不得伪装成客人执行敏感动作。

后续当评测数据和权限边界稳定后，再将 `staff.operations`、`staff.housekeeping` 等拆成独立专用 Agent；拆分后仍必须共享同一个 Tool Gateway、Policy Engine 和 Workflow Engine。

## 6. 结构化输出契约

```ts
type JevDecision =
  | {
      type: "assistant_message";
      message: string;
      citations?: Array<{ source_id: string; title: string }>;
    }
  | {
      type: "clarification";
      intent: string;
      missing_fields: string[];
      question: string;
      requires_confirmation?: boolean;
    }
  | {
      type: "tool_proposal";
      plan_id: string;
      tool_call_id: string;
      tool_name: string;
      arguments: Record<string, unknown>;
      expected_preconditions: string[];
      user_visible_summary: string;
    };
```

不接受模型返回的任意 SQL、JavaScript、URL、设备指令或未登记工具名。工具名必须映射到 `lib/tools.ts` 或对应的管理员工具注册表，参数必须通过 schema 校验。

## 7. 风险分级与人工确认

| 风险 | 默认处理 | 示例 |
| --- | --- | --- |
| `none` | 直接回答 | 一般说明、知识库命中 |
| `low` | 只读工具可自动执行 | 查房态、查订单候选 |
| `medium` | 补字段或单次确认 | 现场入住草稿、客房服务请求 |
| `high` | 明确确认 + 领域服务执行 | 支付、退房、改房、发卡、登记 |
| `critical` | 必须人工接管或双人审批 | 金额调整、退款争议、公安异常、未知回执 |

风险门的判断不由模型自报，至少由以下因素共同决定：工具风险登记、当前入口、管理员角色、酒店政策版本、业务状态和是否存在未知回执。

## 8. 代码落点

当前代码可以按以下方式演进：

| 架构部件 | 当前落点 | AI-Jev 接入动作 |
| --- | --- | --- |
| 模型适配器 | `lib/llm.ts` | 增加 `AI_JEV_MODEL` / provider 配置，保留 OpenAI-compatible 适配层 |
| 请求入口 | `app/api/agent/turn/route.ts` | 抽出 Jev runtime，统一 guest、staff、event 三类入口 |
| 工具注册 | `lib/tools.ts`、`lib/admin-tools.ts` | 增加 entry point、风险等级、前置条件和幂等键元数据 |
| 意图安全封装 | `lib/intent-envelope.ts` | 将模型输出统一转换为 intent / entities / risk / next_action |
| 工作流执行 | `lib/workflow-engine.ts` | 承载多步计划、暂停、恢复、重试和人工接管 |
| 决策审计 | `lib/ai-control.ts` | 保存 Jev 的模型版本、技能、prompt 版本、计划和真实回执 |
| 业务执行 | `lib/*-core.ts`、`services/` | 保持确定性；Jev 只能通过服务方法或工具网关进入 |

建议新增以下模块：

```text
lib/jev/
  runtime.ts          // 单次 turn 的主编排
  context.ts          // 服务端上下文构建与脱敏
  decision-schema.ts  // JevDecision schema
  policy-gate.ts      // 风险、权限、确认和入口限制
  skill-registry.ts   // 技能与工具子集
  model-adapter.ts    // AI-Jev provider 适配
  replay.ts           // 决策链回放与调试
```

## 9. 第一阶段实现顺序

### J0：模型适配与契约（约 2—3 天）

- 确认 AI-Jev 是否兼容 OpenAI Chat Completions / tool calling。
- 增加模型配置、超时、最大 token、重试和模型版本记录。
- 把当前 `streamModel` 的自由文本结果收敛为 `JevDecision`。
- 为未知工具、坏参数、空响应和模型超时保留规则回退。

出口：AI-Jev 不可用时入住和查询仍能走规则路径；任何模型输出都通过 schema。

### J1：单 Agent + 工具网关（约 1 周）

- 统一 guest / staff 两个入口的 Jev runtime。
- 服务端组装上下文，禁止前端历史直接充当权威事实。
- 工具注册表增加入口、风险、权限、前置条件和幂等键。
- 所有工具调用写入 `ai_tool_calls`，执行结果绑定真实回执。

出口：每次行动均能回答“谁在什么会话中、根据什么事实、调用了什么工具、结果是什么”。

### J2：工作流化多步执行（约 2 周）

- 线性多步计划写入 `ai_plans` 与 `workflow_runs`。
- 支持暂停、恢复、重试、补偿和人工接管。
- 把支付、退房、发卡、公安登记等外部命令纳入统一状态机。

出口：断网或服务重启后可继续；未知回执不会被模型说成成功。

### J3：技能评测与灰度（约 1 周）

- 建立入住、退房、政策、房务、异常恢复五组评测集。
- 测试关键字段冲突、越权工具、提示注入、重复执行和敏感信息泄漏。
- 先影子运行，再开放低风险只读工具，最后逐项开放写工具。

出口：高风险越权为 0；真实业务写操作全部有确认、权限、幂等和回执。

## 10. 关键指标

- 工具参数 schema 通过率 ≥ 99%。
- 关键字段冲突时自动执行次数为 0。
- 未确认的高风险写操作次数为 0。
- 重复支付、重复入住、重复发卡和重复公安提交次数为 0。
- 未知回执被错误展示为成功次数为 0。
- AI 决策链完整率 100%。
- 模型不可用时规则回退成功率可观测，且不影响核心入住状态机。

## 11. 最终结论

AI-Jev 最适合成为 Hotel Agent OS 的“认知中枢”：理解人话、规划动作、选择技能、解释结果；酒店系统的“事实中枢”仍由正式业务表和领域服务承担，“执行中枢”由工作流和 Tool Gateway 承担。

第一版的架构选择是：**一个 Jev 主 Agent、多个受控技能、一个统一工具网关、一个统一工作流引擎、一个完整决策审计链**。这能直接复用当前项目资产，也为后续多 Agent、PMS 接入和真实设备接入保留边界。
