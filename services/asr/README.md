# 本地 Qwen3-ASR 语音服务

这个服务运行在自助机或局域网内的 3090 主机上。浏览器优先连接它，把短语音片段在本地转成文字；如果服务不可用，前端会自动退回浏览器原生语音识别。

## 启动

建议使用 Python 3.12 的独立环境，并准备好 CUDA、PyTorch 和 `ffmpeg`。在本目录执行：

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python server.py
```

首次启动会下载 `Qwen/Qwen3-ASR-0.6B` 权重。国内网络可以先通过 ModelScope 下载到本地，再把 `QWEN_ASR_MODEL` 指向本地目录。

默认地址是 `ws://127.0.0.1:8765/asr`。在 Hotel Agent OS 首次适配页面填写相同地址；如果网页通过 HTTPS 访问，浏览器通常会阻止不安全的 `ws://`，生产环境应配置 WSS 和可信证书。

## WebSocket 约定

1. 客户端发送 `{"type":"start","language":"Chinese"}`。
2. 客户端发送 WebM/Opus 二进制音频分片。
3. 客户端发送 `{"type":"stop"}`。
4. 服务返回 `{"type":"result","text":"...","language":"...","latency_ms":123}`，失败时返回 `{"type":"error","code":"...","message":"..."}`。

音频只在内存中处理，服务不记录音频、完整手机号或身份证号。模型代码和权重请以 Qwen3-ASR 发布仓库及具体模型卡的许可证为准。
