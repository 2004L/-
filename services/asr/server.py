"""Local Qwen3-ASR WebSocket gateway for the Hotel Agent OS terminal.

The browser sends short WebM/Opus recordings over a local WebSocket. Audio is
decoded and transcribed on the local GPU machine; transcripts are returned
without writing audio or personal data to logs.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import time
from typing import Any

import numpy as np
import torch

try:
    from websockets.asyncio.server import ServerConnection, serve
except ImportError:  # websockets < 14
    from websockets.server import WebSocketServerProtocol as ServerConnection  # type: ignore
    from websockets.server import serve  # type: ignore

from qwen_asr import Qwen3ASRModel


HOST = os.getenv("ASR_HOST", "127.0.0.1")
PORT = int(os.getenv("ASR_PORT", "8765"))
MODEL_NAME = os.getenv("QWEN_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
MAX_AUDIO_BYTES = int(os.getenv("ASR_MAX_AUDIO_BYTES", str(8 * 1024 * 1024)))
TRANSCRIBE_TIMEOUT = float(os.getenv("ASR_TRANSCRIBE_TIMEOUT", "20"))
ASR_CONCURRENCY = max(1, int(os.getenv("ASR_CONCURRENCY", "1")))


def resolve_ffmpeg() -> str:
    configured = os.getenv("FFMPEG_BIN", "").strip()
    if configured:
        return configured
    system_binary = shutil.which("ffmpeg")
    if system_binary:
        return system_binary
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as error:
        raise FileNotFoundError("ffmpeg_missing") from error


def load_model() -> Qwen3ASRModel:
    dtype_name = os.getenv("QWEN_ASR_DTYPE", "float16").lower()
    dtype = torch.bfloat16 if dtype_name in {"bf16", "bfloat16"} else torch.float16
    return Qwen3ASRModel.from_pretrained(
        MODEL_NAME,
        dtype=dtype,
        device_map=os.getenv("QWEN_ASR_DEVICE", "cuda:0"),
        max_inference_batch_size=1,
        max_new_tokens=256,
    )


MODEL = load_model()
TRANSCRIBE_SEMAPHORE = asyncio.Semaphore(ASR_CONCURRENCY)


def decode_audio(audio: bytes) -> tuple[np.ndarray, int]:
    """Decode a browser recording into mono 16 kHz float32 PCM."""
    result = subprocess.run(
        [
            resolve_ffmpeg(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "pipe:1",
        ],
        input=audio,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=10,
    )
    if result.returncode != 0 or not result.stdout:
        raise ValueError("audio_decode_failed")
    pcm = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return pcm, 16000


def transcribe(audio: bytes, language: str | None) -> dict[str, Any]:
    samples, sample_rate = decode_audio(audio)
    result = MODEL.transcribe(audio=(samples, sample_rate), language=language or None)
    item = result[0]
    text = str(getattr(item, "text", "") or "").strip()
    detected_language = str(getattr(item, "language", "") or language or "").strip()
    if not text:
        raise ValueError("empty_transcript")
    return {"text": text, "language": detected_language}


async def send_error(websocket: ServerConnection, code: str, message: str) -> None:
    await websocket.send(json.dumps({"type": "error", "code": code, "message": message}, ensure_ascii=False))


async def handler(websocket: ServerConnection, *_: Any) -> None:
    chunks: list[bytes] = []
    language: str | None = "Chinese"
    started = False
    async for message in websocket:
        if isinstance(message, bytes):
            if not started:
                await send_error(websocket, "session_not_started", "请先开始语音会话")
                continue
            if sum(len(chunk) for chunk in chunks) + len(message) > MAX_AUDIO_BYTES:
                await send_error(websocket, "audio_too_large", "语音过长，请分段说")
                return
            chunks.append(message)
            continue

        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            await send_error(websocket, "invalid_message", "无法识别语音消息")
            continue

        message_type = payload.get("type")
        if message_type == "start":
            chunks.clear()
            language = payload.get("language") or "Chinese"
            started = True
            await websocket.send(json.dumps({"type": "ready"}))
        elif message_type == "stop":
            if not started or not chunks:
                await send_error(websocket, "empty_audio", "没有听到语音，请再说一次")
                continue
            started = False
            audio = b"".join(chunks)
            chunks.clear()
            started_at = time.perf_counter()
            try:
                async with TRANSCRIBE_SEMAPHORE:
                    result = await asyncio.wait_for(asyncio.to_thread(transcribe, audio, language), TRANSCRIBE_TIMEOUT)
                result.update(type="result", latency_ms=round((time.perf_counter() - started_at) * 1000))
                await websocket.send(json.dumps(result, ensure_ascii=False))
            except asyncio.TimeoutError:
                await send_error(websocket, "transcribe_timeout", "本地识别超时，请再说一次")
            except FileNotFoundError:
                await send_error(websocket, "ffmpeg_missing", "本地语音服务缺少音频解码组件")
            except Exception:
                await send_error(websocket, "transcribe_failed", "本地识别失败，请再说一次")
        else:
            await send_error(websocket, "unknown_message", "无法识别语音请求")


async def main() -> None:
    print(f"Hotel Agent OS local ASR listening on ws://{HOST}:{PORT}/asr")
    async with serve(handler, HOST, PORT, max_size=MAX_AUDIO_BYTES, ping_interval=20, ping_timeout=20):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
