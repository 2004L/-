# Hotel Agent OS

面向无人酒店自助终端的开源原型。它把语音前台、入住状态机、PMS 适配器和设备/人工协同放在同一条可审计的业务链路中，先用模拟接口跑通体验，再逐步替换为经过授权的真实服务。

> 在线演示：[Hotel Agent OS](https://hotel-agent-os.abloom-toast-5174.chatgpt.site/)

## 当前能体验什么

- 首次打开先填写 PMS 适配器：支持选择供应商、版本、API 地址和临时 API Key 占位符。
- 管理后台可独立维护酒店编码、房型编码、房间号映射，以及读卡器、公安浏览器、支付和发卡机适配器状态，并展示意图审计与四条商业价值线。
- D1 演示数据库预置线上待入住、现场办理、已入住、已取消和“后四位重复”等假订单。
- AI Native 语音终端支持自由表达，演示意图层会把“查预订、现场入住、早餐、停车、押金、退房和房卡进度”等自然语言对齐到受控业务动作；身份和订单匹配仍使用确定性接口，不使用向量近似匹配。
- 正常流程按“订单匹配 → 身份证感应与自动读取 → 身份核验 → 锁房 → 隔离浏览器登记模拟 → PMS 入住确认 → 发卡机自动写卡、回读和吐卡 → 取卡确认”推进，并把状态、设备回执和审计事件写回数据库。
- 重复订单、已入住、已取消和未找到等情况会阻止 AI 擅自放行；未找到时可创建一笔现场演示订单。
- 支付争议、设备故障、退房保洁、公网页面验证码或证书异常，可通过统一事件契约通知对应部门。

当前演示只覆盖“持有效中国居民身份证的成年人正常入住”的交互原型。未成年人、境外客人、特殊证件、证件损坏/不符、复杂账务和真实公安/支付/门锁操作都必须由正式业务系统和人工流程接管。演示以模拟设备回执推进到 `CHECKIN_COMPLETE`；只有接入真实读卡器、门锁编码器和自动发卡机并核验回执后，生产系统才允许声明“房卡已发出”或“客人已入住”。

## 设计边界与安全原则

1. AI 只处理脱敏后的订单状态、短期 token 和业务结果；身份证原始字段应留在门店受控设备和合规存储中，不进入模型上下文。
2. AI 可以解释、排序和发起业务动作，但公安登记、收款、入住确认、退房和发卡等副作用必须由确定的业务程序、权限校验、状态机和幂等键执行；AI 不能直接向发卡机发送任意房号或有效期。
3. 公安浏览器通过门店端 Worker/受控浏览器会话接入，验证码、证书异常和页面改版均暂停并通知人工，不绕过安全校验。
4. 真实 API Key、SSH 私钥、身份证数据和支付凭据禁止提交到 Git；本仓库只保留占位符和模拟响应。

## 系统结构

```text
语音终端 / 管理后台
          │
          ▼
业务 API、D1 与入住状态机（checkin_case_id）
    ┌─────┼──────────┬──────────┐
    ▼     ▼          ▼          ▼
  PMS   自动读卡器  支付适配器  门锁编码器 / 自动发卡机
          │
          └─ 门店设备 Worker ─ 受控公安浏览器会话
```

广州、珠海等门店应使用独立的浏览器会话、任务队列、权限边界和本地身份数据区。AI 通过高层接口调用服务，不直接操作原始证件字段或设备驱动。

## 本地运行

要求 Node.js `>=22.13.0`、pnpm。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

首次启动 D1 本地环境前，先生成并应用迁移；随后打开本地地址，按引导完成适配器配置：

```bash
pnpm db:generate
pnpm build
pnpm start
```

提交前可运行：

```bash
pnpm lint
pnpm build
pnpm test:cases
pnpm test:contracts
pnpm test:replay
pnpm test:concurrency
pnpm test:invariants
```

## 第一阶段仿真器验收

管理后台的“设备与公安仿真器故障开关”可以注入读卡器超时/离线、发卡机离线/回读不一致、公安验证码/维护/回执丢失等情况。每个外部动作都生成唯一命令和幂等键；结果未知时不会自动重复登记或发卡，而是创建人工任务。详细字段和调用示例见 [`docs/simulator-contracts.md`](docs/simulator-contracts.md)。

`pnpm test:replay` 会在本地隔离的假数据模型上顺序重放 `fixtures/cases.jsonl` 的 13 个场景，并检查终态、room_count、幂等审计数量和人工接管事件；该命令不访问真实 PMS、公安系统或硬件。

`pnpm test:concurrency` 验证乐观锁下同一房间并发请求的一成功一 `409`，以及幂等重试只生成一条命令和审计。`pnpm test:invariants` 检查数据库约束、身份状态门禁、审计钩子和脱敏规则；这些检查会在 GitHub Actions 中自动执行。

## PMS 适配器配置

首期以 QloApps `1.6.1` 作为接口形态参考；适配器设计为可替换，后续可接入其他 PMS。配置示例中的密钥是**临时占位符**，不能用于生产：

```env
PMS_PROVIDER=qloapps
PMS_VERSION=1.6.1
PMS_BASE_URL=https://pms.example.local/api
PMS_API_KEY=TEMP_PMS_API_KEY_REPLACE_ME
```

## 大模型测试配置

系统支持 OpenAI 兼容的 Chat Completions 接口。当前只在运行环境配置了 `LLM_ENABLED=true` 时调用大模型；没有密钥或调用失败时自动退回本地规则路由，不会让入住流程失控。

```env
LLM_ENABLED=true
LLM_BASE_URL=https://tokenhub.tencentmaas.com/v1
LLM_MODEL=hy3
LLM_MAX_TOKENS=700
LLM_API_KEY=TEMP_LLM_API_KEY_REPLACE_ME
```

`LLM_API_KEY` 只能放在本地环境变量或托管平台密钥管理中，不能写进源码、README、GitHub Issue 或聊天记录。你刚才贴出的 Key 已经暴露，建议先撤销并重新生成，再用新 Key 做测试。官方 OpenAI 快速入门也建议把 API Key 放到环境变量中，而不是写在代码里。[Developer quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)

## 本地开源语音输入

语音终端现在优先连接本地 Qwen3-ASR-0.6B WebSocket 服务，识别音频留在门店设备或局域网的 3090 主机上；本地服务未启动、浏览器阻止连接或识别失败时，自动退回浏览器原生语音识别。Qwen3-ASR 官方发布 0.6B/1.7B 模型，支持中文、粤语和多种方言，代码与权重仓库采用 Apache License 2.0，但分发时仍需保留许可证和版权说明。[官方仓库](https://github.com/QwenLM/Qwen3-ASR)

```text
自助机麦克风 → 本地 Qwen3-ASR WebSocket → 脱敏文字 → /api/agent/turn → 受控业务工具
                         └─ 不可用时 → 浏览器原生语音识别备用
```

本地服务的安装和消息约定见 [`services/asr/README.md`](services/asr/README.md)。在线托管站不能直接运行 3090 模型；部署到自助机时，在首次适配页面填写本地 ASR WebSocket 地址。HTTPS 页面应使用 WSS 和可信证书，避免浏览器拦截不安全的 `ws://` 连接。服务不记录音频、完整手机号或身份证号。

酒店、房型和房间编码仅作演示，建议在管理后台按实际 PMS 主数据映射，例如：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| 酒店编码 | `GZ-HAOS-001` | 门店唯一编码 |
| 房型编码 | `DLX-KING` | PMS 中的房型编码 |
| 房间号 | `GZ-HAOS-001-1208` | 房型与实体房间映射 |

## 首期 PMS 接口契约

演示路由位于 `app/api/pms/[operation]/route.ts`，当前返回模拟数据，不会写入真实 PMS。手机号识别的业务主键匹配由 D1 精确查询完成，向量检索只能用于自然语言帮助、房型描述等非身份场景。

| 能力 | 方法与路径 | 用途 |
| --- | --- | --- |
| 订单查询 | `GET /api/pms/orders?phone=...` | 按手机号优先匹配订单 |
| 房态查询 | `GET /api/pms/rooms` | 获取可售房间与房态 |
| 锁房 | `POST /api/pms/hold` | 幂等锁定候选房间 |
| 入住确认 | `POST /api/pms/checkin` | 核验完成后确认入住 |
| 退房 | `POST /api/pms/checkout` | 关闭订单并触发保洁任务 |

真实接入时，每个请求都应带 `checkin_case_id`、幂等键、操作者/服务身份和审计信息，并校验 PMS 回执后才能推进下一状态。

## 数据库演示与验收号码

`app/api/demo/[action]/route.ts` 提供按会话隔离的假数据、自然语言意图模拟、精确匹配、状态转移、浏览器任务和审计接口。`interpret` 会返回意图、置信度和下一业务动作，并将脱敏记录写入审计表。首次打开会自动写入假订单；管理后台可以恢复初始数据。

| 手机后四位 | 场景 | 预期结果 |
| --- | --- | --- |
| `4821` | 美团待入住 | 完整跑通自动读卡、登记、入住确认和自动发卡模拟 |
| `6395` | 抖音团购待入住 | 完整跑通 |
| `9053` | 现场待入住 | 完整跑通 |
| `1188` | 两笔待入住订单 | AI 停止自动选择，要求人工复核 |
| `7366` | 已入住订单 | 拦截重复办理 |
| `4402` | 已取消订单 | 拦截继续办理 |
| 其他四位 | 无订单 | 可创建现场演示订单后继续 |

所有姓名、手机号、订单号、身份 token、登记回执和设备回执均为演示数据。`browser-start` 与 `browser-complete` 只驱动隔离的模拟任务；`identity-detected`、`keycard-start`、`keycard-complete` 和 `pickup-confirmed` 只模拟设备适配器，不连接真实公安、身份证读卡器、门锁或发卡机。

## 异常与人工协同

统一事件至少包含 `case_id`、`department`、`task_type`、`priority`、脱敏 `payload_token`、`reason` 和 `source`。示例：

```json
{
  "case_id": "CI-20260913-0087",
  "department": "工程部",
  "task_type": "door_lock_fault",
  "priority": "high",
  "payload_token": "opaque_token",
  "reason": "门锁写卡失败",
  "source": "ai_orchestrator"
}
```

支付争议和复杂账务通知财务/客服；房态或退房通知前台/保洁；门锁、读卡器和发卡机故障通知工程；公安验证码、维护或证书异常通知前台与安全岗。AI 负责识别、解释和派单，不能自行改价、绕过登记或随意发卡。

## 目录速览

- `app/page.tsx`：语音终端、适配器首次配置和管理后台界面。
- `app/api/pms/[operation]/route.ts`：PMS 模拟 API。
- `app/api/demo/[action]/route.ts`：数据库演示 API、状态机与审计入口。
- `app/api/agent/turn`、`lib/tools.ts`：AI Native 意图路由与工具契约；模型只产生受控 `tool_call`，订单和硬件动作由业务接口/仿真器执行。
- `app/api/device/reader`、`app/api/device/encoder`、`app/api/police/submit`：第一阶段的外部系统仿真器，支持故障注入与人工接管。
- `app/api/simulator/faults`：管理后台使用的故障开关；故障会落到命令、人工任务和审计记录。
- `db/schema.ts`：D1/SQLite 表结构；`drizzle/` 保存追加式迁移。
- `lib/contracts.ts`、`lib/simulator.ts`：统一命令契约、幂等处理和仿真器公共逻辑。
- `fixtures/cases.jsonl`：可重放验收场景清单。
- `docs/pms-integration.md`：PMS 适配与真实接入注意事项。
- `docs/hardware-integration.md`：身份证读卡器、门锁编码器和自动发卡机的接口、安全状态机与验收要求。
- `docs/model-resource-benchmark.md`：大模型、语音、RAG、GPU 与完整入住压测量化方案。
- `services/asr/`：本地 Qwen3-ASR-0.6B WebSocket 语音识别服务及启动说明。
- `docs/ai-native-value-framework.md`：AI Native 意图层、动作安全边界与收益、人力、响应、合规四条价值线。
- `.openai/hosting.json`：当前在线演示站点的项目绑定和存储配置，不包含业务 API Key；迁移托管平台后才能连同相关构建配置一起删除。
- `components/`：可复用 UI 组件。
- `scripts/`：本地开发与构建脚本。

## 安全检查

首次克隆后启用仓库自带的提交前钩子：

```bash
pnpm hooks:install
```

之后每次提交都会检查暂存文件的空白错误、敏感文件名、私钥/Token 特征和身份证号码，并运行 ESLint。也可以手动运行：

```bash
pnpm security:secrets
pnpm security:check
```

GitHub Actions 会在推送、Pull Request 和手动触发时运行 Gitleaks，扫描完整 Git 历史，并执行同一套代码检查。`TEMP_PMS_API_KEY_REPLACE_ME` 是唯一允许的演示占位符；真实密钥必须存入受控的密钥管理服务或 GitHub Secrets，不能写进源码、文档或提交历史。

发现漏洞或疑似密钥泄漏时，请遵循 [安全策略](SECURITY.md)，不要在公开 Issue 中粘贴证件信息、支付数据或有效凭据。

## 路线图

1. 为 D1 状态转移补齐更严格的并发事务、失败重试和自动化接口测试。
2. 在门店 Windows 节点部署读卡器、门锁编码器/自动发卡机 Worker 和受控公安浏览器 Worker，完成自动读卡、写卡回读、吐卡及取卡传感器验收。
3. 以测试账号接入真实 PMS，完成订单、房态、锁房、入住、退房的回执与重试验证。
4. 接入合规的支付、消息通知和保洁工单接口，补齐 RBAC、密钥托管、告警和灾备。
5. 完成公安、支付、个人信息保护及门店上线前的合规评审。

## 贡献与许可证

欢迎通过 Issue 或 Pull Request 提交适配器、测试和文档改进。本项目采用 [Apache License 2.0](LICENSE)，允许使用、修改、分发和商业化，但必须遵守许可证中的版权、声明和专利条款。第三方依赖仍分别适用其自身许可证。
