# 第一阶段研发启动：MCP 工具网关

## 当前交付

第一批 MCP Server 采用本地 `stdio` 传输，只开放只读工具：

- `hotel.integration_status`
- `pms.ping`
- `police.command_status`
- `device.reader_status`
- `device.encoder_status`

MCP Server 不直接连接数据库、公安网页或设备 SDK。它通过 Hotel Agent OS 的只读 API 查询状态，并在每个请求中携带固定的租户和酒店作用域。

## 启动配置

```text
MCP_API_BASE_URL=http://127.0.0.1:8787
MCP_TENANT_ID=tenant-demo
MCP_HOTEL_ID=hotel-gz-demo
MCP_ACCESS_TOKEN=<通过本地密钥管理注入>
# 酒店 API 服务端必须配置同值的 MCP_SERVICE_TOKEN
```

启动命令：

```bash
pnpm mcp:stdio
```

`MCP_ACCESS_TOKEN` 不得写入代码、配置示例、Git 或聊天记录。读模型接口会校验 Bearer Token、租户和酒店请求头，并写入 `mcp_audit_events`。

## 安全边界

1. 第一批工具全部标记为只读、幂等、非破坏性。
2. 公安工具只能查询已有命令，不能提交或重放登记。
3. 设备工具只能查询已有命令，不能读新证件、写卡或吐卡。
4. MCP 工具结果携带 `tenant_id`、`hotel_id` 和观察时间。
5. 命令编号经过格式校验并进行 URL 编码。
6. MCP Server 只通过 GET 调用 Hotel Agent OS。

## 外部依赖并行清单

| 依赖 | 开工所需材料 | 当前处理 |
| --- | --- | --- |
| 公安旅业系统 | 属地系统、版本、允许的接入方式、测试账号、字段和回执规范 | 保留仿真器和 `PoliceAdapter` 边界 |
| PMS | 厂商、版本、测试地址、鉴权、订单/房态/入住接口、Webhook | 保留 `PmsAdapter`，当前使用模拟模式 |
| 门锁与发卡机 | 厂商、型号、SDK、测试设备、卡型和回执定义 | 保留 Windows Worker 和命令状态机 |
| 身份证读卡器 | 厂商、型号、SDK、驱动和测试设备 | 原始字段只留门店身份区 |

## 下一批研发

1. 接入真实 PMS、公安、门锁的正式适配器。
2. 为 MCP 调用建立独立服务身份和短期凭据轮换。
3. 将只读订单、房态、任务和工作流查询收口成门店作用域 API。
4. 实现 `prepare -> confirm -> execute -> receipt`，再开放低风险写工具。
5. 公安提交、发卡、退款和远程开门始终保持专用工作流，不直接映射为无确认 MCP 写操作。
