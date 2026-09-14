# Hotel Agent OS

面向无人酒店自助终端的开源原型。它把语音前台、入住状态机、PMS 适配器和设备/人工协同放在同一条可审计的业务链路中，先用模拟接口跑通体验，再逐步替换为经过授权的真实服务。

> 在线演示：[Hotel Agent OS](https://hotel-agent-os.abloom-toast-5174.chatgpt.site/)

## 当前能体验什么

- 首次打开先填写 PMS 适配器：支持选择供应商、版本、API 地址和临时 API Key 占位符。
- 管理后台可独立维护酒店编码、房型编码、房间号映射，以及读卡器、公安浏览器、支付和发卡机适配器状态。
- 语音终端模拟“欢迎 → 读取身份证 → 身份核验 → 订单匹配 → 公安登记 → 支付/选房 → 制作房卡 → 取卡”的入住流程。
- 每一步都有状态、接口回执、时间线和风险提示；读卡器重复放置、上一位客人未取证件、房态异常等情况会转人工队列。
- 支付争议、设备故障、退房保洁、公网页面验证码或证书异常，可通过统一事件契约通知对应部门。

当前演示只覆盖“持有效中国居民身份证的成年人正常入住”。未成年人、境外客人、特殊证件、证件损坏/不符、复杂账务和真实公安/支付/门锁操作都必须由正式业务系统和人工流程接管。

## 设计边界与安全原则

1. AI 只处理脱敏后的订单状态、短期 token 和业务结果；身份证原始字段应留在门店受控设备和合规存储中，不进入模型上下文。
2. AI 可以解释、排序和发起业务动作，但公安登记、收款、入住确认、退房和发卡等副作用必须由确定的业务程序、权限校验和幂等键执行。
3. 公安浏览器通过门店端 Worker/受控浏览器会话接入，验证码、证书异常和页面改版均暂停并通知人工，不绕过安全校验。
4. 真实 API Key、SSH 私钥、身份证数据和支付凭据禁止提交到 Git；本仓库只保留占位符和模拟响应。

## 系统结构

```text
语音终端 / 管理后台
          │
          ▼
业务 API 与入住状态机（checkin_case_id）
    ┌─────┼──────────┬──────────┐
    ▼     ▼          ▼          ▼
  PMS   读卡器     支付适配器  发卡机
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

打开本地地址后，按引导完成适配器配置，再进入管理后台或语音终端。提交前可运行：

```bash
pnpm lint
pnpm build
```

## PMS 适配器配置

首期以 QloApps `1.6.1` 作为接口形态参考；适配器设计为可替换，后续可接入其他 PMS。配置示例中的密钥是**临时占位符**，不能用于生产：

```env
PMS_PROVIDER=qloapps
PMS_VERSION=1.6.1
PMS_BASE_URL=https://pms.example.local/api
PMS_API_KEY=TEMP_PMS_API_KEY_REPLACE_ME
```

酒店、房型和房间编码仅作演示，建议在管理后台按实际 PMS 主数据映射，例如：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| 酒店编码 | `GZ-HAOS-001` | 门店唯一编码 |
| 房型编码 | `DLX-KING` | PMS 中的房型编码 |
| 房间号 | `GZ-HAOS-001-1208` | 房型与实体房间映射 |

## 首期 PMS 接口契约

演示路由位于 `app/api/pms/[operation]/route.ts`，当前返回模拟数据，不会写入真实 PMS。

| 能力 | 方法与路径 | 用途 |
| --- | --- | --- |
| 订单查询 | `GET /api/pms/orders?phone=...` | 按手机号优先匹配订单 |
| 房态查询 | `GET /api/pms/rooms` | 获取可售房间与房态 |
| 锁房 | `POST /api/pms/hold` | 幂等锁定候选房间 |
| 入住确认 | `POST /api/pms/checkin` | 核验完成后确认入住 |
| 退房 | `POST /api/pms/checkout` | 关闭订单并触发保洁任务 |

真实接入时，每个请求都应带 `checkin_case_id`、幂等键、操作者/服务身份和审计信息，并校验 PMS 回执后才能推进下一状态。

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
- `docs/pms-integration.md`：PMS 适配与真实接入注意事项。
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

1. 用 PostgreSQL 持久化 `checkin_cases`、状态转移和审计事件。
2. 在门店 Windows 节点部署读卡器/发卡机 Worker 和受控公安浏览器 Worker。
3. 以测试账号接入真实 PMS，完成订单、房态、锁房、入住、退房的回执与重试验证。
4. 接入合规的支付、消息通知和保洁工单接口，补齐 RBAC、密钥托管、告警和灾备。
5. 完成公安、支付、个人信息保护及门店上线前的合规评审。

## 贡献与许可证

欢迎通过 Issue 或 Pull Request 提交适配器、测试和文档改进。本项目采用 [Apache License 2.0](LICENSE)，允许使用、修改、分发和商业化，但必须遵守许可证中的版权、声明和专利条款。第三方依赖仍分别适用其自身许可证。
