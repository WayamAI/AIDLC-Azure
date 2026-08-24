#!/usr/bin/env bash
# Azure Container Apps deploy for AIDLC API
set -euo pipefail

RG="${RESOURCE_GROUP:-aidlc-rg}"
LOC="${LOCATION:-eastus}"
ACR="${ACR_NAME:-aidlcregistry}"
ENV_NAME="${ACA_ENV:-aidlc-env}"
APP="${APP_NAME:-aidlc-api}"
TAG="${IMAGE_TAG:-latest}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
IMAGE="$ACR.azurecr.io/aidlc-api:$TAG"

echo "==> Resource group $RG ($LOC)"
az group create --name "$RG" --location "$LOC" >/dev/null

echo "==> ACR $ACR"
az acr create --resource-group "$RG" --name "$ACR" --sku Basic --admin-enabled true >/dev/null

echo "==> ACR build"
( cd "$BACKEND" && az acr build --registry "$ACR" --image "aidlc-api:$TAG" . )

echo "==> Container Apps environment"
az containerapp env create --name "$ENV_NAME" --resource-group "$RG" --location "$LOC" 2>/dev/null || true

ACR_USER=$(az acr credential show --name "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show --name "$ACR" --query "passwords[0].value" -o tsv)

if ! az containerapp show --name "$APP" --resource-group "$RG" >/dev/null 2>&1; then
  az containerapp create \
    --name "$APP" \
    --resource-group "$RG" \
    --environment "$ENV_NAME" \
    --image "$IMAGE" \
    --registry-server "$ACR.azurecr.io" \
    --registry-username "$ACR_USER" \
    --registry-password "$ACR_PASS" \
    --target-port 8000 \
    --ingress external \
    --cpu 1.0 --memory 2.0Gi \
    --min-replicas 1 --max-replicas 3 \
    --env-vars "APP_ENV=production"
else
  az containerapp update --name "$APP" --resource-group "$RG" --image "$IMAGE"
fi

FQDN=$(az containerapp show --name "$APP" --resource-group "$RG" --query "properties.configuration.ingress.fqdn" -o tsv)
echo ""
echo "Deployed: https://$FQDN"
echo "Health:   https://$FQDN/health"
echo "Ready:    https://$FQDN/ready"
echo "Configure secrets (MONGODB_URI, SESSION_SECRET, OLLAMA_*, GITHUB_TOKEN, CORS_ORIGINS) via:"
echo "  az containerapp secret set -n $APP -g $RG --secrets mongodb-uri=... session-secret=..."
echo "  az containerapp update -n $APP -g $RG --set-env-vars MONGODB_URI=secretref:mongodb-uri SESSION_SECRET=secretref:session-secret"
