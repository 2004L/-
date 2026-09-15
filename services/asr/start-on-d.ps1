$ErrorActionPreference = "Stop"

$asrRoot = "D:\AI-Hotel-Models"
$python = Join-Path $asrRoot "asr-venv\Scripts\python.exe"
$modelPath = Join-Path $asrRoot "qwen3-asr-0.6b"
$service = Join-Path $PSScriptRoot "server.py"

if (-not (Test-Path -LiteralPath $python)) { throw "ASR Python environment not found: $python" }
if (-not (Test-Path -LiteralPath $modelPath)) { throw "ASR model directory not found: $modelPath" }

$env:ASR_HOST = "127.0.0.1"
$env:ASR_PORT = "8765"
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
$env:ASR_TRANSCRIBE_TIMEOUT = "20"

Write-Host "Hotel Agent OS local ASR: ws://127.0.0.1:8765/asr"
& $python $service
