# 管理后台账号与演示数据库统计

更新时间：2026-09-16

本文档只统计当前 Hotel Agent OS 演示系统内置的演示账号、角色权限和演示数据库结构。这里不记录任何 API Key、SSH 私钥、生产 PMS 密钥、公安账号或真实住客完整身份信息。

## 1. 管理后台登录入口

- 入口：站点右上角「管理后台」
- 会话有效期：8 小时
- 空闲超时：30 分钟
- 登录后能力：查看后台数据、配置仿真故障、使用管理员 AI 工具、对敏感动作进行弹窗确认

## 2. 演示账号清单

演示环境最多创建 4 个角色账号。**代码中不再内置默认口令**：只有在配置了口令来源时才会创建账号。

```text
ADMIN_DEMO_PASSWORD=<共享口令>            # 四个账号共用同一口令
ADMIN_DEMO_PASSWORD_OWNER=<逐角色口令>     # 可选，优先于共享口令
ADMIN_DEMO_PASSWORD_MANAGER=<逐角色口令>
ADMIN_DEMO_PASSWORD_FRONTDESK=<逐角色口令>
ADMIN_DEMO_PASSWORD_HOUSEKEEPING=<逐角色口令>
```

- 未配置任何口令来源时：不创建演示账号，并打印显式告警。
- 生产环境（`NODE_ENV`/`ENVIRONMENT=production`）默认关闭演示账号；如需强制开启须显式设置 `ADMIN_DEMO_ENABLED=true`。
- 每个账号使用**独立盐**与独立 PBKDF2 哈希；历史版本共用一个盐的账号会在检测到后自动轮换（需要配置上述口令之一）。

> 生产部署必须使用密钥管理器注入口令，并保持 `ADMIN_DEMO_ENABLED=false`。

| 账号 | 口令来源 | 显示身份 | 角色 | 主要权限 |
| --- | --- | --- | --- | --- |
| `owner` | `ADMIN_DEMO_PASSWORD_OWNER` 或 `ADMIN_DEMO_PASSWORD` | 老板/所有者 | `owner` | 全部权限：查订单、查房态、换房、入住、退房、改金额、退款、设备控制、用户管理、配置管理、故障管理 |
| `manager` | `ADMIN_DEMO_PASSWORD_MANAGER` 或 `ADMIN_DEMO_PASSWORD` | 店长 | `manager` | 查订单、查房态、换房、入住、退房、改金额、退款、设备控制、故障管理 |
| `frontdesk` | `ADMIN_DEMO_PASSWORD_FRONTDESK` 或 `ADMIN_DEMO_PASSWORD` | 前台 | `frontdesk` | 查订单、查房态、换房、入住、退房 |
| `housekeeping` | `ADMIN_DEMO_PASSWORD_HOUSEKEEPING` 或 `ADMIN_DEMO_PASSWORD` | 客房 | `housekeeping` | 查房态 |

## 3. 权限策略统计

系统当前定义 4 类角色、11 项管理员权限、11 个管理员工具。

### 角色数量

| 类型 | 数量 |
| --- | ---: |
| 管理员角色 | 4 |
| 管理员权限 | 11 |
| 管理员工具 | 11 |

### 管理员工具

| 工具名 | 用途 | 是否直接改库 |
| --- | --- | --- |
| `admin.search_guest` | 查询客人/订单 | 否 |
| `admin.get_room_status` | 查询房态 | 否 |
| `admin.prepare_room_change` | 生成换房确认单 | 否 |
| `admin.prepare_amount_adjustment` | 生成金额修改确认单 | 否 |
| `admin.prepare_keycard_issue` | 生成发卡确认单 | 否 |
| `admin.prepare_police_submission` | 生成公安提交确认单 | 否 |
| `admin.confirm_pending_action` | 确认后执行待确认动作 | 是，受权限和弹窗确认保护 |
| `admin.confirm_room_change` | 兼容旧换房确认工具 | 是，受权限和弹窗确认保护 |
| `admin.cancel_pending_action` | 取消待确认动作 | 否 |
| `admin.cancel_room_change` | 兼容旧换房取消工具 | 否 |
| `admin.get_audit_records` | 查询审计记录 | 否 |

