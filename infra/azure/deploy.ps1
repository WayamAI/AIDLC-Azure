# Azure Container Apps deploy for AIDLC (unified SPA + FastAPI + Playwright).
# Builds the repo-root Dockerfile, not backend-only.
# Requires: Azure CLI logged in (`az login`). Docker not required (`az acr build`).
#
# Existing production (East Asia) was created ad-hoc as:
#   RG=vakyam-rg  Location=eastasia  ACR=vakyamcr20260820  App=aidlc
# Point the parameters at those names to update that environment.

param(
  [string]$ResourceGroup = "aidlc-rg",
  [string]$Location = "eastus",
  [string]$AcrName = "aidlcregistry",
  [string]$EnvName = "aidlc-env",
  [string]$AppName = "aidlc",
  [string]$ImageName = "aidlc",
  [string]$ImageTag = "latest",
  [string]$EnvFile = ".env.azure"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Backend = Join-Path $Root "backend"
$Image = "$AcrName.azurecr.io/${ImageName}:$ImageTag"
$Dockerfile = Join-Path $Root "Dockerfile"

if (-not (Test-Path $Dockerfile)) {
  throw "Root Dockerfile not found at $Dockerfile (unified SPA+API image)."
}

Write-Host "==> Resource group $ResourceGroup ($Location)"
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "==> Azure Container Registry $AcrName"
az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true | Out-Null

Write-Host "==> ACR build of unified image (frontend + FastAPI + Playwright Chromium)"
Push-Location $Root
# The ACR log stream contains U+2713. On a cp1252 Windows console the CLI dies
# with UnicodeEncodeError *while printing logs* — the server-side build keeps
# running and succeeds, but az exits 1 and the deploy looks like it failed.
$env:PYTHONIOENCODING = "utf-8"
az acr build --registry $AcrName --image "${ImageName}:$ImageTag" --file Dockerfile .
Pop-Location

Write-Host "==> Container Apps environment"
az containerapp env create --name $EnvName --resource-group $ResourceGroup --location $Location 2>$null

$AcrPassword = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv
$AcrUser = az acr credential show --name $AcrName --query "username" -o tsv

$SecretArgs = @()
$EnvArgs = @(
  "APP_ENV=production"
)
$EnvPath = Join-Path $Backend $EnvFile
if (Test-Path $EnvPath) {
  Get-Content $EnvPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $pair = $line.Split("=", 2)
    if ($pair.Length -ne 2) { return }
    $k = $pair[0].Trim()
    $v = $pair[1].Trim().Trim('"')
    # Azure Container Apps secret names must match ^[a-z0-9][a-z0-9-]*$ — an
    # env key like MONGODB_URI is rejected outright, so map it to mongodb-uri.
    # Empty values are also rejected, so skip unset keys instead of failing.
    if (-not $v) { return }
    $secretName = $k.ToLower().Replace("_", "-")
    $SecretArgs += "$secretName=$v"
    $EnvArgs += "$k=secretref:$secretName"
  }
}

Write-Host "==> Create / update Container App $AppName"
$exists = az containerapp show --name $AppName --resource-group $ResourceGroup 2>$null
if (-not $exists) {
  $createArgs = @(
    "containerapp", "create",
    "--name", $AppName,
    "--resource-group", $ResourceGroup,
    "--environment", $EnvName,
    "--image", $Image,
    "--registry-server", "$AcrName.azurecr.io",
    "--registry-username", $AcrUser,
    "--registry-password", $AcrPassword,
    "--target-port", "8000",
    "--ingress", "external",
    "--cpu", "1.0", "--memory", "2.0Gi",
    "--min-replicas", "1", "--max-replicas", "3",
    "--env-vars"
  ) + $EnvArgs
  if ($SecretArgs.Count -gt 0) {
    $createArgs += @("--secrets") + $SecretArgs
  }
  & az @createArgs
} else {
  az containerapp update `
    --name $AppName `
    --resource-group $ResourceGroup `
    --image $Image
  if ($SecretArgs.Count -gt 0) {
    az containerapp secret set --name $AppName --resource-group $ResourceGroup --secrets @SecretArgs | Out-Null
    az containerapp update --name $AppName --resource-group $ResourceGroup --set-env-vars @EnvArgs | Out-Null
  }
}

$Fqdn = az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
Write-Host ""
Write-Host "Deployed unified AIDLC (SPA + API) at: https://$Fqdn"
Write-Host "Health:   https://$Fqdn/health"
Write-Host "Ready:    https://$Fqdn/ready"
Write-Host "The frontend is served from this container. Set FRONTEND_URL and CORS_ORIGINS to https://$Fqdn"
Write-Host "Also set VERCEL_TOKEN / GITHUB_TOKEN (or save them in Settings → Connectors) for user-app deploys."
