# 本地 Qwen3-ASR 语音服务

这个服务运行在自助机或局域网内的 GPU 主机上。浏览器优先连接它，把短语音片段在本地转成文字；如果服务不可用，前端会自动退回浏览器原生语音识别。3060 6GB 建议保持 `ASR_CONCURRENCY=1`。

## 启动

建议使用 Python 3.12 的独立环境，并准备好 CUDA 和 PyTorch。服务会优先使用系统 `ffmpeg`，没有时自动使用 `imageio-ffmpeg` 内置版本。在本目录执行：

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python server.py
```

如果运行环境安装在 D 盘，可以使用：

```powershell
D:\AI-Hotel-Models\asr-venv\Scripts\python.exe server.py
```

首次启动会下载 `Qwen/Qwen3-ASR-0.6B` 权重。建议把缓存或本地目录放在 `D:\AI-Hotel-Models\qwen3-asr-0.6b`，再把 `QWEN_ASR_MODEL` 指向该目录。国内网络可以先通过 ModelScope 下载到本地。

默认地址是 `wss://127.0.0.1:8765/asr`。如果只在本地 HTTP 页面测试，可填写 `ws://127.0.0.1:8765/asr`；正式网页使用 HTTPS 时必须使用 WSS，并配置浏览器信任的本地证书（`ASR_TLS_CERT`、`ASR_TLS_KEY`）。可同时设置 `ASR_ALLOWED_ORIGIN` 和 `ASR_AUTH_TOKEN`，限制来源并完成设备配对，避免其他网页调用本地语音服务。

### HTTPS 网页的正式配置

生产网页使用 HTTPS 时，不能依赖普通 `ws://`。在项目目录执行下面两步，证书和私钥会写入 D 盘，不会进入 Git：

```powershell
D:\AI-Hotel-Models\asr-venv\Scripts\python.exe services\asr\generate-local-cert.py --output-dir D:\AI-Hotel-Models\asr-certs
certutil.exe -user -addstore Root D:\AI-Hotel-Models\asr-certs\asr-local-ca.pem
```

然后使用 `services\asr\start-on-d.ps1` 启动。脚本会自动启用 WSS，并限制来源为 Hotel Agent OS 网页。证书私钥 `asr-local-key.pem` 只留在本机，禁止上传、复制到前端或提交到仓库。若更换电脑，需要在新电脑重新生成并信任证书。

## WebSocket 约定

1. 客户端发送 `{"type":"start","language":"Chinese"}`。
2. 客户端发送 WebM/Opus 二进制音频分片。
3. 客户端等待所有音频分片发送完成后发送 `{"type":"stop"}`。
4. 服务返回 `{"type":"result","text":"...","language":"...","latency_ms":123,"audio_chunks":12,"audio_bytes":45678,"audio_duration_ms":3200}`，失败时返回 `{"type":"error","code":"...","message":"..."}`。

服务端会拒绝过短或未完整解码的录音（默认小于 800 字节或 350 毫秒），避免把没有采集完整的声音误当成“嗯”。音频统计只用于本次诊断，不写入音频内容或完整身份信息日志。`ASR_MIN_AUDIO_BYTES` 和 `ASR_MIN_AUDIO_DURATION_MS` 可按设备麦克风质量调整。

音频只在内存中处理，服务不记录音频、完整手机号或身份证号。模型代码和权重请以 Qwen3-ASR 发布仓库及具体模型卡的许可证为准。
