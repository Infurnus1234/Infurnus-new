param(
  [Parameter(Mandatory = $true)][string]$RuntimeEnvFile,
  [Parameter(Mandatory = $true)][string]$ApprovedBoundaryFile,
  [switch]$ValidateOnly,
  [string]$DockerExecutable = 'docker'
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $RuntimeEnvFile -PathType Leaf) -or
    !(Test-Path -LiteralPath $ApprovedBoundaryFile -PathType Leaf)) {
  throw 'Approved runtime environment and boundary files are required.'
}
$previousRuntime = $env:INFURNUS_RUNTIME_ENV_FILE
$previousBoundary = $env:INFURNUS_APPROVED_BOUNDARY_FILE
try {
  $env:INFURNUS_RUNTIME_ENV_FILE = (Resolve-Path -LiteralPath $RuntimeEnvFile).Path
  $env:INFURNUS_APPROVED_BOUNDARY_FILE = (Resolve-Path -LiteralPath $ApprovedBoundaryFile).Path
  $profile = Join-Path (Split-Path $PSScriptRoot -Parent) 'docker-compose.production.yml'
  # Explicit --env-file avoids reading the user's checkout .env and its credentials.
  & $DockerExecutable compose --env-file $env:INFURNUS_RUNTIME_ENV_FILE -f $profile config --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Production configuration validation failed; no runtime values logged.' }
  if ($ValidateOnly) { Write-Output 'Production Compose configuration: PASS'; return }
  & $DockerExecutable compose --env-file $env:INFURNUS_RUNTIME_ENV_FILE -f $profile up --build --detach 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Production start failed; inspect the deployment securely.' }
  Write-Output 'Single-instance production backend started.'
} finally {
  $env:INFURNUS_RUNTIME_ENV_FILE = $previousRuntime
  $env:INFURNUS_APPROVED_BOUNDARY_FILE = $previousBoundary
}
