#!/usr/bin/env bash
# Azure Container Apps deploy for AIDLC (unified SPA + FastAPI + Playwright).
# Builds the repo-root Dockerfile. Docker is not required (`az acr build`).
set -euo pipefail

RG="${RESOURCE_GROUP:-aidlc-rg}"
LOC="${LOCATION:-eastus}"
ACR="${ACR_NAME:-aidlcregistry}"
ENV_NAME="${ACA_ENV:-aidlc-env}"
APP="${APP_NAME:-aidlc}"
IMAGE_NAME="${IMAGE_NAME:-aidlc}"
TAG="${IMAGE_TAG:-latest}"
ENV_FILE="${ENV_FILE:-.env.azure}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
IMAGE="$ACR.azurecr.io/${IMAGE_NAME}:$TAG"

if [[ ! -f "$ROOT/Dockerfile" ]]; then
  echo "Root Dockerfile not found at $ROOT/Dockerfile" >&2
  exit 1
fi

echo "==> Resource group $RG ($LOC)"
az group create --name "$RG" --location "$LOC" >/dev/null

echo "==> ACR $ACR"
az acr create --resource-group "$RG" --name "$ACR" --sku Basic --admin-enabled true >/dev/null

echo "==> ACR build of unified image (frontend + FastAPI + Playwright Chromium)"
# --no-logs is required on Windows: the ACR log stream contains U+2713 and
# colorama writes it through the cp1252 console encoding, so the CLI dies with
# UnicodeEncodeError while printing logs even though the build succeeds.
# PYTHONIOENCODING does not help — the crash is below that layer.
( cd "$ROOT" && az acr build --registry "$ACR" --image "${IMAGE_NAME}:$TAG" --file Dockerfile . --no-logs )

echo "==> Container Apps environment"
az containerapp env create --name "$ENV_NAME" --resource-group "$RG" --location "$LOC" 2>/dev/null || true

ACR_USER=$(az acr credential show --name "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show --name "$ACR" --query "passwords[0].value" -o tsv)

SECRET_ARGS=()
ENV_ARGS=("APP_ENV=production")
if [[ -f "$BACKEND/$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="$(echo "$key" | xargs)"
    val="${val%\"}"
    val="${val#\"}"
    [[ -z "$key" ]] && continue
    # Azure Container Apps secret names must match ^[a-z0-9][a-z0-9-]*$ — an
    # env key like MONGODB_URI is rejected outright, so map it to mongodb-uri.
    # Empty values are also rejected, so skip unset keys instead of failing.
    [[ -z "$val" ]] && continue
    secret_name="$(echo "$key" | tr '[:upper:]_' '[:lower:]-')"
    SECRET_ARGS+=("${secret_name}=${val}")
    ENV_ARGS+=("${key}=secretref:${secret_name}")
  done < "$BACKEND/$ENV_FILE"
fi

echo "==> Create / update Container App $APP"
if ! az containerapp show --name "$APP" --resource-group "$RG" >/dev/null 2>&1; then
  CREATE=(az containerapp create
    --name "$APP"
    --resource-group "$RG"
    --environment "$ENV_NAME"
    --image "$IMAGE"
    --registry-server "$ACR.azurecr.io"
    --registry-username "$ACR_USER"
    --registry-password "$ACR_PASS"
    --target-port 8000
    --ingress external
    --cpu 1.0 --memory 2.0Gi
    --min-replicas 1 --max-replicas 3
    --env-vars "${ENV_ARGS[@]}"
  )
  if ((${#SECRET_ARGS[@]})); then
    CREATE+=(--secrets "${SECRET_ARGS[@]}")
  fi
  "${CREATE[@]}"
else
  az containerapp update --name "$APP" --resource-group "$RG" --image "$IMAGE"
  if ((${#SECRET_ARGS[@]})); then
    az containerapp secret set --name "$APP" --resource-group "$RG" --secrets "${SECRET_ARGS[@]}" >/dev/null
    az containerapp update --name "$APP" --resource-group "$RG" --set-env-vars "${ENV_ARGS[@]}" >/dev/null
  fi
fi

FQDN=$(az containerapp show --name "$APP" --resource-group "$RG" --query "properties.configuration.ingress.fqdn" -o tsv)
echo ""
echo "Deployed unified AIDLC (SPA + API) at: https://$FQDN"
echo "Health:   https://$FQDN/health"
echo "Ready:    https://$FQDN/ready"
echo "The frontend is served from this container. Set FRONTEND_URL and CORS_ORIGINS to https://$FQDN"
echo "Also set VERCEL_TOKEN / GITHUB_TOKEN (or save them in Settings → Connectors) for user-app deploys."
