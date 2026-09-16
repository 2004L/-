# 生产就绪与验收说明

本阶段继续使用设备与公安仿真器，真实读卡器、发卡机和公安浏览器不纳入自动化压测范围。所有外部动作仍由工具契约和状态机执行，模型不能直接写数据库。

## 已落地的生产护栏

- 管理员密码使用 PBKDF2-SHA-256 存储；旧版 SHA-256 账号在成功登录后自动升级。
- 管理员会话同时受 8 小时绝对过期和 30 分钟空闲过期约束，登录失败在 15 分钟内达到 20 次会限流。
- `/api/health` 提供数据库、模型配置和请求延迟检查；不会返回 API Key。
- `/api/admin/metrics` 仅管理员可读，展示最近 100 次模型请求的成功/回退/错误和延迟统计，不记录完整手机号、身份证号或模型密钥。
- `/api/agent/turn` 为每次请求生成或接收安全的 `X-Request-ID`，记录延迟和结果类型，指标写入失败不会阻断入住流程。
- `pnpm test:hardening` 默认只跑本地并发与幂等模型；只有显式设置 `TARGET_BASE_URL` 才会对指定环境的 `/api/health` 做 HTTP 压测。

## 发布前配置

生产环境至少设置：

```text
ADMIN_DEMO_ENABLED=false
ADMIN_DEMO_PASSWORD=<通过密钥管理器注入的强密码>
LLM_ENABLED=true
LLM_API_KEY=<通过部署平台密钥管理器注入>
LLM_BASE_URL=<已审核的 OpenAI 兼容地址>
LLM_MODEL=hy3
```

不要把 `.env*`、私钥、证书私钥、完整手机号、身份证号或支付凭证提交到仓库。提交前运行 `pnpm security:check`，CI 还应运行 `pnpm test:cases`、`pnpm test:invariants`、`pnpm test:concurrency` 和 `pnpm test:hardening`。

## 压力与故障验收

故障注入仍通过后台开关控制，必须覆盖读卡超时、重复读卡、发卡机离线、公安验证码、回执丢失和订单/身份不一致。每个故障都要有人工接管任务、审计事件和可重放用例。真实设备接入后只替换实现，不修改契约和状态机。
