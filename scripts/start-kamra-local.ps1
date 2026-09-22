$ErrorActionPreference = "Stop"

function Assert-Docker {
  try { docker info --format '{{.ServerVersion}}' | Out-Null }
  catch { throw "Docker Desktop Linux 引擎未运行，请先启动 Docker Desktop。" }
}

Assert-Docker
docker network create hotel-agent-os-private 2>$null

$kamraRoot = "D:\Kamra-PMS\frappe_docker"
docker compose -p kamra --project-directory $kamraRoot `
  -f "$kamraRoot\compose.yaml" `
  -f "$kamraRoot\overrides\compose.mariadb.yaml" `
  -f "$kamraRoot\overrides\compose.redis.yaml" `
  -f "$kamraRoot\overrides\compose.noproxy.yaml" `
  -f "$kamraRoot\overrides\compose.hotel-agent-network.yaml" up -d

docker compose -f "D:\AI无人酒店\docker-compose.production.yml" up -d
Write-Host "Kamra 与 Hotel Agent OS 已启动。"
