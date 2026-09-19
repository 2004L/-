$ErrorActionPreference = "Stop"

$asrRoot = "D:\AI-Hotel-Models"
$cudaPython = Join-Path $asrRoot "asr-cuda-venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $cudaPython) { $cudaPython } else { Join-Path $asrRoot "asr-venv\Scripts\python.exe" }
$modelPath = Join-Path $asrRoot "qwen3-asr-0.6b"
$service = Join-Path $PSScriptRoot "server.py"
$certRoot = Join-Path $asrRoot "asr-certs"
$certPath = Join-Path $certRoot "asr-local-cert.pem"
$keyPath = Join-Path $certRoot "asr-local-key.pem"

if (-not (Test-Path -LiteralPath $python)) { throw "ASR Python environment not found: $python" }
if (-not (Test-Path -LiteralPath $modelPath)) { throw "ASR model directory not found: $modelPath" }

# CUDA 版环境来自清华镜像的 PyTorch/NVIDIA 运行库；仅对本次 ASR 进程生效。
# 保留 CPU 环境作为回退，不把 CUDA DLL 写入系统 PATH。
$env:PATH = "D:\AI-Hotel-Models\asr-cuda-venv\Library\bin;D:\AI-Hotel-Models\asr-cuda-venv\Lib\site-packages\torch\lib;$env:PATH"

$env:ASR_HOST = "127.0.0.1"
$env:ASR_PORT = "8765"
$existingListener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort ([int]$env:ASR_PORT) -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
    $owners = ($existingListener | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "ASR port $($env:ASR_PORT) is already in use by PID $owners. Stop the old ASR process before starting the D-drive service."
}
$env:QWEN_ASR_MODEL = $modelPath
$cuda = & $python -c "import torch; print('1' if torch.cuda.is_available() else '0')"
if ($cuda.Trim() -eq "1") {
    $env:QWEN_ASR_DEVICE = "cuda:0"
    $env:QWEN_ASR_DTYPE = "float16"
    Write-Host "ASR device: RTX CUDA"
} else {
    $env:QWEN_ASR_DEVICE = "cpu"
    $env:QWEN_ASR_DTYPE = "float32"
    Write-Host "ASR device: CPU fallback (CUDA PyTorch not available)"
}
$env:ASR_CONCURRENCY = "1"
$env:ASR_MAX_AUDIO_BYTES = "8388608"
$env:ASR_MIN_AUDIO_BYTES = "800"
$env:ASR_MIN_AUDIO_DURATION_MS = "350"
$env:ASR_TRANSCRIBE_TIMEOUT = "20"
$env:ASR_ALLOWED_ORIGIN = "https://hotel-agent-os.abloom-toast-5174.chatgpt.site"
if ((Test-Path -LiteralPath $certPath) -and (Test-Path -LiteralPath $keyPath)) {
    $env:ASR_TLS_CERT = $certPath
    $env:ASR_TLS_KEY = $keyPath
    Write-Host "ASR transport: WSS (local certificate)"
} else {
    $env:ASR_TLS_CERT = ""
    $env:ASR_TLS_KEY = ""
    Write-Warning "Local WSS certificate not found; browser HTTPS clients will not connect."
}

Write-Host "Hotel Agent OS local ASR endpoint: 127.0.0.1:8765/asr"
& $python $service
