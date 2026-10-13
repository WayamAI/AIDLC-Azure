# AIDLC Real Auth & Multi-Tenancy Foundation (Sub-project 1 of "market-ready backend")

**Status**: Approved for planning
**Date**: 2026-08-18
**Author**: Claude (with arkabera)

## Context

AIDLC currently has no real authentication: `frontend/src/context/AuthContext.tsx`
sets a `localStorage` flag on any form submit, with no backend validation and
no concept of a user or organization. All backend data requirements, test
cases, workspaces, pipeline runs, incidents, etc. lives in a single shared
pool with no ownership. This is fine for a demo but unsellable as a SaaS
product: any two customers using the hosted instance would see and could
modify each other's data.

The user's goal is to make AIDLC sellable as a **multi-tenant SaaS product**.
That's a large goal spanning several independent subsystems (auth, billing,
security hardening, ops). This spec covers only the first and most
foundational piece **everything else depends on tenants existing at all**:

1. **This spec**: real user accounts + organizations (tenants) + data isolation
2. *(separate future spec)* granular roles/permissions within an org
3. *(separate future spec)* billing & subscriptions (explicitly deferred no billing in this phase)
4. *(separate future spec)* security/production hardening (secrets management, rate limiting, audit logs)
5. *(separate future spec)* ops readiness (logging, error tracking, backups, CI/CD)

## Goals

- Real signup/login via a managed auth provider (WorkOS AuthKit) no more fake auth.
- Every user belongs to an Organization (tenant), auto-created at signup.
- Every piece of backend data is scoped to the owning organization; no
  request can ever read or write another org's data.
- Existing demo data is preserved as a working "sales demo" tenant, not deleted.
- Basic team invites (add a teammate to your org) WorkOS provides this
  nearly for free, so it's in scope even though granular roles are not.

## Non-goals (explicitly out of scope for this spec)

- Granular roles/permissions (admin vs. member capability differences beyond "who owns the org")
- Billing, subscriptions, usage-based pricing, plan limits
- Rate limiting, audit logging, secrets-manager migration
- SSO/SCIM for enterprise customers (WorkOS supports it later without re-architecture)
- Any UI redesign beyond what's needed to swap the login flow

## Architecture

```
┌─────────────┐   AuthKit hosted    ┌──────────────┐
│  Browser     │ ── login/signup ──▶ │  WorkOS       │
│  (React SPA) │ ◀── session token ─ │  AuthKit      │
└──────┬───────┘                     └──────┬───────┘
       │  every API call carries            │ webhook: user/org
       │  WorkOS session token              │ created/updated
       ▼                                     ▼
┌─────────────────────────────────────────────────┐
│  FastAPI backend                                  │
│  • auth middleware/dependency verifies WorkOS      │
│    session on every request → resolves             │
│    (user_id, org_id)                                │
│  • every route depends on get_current_org()       │
│    no route touches Mongo without a resolved org_id  │
└──────────────────────┬────────────────────────────┘
                        ▼
          MongoDB every existing collection gains
          an indexed `org_id` field; every query is
          scoped to it. Local `organizations` collection
          mirrors WorkOS org id + app-specific settings
          (plan placeholder for future billing).
```

WorkOS is the system of record for *identity* (who can log in, which org
they belong to). MongoDB stays the system of record for *app data*, now
tagged per tenant.

**Onboarding model**: signup via AuthKit auto-creates a new Organization in
WorkOS; the signing-up user becomes its owner. A companion doc in the local
`organizations` collection is created via a WorkOS webhook
(`organization.created` / `user.created`) so the backend has a fast local
lookup without calling WorkOS on every request.

## Data model changes

**New collection**: `organizations`
```
{
  _id: ObjectId,
  workos_org_id: str,       # WorkOS's canonical org id indexed, unique
  name: str,
  created_at: datetime,
  plan: "free",              # placeholder for future billing sub-project
}
```

**Every existing collection gains `org_id: str` (the local `organizations._id`, indexed):**
`requirements`, `test_cases`, `test_results`, `prioritized_tests`,
`synthetic_data`, `synthetic_datasets`, `repo_analyses`, `playwright_runs`,
`playwright_tests`, `pipeline_runs`, `incidents`, `snippets`,
`repo_baselines`, `baseline_scan_sessions`, `api_cost_logs`.

