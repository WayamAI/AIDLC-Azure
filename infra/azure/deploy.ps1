# Azure Container Apps deploy for AIDLC API
# Requires: Azure CLI logged in (`az login`), Docker (for local build) OR ACR build

param(
  [string]$ResourceGroup = "aidlc-rg",
  [string]$Location = "eastus",
  [string]$AcrName = "aidlcregistry",
  [string]$EnvName = "aidlc-env",
  [string]$AppName = "aidlc-api",
  [string]$ImageTag = "latest",
  [string]$EnvFile = ".env.azure"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Backend = Join-Path $Root "backend"
$ImageName = "$AcrName.azurecr.io/aidlc-api:$ImageTag"

Write-Host "==> Resource group $ResourceGroup ($Location)"
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "==> Azure Container Registry $AcrName"
az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true | Out-Null

Write-Host "==> ACR build (no local Docker required)"
Push-Location $Backend
az acr build --registry $AcrName --image "aidlc-api:$ImageTag" .
Pop-Location

Write-Host "==> Container Apps environment"
az containerapp env create --name $EnvName --resource-group $ResourceGroup --location $Location 2>$null

$AcrPassword = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv
$AcrUser = az acr credential show --name $AcrName --query "username" -o tsv

# Load optional env file as secrets (KEY=VALUE lines)
$SecretArgs = @()
$EnvArgs = @(
  "APP_ENV=production",
  "CORS_ORIGINS=https://localhost"
)
if (Test-Path (Join-Path $Backend $EnvFile)) {
  Get-Content (Join-Path $Backend $EnvFile) | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $pair = $line.Split("=", 2)
    if ($pair.Length -ne 2) { return }
    $k = $pair[0].Trim()
    $v = $pair[1].Trim().Trim('"')
    $SecretArgs += "$k=$v"
    $EnvArgs += "$k=secretref:$k"
  }
}

Write-Host "==> Create / update Container App $AppName"
$exists = az containerapp show --name $AppName --resource-group $ResourceGroup 2>$null
if (-not $exists) {
  az containerapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --environment $EnvName `
    --image $ImageName `
    --registry-server "$AcrName.azurecr.io" `
    --registry-username $AcrUser `
    --registry-password $AcrPassword `
    --target-port 8000 `
    --ingress external `
    --cpu 1.0 --memory 2.0Gi `
    --min-replicas 1 --max-replicas 3 `
    --secrets ($SecretArgs -join " ") `
    --env-vars ($EnvArgs -join " ")
} else {
  az containerapp update `
    --name $AppName `
    --resource-group $ResourceGroup `
    --image $ImageName
}

$Fqdn = az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
Write-Host ""
Write-Host "Deployed: https://$Fqdn"
Write-Host "Health:   https://$Fqdn/health"
Write-Host "Ready:    https://$Fqdn/ready"
Write-Host "Set FRONTEND_URL + CORS_ORIGINS to your Static Web App URL, then:"
Write-Host "  az containerapp update -n $AppName -g $ResourceGroup --set-env-vars FRONTEND_URL=https://... CORS_ORIGINS=https://..."