## 4. 演示订单种子数据统计

每个浏览器会话第一次打开时会写入 8 笔演示订单。

### 按订单状态统计

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `awaiting_arrival` | 6 | 待入住，可进入入住流程 |
| `in_house` | 1 | 已入住，不能重复办理入住 |
| `cancelled` | 1 | 已取消，不能继续办理 |
| 合计 | 8 | 每个演示会话独立隔离 |

### 按来源统计

| 来源 | 数量 |
| --- | ---: |
| 美团 | 3 |
| 携程 | 2 |
| 抖音团购 | 1 |
| 酒店官网 | 1 |
| 现场办理 | 1 |

### 按房型统计

| 房型 | 数量 |
| --- | ---: |
| 高级大床房 | 4 |
| 豪华双床房 | 2 |
| 标准大床房 | 2 |

### 关键测试尾号

| 手机尾号 | 设计用途 | 预期结果 |
| --- | --- | --- |
| `4821` | 正常平台订单 | 匹配 1 笔美团待入住订单 |
| `6395` | 多晚平台订单 | 匹配 1 笔抖音团购待入住订单 |
| `2178` | 官网订单 | 匹配 1 笔官网待入住订单 |
| `9053` | 现场办理订单 | 匹配 1 笔现场待入住订单 |
| `1188` | 尾号撞号 | 命中 2 笔待入住订单，必须转人工选择 |
| `7366` | 已入住订单 | 拒绝重复办理 |
| `4402` | 已取消订单 | 拒绝继续办理 |

## 5. 现场办理房型报价配置

现场办理流程当前内置 3 个可选房型。

| 房型编码 | 房型 | 房费/晚 | 押金 | 演示可用数量 |
| --- | --- | ---: | ---: | ---: |
| `STD-KING` | 标准大床房 | 260 | 200 | 3 |
| `DLX-KING` | 高级大床房 | 380 | 300 | 2 |
| `DLX-TWIN` | 豪华双床房 | 420 | 300 | 1 |

## 6. 数据库表统计

当前演示系统定义 15 张核心表。

| 表名 | 用途 | 是否存敏感信息 |
| --- | --- | --- |
| `demo_sessions` | 浏览器演示会话隔离 | 否 |
| `demo_orders` | 演示订单、来源、房型、脱敏手机号、状态 | 仅手机号后四位和掩码 |
| `checkin_cases` | 入住状态机实例 | 否 |
| `browser_jobs` | 公安浏览器仿真任务 | 否 |
| `audit_events` | 顾客端业务审计事件 | 不应记录完整手机号/身份证 |
| `external_commands` | 读卡器、发卡机、公安等外部命令幂等记录 | 不应记录完整身份证 |
| `simulator_faults` | 故障注入配置 | 否 |
| `manual_tasks` | 人工接管任务 | 否 |
| `walk_in_drafts` | 现场办理草稿 | 保存手机号后四位、掩码、不可逆 token |
| `walk_in_payments` | 现场办理模拟支付记录 | 否 |
| `admin_users` | 管理员账号与密码哈希 | 保存密码哈希，不保存明文 |
| `admin_sessions` | 管理员会话 token 哈希 | 保存 token 哈希，不保存明文 |
| `admin_audit_events` | 管理员操作审计 | 不应记录完整手机号/身份证 |
| `admin_actions` | 管理员待确认动作 | 保存脱敏业务变更摘要 |
| `ai_request_metrics` | AI 请求延迟和 token 统计 | 否 |

## 7. 安全边界

1. AI 不直接写数据库。
2. AI 只能输出工具调用意图。
3. 工具层负责校验参数、权限、状态机和幂等。
4. 涉及金额、房间、公安、发卡等敏感动作时，必须先生成确认单。
5. 管理员点击确认前，不会修改 PMS、金额、公安或房卡设备。
6. 日志和数据库只允许出现脱敏手机号，不允许写入完整身份证号。
7. 生产环境必须关闭演示账号或替换为正式账号体系。
