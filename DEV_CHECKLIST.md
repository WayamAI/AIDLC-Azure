# Development Checklist

See `SETUP.md` for full environment setup. This is the quick day-to-day reference.

## Pull Latest Code

```bash
git pull
```

## Install / Update Dependencies

```bash
# Backend
cd SDLC-feature-backend
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd SDLC-frontend
npm install
```

## Add or Update a Package

```bash
# Backend edit pyproject.toml's dependencies list, then:
source .venv/bin/activate
pip install <package>
pip freeze > requirements.txt   # keep requirements.txt in sync with pyproject.toml

# Frontend
npm install <package>           # or npm install <package>@<version>
```

## Database

No ORM/migration tool is used (raw Motor/PyMongo against MongoDB, collections created on demand).

```bash
docker start sdlc-mongo    # start local Mongo
docker stop sdlc-mongo     # stop it
```

To wipe and recreate:

```bash
docker rm -f sdlc-mongo && docker volume rm sdlc-mongo-data
docker run -d --name sdlc-mongo -p 27017:27017 -v sdlc-mongo-data:/data/db mongo:7
```

## Run Frontend

```bash
cd SDLC-frontend
npm run dev          # http://localhost:8080, HMR enabled
npm run lint
npm run test          # vitest run
npm run test:watch
npx tsc --noEmit -p tsconfig.app.json   # typecheck
npm run build          # production bundle -> dist/
npm run preview        # serve the production build locally
```

## Run Backend

```bash
cd SDLC-feature-backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000    # auto-reloads on file changes
```

Interactive API docs: http://localhost:8000/docs (FastAPI auto-generated Swagger UI).

## Debugging

- Backend logs print to stdout; DB connection failures are logged but non-fatal at startup
  (`app/database.py`) the process stays up, so check logs if API calls 500 with DB errors.
- Frontend: check the Vite terminal for HMR/build errors, and browser devtools console/network
  tab. API requests in dev go through the `/api` proxy defined in `vite.config.ts`.
- To test the backend in isolation from the frontend, use `/docs` or `curl`.

## Deploy

Both projects deploy independently to Vercel via each `vercel.json`:

```bash
cd SDLC-feature-backend && vercel --prod   # or push to the branch Vercel is wired to
cd SDLC-frontend && vercel --prod
```

The frontend's production build reads `VITE_API_URL` (set in Vercel project env vars / `.env.production`)
to know which deployed backend URL to call it does not use the dev-time `/api` proxy in production.
