$ErrorActionPreference = "Stop"

function Assert-Docker {
  try { docker info --format '{{.ServerVersion}}' | Out-Null }
  catch { throw "Docker Desktop Linux engine is not running." }
}

Assert-Docker
$network = docker network ls --filter name=^hotel-agent-os-private$ --format '{{.Name}}'
if (-not $network) { docker network create hotel-agent-os-private | Out-Null }

$kamraRoot = 'D:\Kamra-PMS\frappe_docker'
docker compose -p kamra --project-directory $kamraRoot `
  -f "$kamraRoot\compose.yaml" `
  -f "$kamraRoot\overrides\compose.mariadb.yaml" `
  -f "$kamraRoot\overrides\compose.redis.yaml" `
  -f "$kamraRoot\overrides\compose.noproxy.yaml" `
  -f "$kamraRoot\overrides\compose.hotel-agent-network.yaml" up -d

$projectRoot = Split-Path -Parent $PSScriptRoot
docker compose -f (Join-Path $projectRoot 'docker-compose.production.yml') up -d
Write-Host "Kamra and Hotel Agent OS started."
