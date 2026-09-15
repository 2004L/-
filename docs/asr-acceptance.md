# 语音转文字验收

这套验收脚本不把“模型返回了文字”当作通过，而是同时检查：

- 普通中文转写 CER（字符错误率）；
- 手机号后四位、房间数量等关键字段；
- 单条录音的返回时延；
- ASR 服务不可用、录音缺失或返回错误时是否明确失败。

## 准备样本

把真实录音放入 `fixtures/asr-audio/`。录音使用 WAV、WebM 或服务能解码的格式均可，建议覆盖安静环境、停顿、口音、背景噪声和重复表达。录音内容使用测试身份和测试订单，不要放真实身份证号或完整手机号。

在 `fixtures/asr-cases.jsonl` 中每行写一个样本，路径相对于这个清单文件：

```json
{"id":"order-phone-4821","audio":"asr-audio/order-phone-4821.wav","expected":"我在美团订了房，手机号后四位四八二一","fields":{"phone_last4":"4821"}}
{"id":"walk-in-two-rooms","audio":"asr-audio/walk-in-two-rooms.wav","expected":"我要现场办理入住，两间高级大床房","fields":{"room_count":2}}
```

关键字段必须 100% 正确；普通中文默认 CER 不超过 8%，单条返回默认不超过 5 秒。阈值可以用 `ASR_MAX_CER` 和 `ASR_MAX_LATENCY_MS` 调整，但不能绕过关键字段校验。

## 运行

先启动本地 Qwen ASR WebSocket 服务（默认 `ws://127.0.0.1:8765/asr`），然后运行：

```bash
pnpm test:asr
```

也可以临时指定地址：

```bash
ASR_WS_URL=ws://127.0.0.1:8765/asr pnpm test:asr
```

脚本会在 `reports/asr-accuracy-latest.json` 写入机器可读报告。任何录音缺失、ASR 没启动、关键字段错误或超过阈值，命令都会失败，不能被误判为通过。默认不打印完整转写内容；仅在本机排查时才使用 `--verbose`。
