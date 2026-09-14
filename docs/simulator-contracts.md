# 设备与公安仿真器契约

本阶段用“契约 + 仿真器”把真实读卡器、发卡机和公安浏览器隔离开。前端和状态机只依赖下面的请求/响应结构，未来接入真设备时只替换适配器实现。

## 统一请求

三个外部动作都必须带 `session_id`、`case_id`、`idempotency_key`、`expected_state` 和 `device_id`。服务端只保存脱敏请求与短期 token，不保存完整身份证号或原始证件照片。

## 接口

| 接口 | 正常操作 | 典型故障 |
| --- | --- | --- |
| `POST /api/device/reader` | `read_identity`，返回 `identity_token` | `reader_timeout`、`reader_offline`、`duplicate_read`、`identity_mismatch` |
| `POST /api/device/encoder` | `issue_keycard`，写卡后回读、吐卡 | `encoder_offline`、`write_failed`、`readback_mismatch`、`output_jammed`、`card_not_collected` |
| `POST /api/police/submit` | `submit_registration`，返回登记回执 | `captcha_required`、`system_maintenance`、`certificate_error`、`submission_rejected`、`receipt_lost` |

每个接口还有 `GET .../:command_id` 状态查询。响应状态统一为 `RUNNING`、`SUCCEEDED`、`FAILED`、`UNKNOWN` 或 `MANUAL_REQUIRED`。`UNKNOWN` 代表不能确认结果，禁止 AI 自动重试造成重复登记或重复发卡。

## 故障开关

管理后台调用 `POST /api/simulator/faults` 注入一次性或多次故障，`GET` 查看，`DELETE /api/simulator/faults/:fault_id` 停用，`POST /api/simulator/reset` 恢复正常。故障命中后会写入 `external_commands`、`manual_tasks` 和 `audit_events`，前端可以据此显示人工接管。

当前入住演示已经接线：读卡器命令在“检测到身份证”后执行，公安登记命令在“房间锁定”后执行，发卡机命令在“PMS 入住确认、准备写卡”阶段执行。仿真命令只返回演示 token 和状态，不会接触真实证件、公安或门锁数据。

## 验收

`fixtures/cases.jsonl` 是可重放场景清单，运行 `pnpm test:cases` 检查场景完整性，运行 `pnpm test:contracts` 检查接口表面。当前是第一阶段的契约验收；下一阶段再把这些 fixture 接到本地 D1 启动器，做真实请求重放和并发 409 验证。
