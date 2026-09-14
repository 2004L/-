# Hotel Agent OS 自动读卡与发卡机接入方案

## 1. 目标

正常入住不安排现场人员操作。客人只需完成语音确认并把身份证放入读卡器，系统随后自动完成读取、核验、住宿登记、PMS 入住确认、房卡写入和吐卡。设备异常时流程安全停止，并通知远程维护人员。

当前网页演示使用模拟设备回执。生产接入必须替换为门店设备 Worker 和厂商 SDK，且只有收到硬件回执后才能推进状态。

## 2. 一体化流程

```text
订单匹配
  ↓
身份证放置传感器触发
  ↓
遗留证件、重复事件、会话归属检查
  ↓
自动读取身份证并完成人证核验
  ↓
PMS 查询房态并锁房
  ↓
公安浏览器登记并取得回执
  ↓
PMS 确认入住
  ↓
发卡机取空白卡 → 门锁编码器写卡 → 回读校验 → 吐卡
  ↓
取卡口与身份证读卡器传感器确认均已清空
  ↓
入住完成
```

从身份证传感器确认新证件放入开始，正常流程不再要求客人点击，也不需要工作人员现场发卡。

## 3. 状态机

| 状态 | 进入条件 | 允许的下一状态 |
| --- | --- | --- |
| `ORDER_MATCHED` | 唯一订单已确认 | `IDENTITY_READING` |
| `IDENTITY_READING` | 新读卡事件通过遗留与重复检查 | `IDENTITY_VERIFIED` |
| `IDENTITY_VERIFIED` | 证件读取和核验成功 | `ROOM_HELD` |
| `ROOM_HELD` | PMS 返回有效锁房回执 | `POLICE_RUNNING` |
| `POLICE_RUNNING` | 登记任务已启动 | `POLICE_COMPLETED` |
| `POLICE_COMPLETED` | 登记成功且回执可校验 | `PMS_CHECKIN_CONFIRMED` |
| `PMS_CHECKIN_CONFIRMED` | PMS 确认入住成功 | `KEYCARD_WRITING` |
| `KEYCARD_WRITING` | 发卡机已锁定唯一空白卡 | `KEYCARD_DISPENSED` |
| `KEYCARD_DISPENSED` | 写卡回读一致且出卡口检测到卡 | `CHECKIN_COMPLETE` |
| `CHECKIN_COMPLETE` | 身份证和房卡均被取走 | 终态 |

任何请求都必须携带 `case_id`、设备编号、请求幂等键和期望状态。当前状态不匹配时拒绝执行，避免重复入住和重复发卡。

## 4. 身份证读卡器适配器

建议由门店 Windows Worker 封装厂商 SDK，并只向业务服务返回脱敏结果和短期身份 Token。

### 4.1 设备事件

```json
{
  "event_id": "DEMO_READER_EVENT_ID",
  "device_id": "ID_READER_01",
  "case_id": "DEMO_CASE_ID",
  "event": "card_present",
  "card_fingerprint": "ONE_TIME_HASH",
  "observed_at": "2026-09-14T10:00:00+08:00"
}
```

### 4.2 必须检查

- 新证件指纹不得与上一办理会话未取走的证件相同；
- 读卡事件必须发生在当前订单确认之后，并绑定当前 `case_id`；
- 连续抖动事件去重，同一证件只创建一次读取任务；
- 完整身份证字段和照片不进入 AI、通用日志或 RAG；
- 证件损坏、读取失败、人与证件不符或读卡器离线时停止流程并派单。

## 5. 自动发卡机适配器

发卡必须由确定性业务服务执行。AI 只能请求“为已确认入住的办理单发卡”，不能直接指定任意房间、金额、门锁权限或卡片有效期。

### 5.1 发卡请求

```json
{
  "case_id": "DEMO_CASE_ID",
  "idempotency_key": "issue_card:DEMO_CASE_ID:1",
  "device_id": "CARD_DISPENSER_01",
  "pms_receipt": "DEMO_PMS_RECEIPT",
  "police_receipt": "DEMO_POLICE_RECEIPT",
  "room_number": "1208",
  "valid_from": "2026-09-14T14:00:00+08:00",
  "valid_until": "2026-09-15T12:00:00+08:00"
}
```

生产服务必须自行从可信数据库重新读取房间和有效期，不能直接信任 AI 或前端传入的值。

### 5.2 发卡成功回执

```json
{
  "case_id": "DEMO_CASE_ID",
  "device_id": "CARD_DISPENSER_01",
  "command_id": "DEMO_COMMAND_ID",
  "result": "dispensed",
  "card_slot": 3,
  "write_verified": true,
  "output_sensor": "card_present",
  "completed_at": "2026-09-14T10:00:08+08:00"
}
```

系统必须同时满足写入成功、回读一致、卡片已到达取卡口三个条件，才能进入 `KEYCARD_DISPENSED`。

## 6. 故障处理

| 故障 | 自动动作 | 最终处理 |
| --- | --- | --- |
| 身份证疑似遗留 | 不读取、不推进 | 语音提醒取证并通知远程值守 |
| 读卡失败 | 最多重试两次 | 停止流程并派工程工单 |
| 发卡机缺卡或离线 | 不确认发卡 | 切换备用机；无备用机则派单 |
| 写卡或回读失败 | 废卡进入回收仓，最多重试一次 | 再失败则停止并派单 |
| 卡槽堵塞 | 禁止重复吐卡 | 设备锁定并派工程工单 |
| 取卡超时 | 循环语音提醒，不办理下一位 | 超时后锁定终端并通知远程值守 |
| PMS、登记回执缺失 | 禁止开始写卡 | 回滚锁房或转人工复核 |

自动重试必须使用同一幂等键。任何无法确认执行结果的超时都按“未知”处理，先查询设备命令状态，不能直接再次发卡。

## 7. 生产验收标准

- 连续完成 100 次正常自动入住，重复发卡为 0；
- 断网、断电和服务重启后，所有进行中命令可按 `command_id` 恢复或确认；
- 写卡回读不一致时不能吐卡；
- 公安登记或 PMS 入住确认失败时不能写卡；
- 身份证未取走时不能开始下一位办理；
- 缺卡、堵卡、设备离线和取卡超时均能在 10 秒内产生远程告警；
- 审计日志能关联订单、办理单、设备命令、登记回执和 PMS 回执，但不记录完整身份证信息。