**Special case `workspace_service.py`**: workspaces are currently
filesystem-backed (`/tmp/workspaces/<uuid>/`) with an **in-memory,
per-process** registry (`_WORKSPACES: dict`) not Mongo at all. This is
flagged explicitly because it's a live isolation gap: any authenticated
request that knows or guesses a `workspace_id` UUID can currently read/write
that workspace's files, regardless of who created it. In scope for this
spec: tag each workspace with its owning `org_id` in the registry, and
reject any workspace operation where the resolved `org_id` doesn't match.
Persisting the registry to Mongo (surviving process restarts) is worth
doing here since it's a small addition once `org_id` scoping exists, but is
not required for tenant isolation itself.

## New backend components

- `app/auth/workos_client.py` wraps the WorkOS SDK: verify session, look
  up user/org, create invites, verify webhook signatures.
- `app/auth/dependencies.py` FastAPI dependencies `get_current_user()`
  and `get_current_org()`, used by every route.
- `app/routes/auth.py` `/api/auth/callback`, `/api/auth/logout`,
  `/api/auth/me`, `/api/auth/invite`.
- `app/routes/organizations.py` `/api/orgs/current`,
  `/api/orgs/current/members`.
- `app/routes/webhooks.py` `/api/webhooks/workos` (signature-verified,
  handles `organization.created`, `user.created`, membership changes).
- `app/models/organization.py` the `Organization` Pydantic model.
- **Every existing route module** (~26 files): add
  `org: Organization = Depends(get_current_org)` to each handler and thread
  `org_id` into the corresponding service-layer Mongo filters/inserts. This
  is mechanical but touches every route file the bulk of the implementation
  effort.

## Frontend changes

- Replace `AuthContext.tsx` with `@workos-inc/authkit-react`'s real
  `useAuth()` actual sessions, not a `localStorage` flag.
- `Login.tsx` redirects to AuthKit's hosted login/signup UI instead of
  rendering a fake form.
- `lib/api.ts` attaches the WorkOS session token to every API request
  (Authorization header).
- New minimal "Team" panel under `/profile` for inviting teammates
  (wraps `/api/auth/invite`).
- Route guard (already exists as a layout wrapper in `App.tsx`) now checks
  a real session instead of the `localStorage` flag.

## Migration of existing data

None of the current data is real customer data it's demo/seed content. It
will **not be deleted**. A one-off migration script
(`backend/scripts/migrate_add_org_id.py`) will:
1. Create a local `organizations` doc for a fixed `demo-org` (a real WorkOS
   org created once, credentials shared with the team, used for sales demos).
2. Backfill every document in every listed collection with
   `org_id = <demo-org's id>`.
3. Tag existing `/tmp/workspaces/*` entries (if any are live at migration
   time) with the same `demo-org` id.

This keeps the current working demo (dashboard stats, generated test suite,
etc.) intact as a permanent, always-available sales-demo tenant, while all
new signups get their own clean, isolated org.

## Error handling

- No/invalid session → `401 Unauthorized`, no Mongo access attempted.
- Valid session but `org_id` can't be resolved (e.g. webhook sync lag) →
  `403 Forbidden` with a clear "organization not yet provisioned" message,
  since WorkOS org creation and the local mirror write are not atomic.
- Webhook endpoint rejects any request that fails WorkOS's signature check
  with `401`, before touching the database.
- Cross-tenant access attempts (a resolved `org_id` that doesn't own the
  requested document) → `404`, not `403` don't reveal that the resource
  exists in another tenant.

## Testing plan

- **Cross-tenant isolation tests** (highest priority this is the actual
  security guarantee of the whole sub-project): for a representative subset
  of routes per collection, assert org A's session can never read, list, or
  mutate org B's documents, using two seeded test orgs.
- **Auth flow tests**: valid session → 200; missing session → 401; expired/
  tampered session → 401; webhook signature valid → org created; invalid
  signature → rejected.
- **Migration script test**: run against a seeded pre-migration dataset,
  assert every document in every listed collection has `org_id` set
  afterward and nothing is dropped.
- **Workspace isolation test**: org A cannot read/write a workspace created
  by org B, even with a guessed/known `workspace_id`.

## Rollout

1. Ship behind the existing dev/staging setup first; verify against the
   `demo-org` before any real signups are enabled.
2. WorkOS environment (dev + prod projects) configured with redirect URLs
   for both `localhost` dev and the eventual production domain.
3. Existing `backend/.env` gains `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
   `WORKOS_WEBHOOK_SECRET`, `WORKOS_REDIRECT_URI`.

## Open items for the *next* spec, not this one

- Role/permission model beyond "org owner"
- Billing/plan enforcement (the `plan: "free"` field exists now purely as a
  placeholder so billing doesn't need another migration later)
- Rate limiting per org/per user
- Audit log of who did what within an org
