# Azure VM Deployment with PM2 (Frontend + Backend)

This is a direct runbook for your current state:
- VM already created
- project already copied/cloned to VM
- you want both frontend and backend running via PM2

Assumptions:
- OS: Ubuntu 22.04+
- project path: `/home/azureuser/testgen-ai-suite` (change if different)
- backend port: `8000`
- frontend port: `4173`

---

## 1) Install base dependencies on VM

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3 python3-venv python3-pip nginx
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2 globally:

```bash
sudo npm install -g pm2
pm2 -v
```

---

## 2) Go to project and install frontend deps

```bash
cd /home/azureuser/testgen-ai-suite
npm ci
npm run build
```

---

## 3) Setup backend virtual environment

```bash
cd /home/azureuser/testgen-ai-suite/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Install Playwright browsers + OS deps (important):

```bash
cd /home/azureuser/testgen-ai-suite
npx playwright install --with-deps chromium
```

If backend uses Playwright directly through Python tooling and you need full set:

```bash
npx playwright install --with-deps
```

---

## 4) Configure environment files

Frontend env (`/home/azureuser/testgen-ai-suite/.env`):

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Backend env (`/home/azureuser/testgen-ai-suite/backend/.env`):

Use your existing `.env` values. Ensure at least:

```env
HOST=0.0.0.0
PORT=8000
```

Also ensure DB/API keys (Mongo/OpenAI/GitHub etc.) are present as required by your backend.

---

## 5) Create PM2 ecosystem file

Create `/home/azureuser/testgen-ai-suite/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "testgen-backend",
      cwd: "/home/azureuser/testgen-ai-suite/backend",
      script: "/home/azureuser/testgen-ai-suite/backend/.venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000",
      env: {
        PYTHONUNBUFFERED: "1"
      }
    },
    {
      name: "testgen-frontend",
      cwd: "/home/azureuser/testgen-ai-suite",
      script: "npm",
      args: "run preview -- --host 0.0.0.0 --port 4173",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
```

---

## 6) Start services with PM2

```bash
cd /home/azureuser/testgen-ai-suite
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs --lines 100
```

Check services:

```bash
curl http://127.0.0.1:8000/health
curl -I http://127.0.0.1:4173
```

---

## 7) Enable PM2 auto-start on reboot

Run the command PM2 gives you:

```bash
pm2 startup
```

Then save running processes:

```bash
pm2 save
```

---

## 8) Put Nginx in front (recommended)

Create Nginx site:

```bash
sudo nano /etc/nginx/sites-available/testgen-ai-suite
```

Paste:

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN_OR_VM_IP>;

    # Frontend (Vite preview via PM2)
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/testgen-ai-suite /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 9) Open Azure NSG ports

In Azure NSG, allow inbound:
- `22` (SSH)
- `80` (HTTP)
- `443` (HTTPS, if SSL enabled)

You do **not** need to expose `4173` or `8000` publicly when using Nginx reverse proxy.

---

## 10) HTTPS (optional but recommended)

If domain is mapped:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
```

---

## 11) Update deployment flow (every new release)

```bash
cd /home/azureuser/testgen-ai-suite
git pull

# Frontend
npm ci
npm run build

# Backend
cd backend
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Restart PM2 apps
pm2 restart testgen-frontend
pm2 restart testgen-backend
pm2 save
```

---

## 12) Useful PM2 commands

```bash
pm2 status
pm2 logs testgen-frontend --lines 200
pm2 logs testgen-backend --lines 200
pm2 restart testgen-frontend
pm2 restart testgen-backend
pm2 stop all
pm2 delete all
```

---

## 13) Quick checks if something fails

- Backend health:
  - `curl http://127.0.0.1:8000/health`
- Frontend local:
  - `curl -I http://127.0.0.1:4173`
- PM2 process state:
  - `pm2 status`
- PM2 logs:
  - `pm2 logs --lines 200`
- Nginx test and logs:
  - `sudo nginx -t`
  - `sudo journalctl -u nginx -n 100 --no-pager`

---

If you want, I can also give you a second version where frontend is served as static files directly by Nginx (`dist/`) and only backend runs on PM2. That setup is lighter for production.
# Deploy `testgen-ai-suite` on an Azure VM (with Playwright support)

This guide deploys the app on an Azure Ubuntu VM and prepares the machine for Playwright-based browser tasks/tests.

## 1) Prerequisites

- Azure subscription
- SSH key pair (`~/.ssh/id_rsa.pub` or similar)
- Domain name (optional, but recommended for HTTPS)
- Local machine with `ssh`, `git`

## 2) Create the Azure VM

Create an Ubuntu 22.04 VM (recommended size: at least 2 vCPU / 4 GB RAM).

### Required inbound ports (NSG)

- `22` (SSH)
- `80` (HTTP)
- `443` (HTTPS)

If you plan to expose app directly (not recommended), also open:

- `4173` (Vite preview) or your custom app port

## 3) SSH into VM and do base setup

```bash
ssh azureuser@<VM_PUBLIC_IP>
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Kolkata
```

Create app directory:

```bash
mkdir -p /var/www/testgen-ai-suite
sudo chown -R $USER:$USER /var/www/testgen-ai-suite
cd /var/www/testgen-ai-suite
```

## 4) Install Node.js 20 + build tools

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential git
node -v
npm -v
```

## 5) Pull project code

Using HTTPS:

```bash
git clone <YOUR_REPO_URL> .
```

Using SSH:

```bash
git clone git@github.com:<ORG_OR_USER>/<REPO>.git .
```

## 6) Install dependencies and build app

```bash
npm ci
npm run build
```

Expected output folder: `dist/`

## 7) Install Playwright dependencies on VM

Even if this app is mainly frontend, install browser/system deps so Playwright flows work reliably.

```bash
npx playwright install --with-deps chromium
```

If you need all browsers:

```bash
npx playwright install --with-deps
```

Optional quick validation:

```bash
npx playwright --version
```

## 8) Serve app with Nginx (recommended)

Install Nginx:

```bash
sudo apt install -y nginx
```

Create site config:

```bash
sudo nano /etc/nginx/sites-available/testgen-ai-suite
```

Paste:

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN_OR_VM_IP>;

    root /var/www/testgen-ai-suite/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/testgen-ai-suite /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

Open in browser:

`http://<YOUR_DOMAIN_OR_VM_IP>`

## 9) Configure HTTPS with Let's Encrypt (recommended)

If using domain:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
```

Auto-renew check:

```bash
sudo systemctl status certbot.timer
```

## 10) Deployment update flow

Whenever you push new changes:

```bash
cd /var/www/testgen-ai-suite
git pull
npm ci
npm run build
sudo systemctl reload nginx
```

## 11) Optional: run Playwright checks on the VM

If your repo has Playwright tests:

```bash
npx playwright test
```

For CI-like headless runs, no desktop session is required when using Playwright defaults.

## 12) Troubleshooting

### App page shows 404 on refresh (React routes)

Confirm Nginx has:

```nginx
location / {
    try_files $uri /index.html;
}
```

### `npm ci` fails

- Ensure Node major version is compatible (`node -v`, prefer 20.x)
- Remove lock mismatch cases:
  - commit correct `package-lock.json`
  - or run `npm install` once and recommit lockfile

### Playwright browser launch errors

Run again:

```bash
npx playwright install --with-deps
```

### Nginx not serving latest build

```bash
ls -la /var/www/testgen-ai-suite/dist
sudo systemctl reload nginx
```

## 13) Security checklist (minimum)

- Disable password SSH login, use key-based auth only
- Keep `ufw` enabled
- Keep OS packages updated (`sudo apt update && sudo apt upgrade`)
- Use HTTPS only in production
- Restrict NSG inbound rules to only required ports

---

If you want, the next step can be a second doc for a fully automated deploy using GitHub Actions + SSH to this Azure VM.
