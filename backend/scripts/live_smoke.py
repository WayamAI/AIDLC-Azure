"""Live smoke tests for AIDLC at least 20 cases. Uses kimi-k3:cloud via backend config."""
from __future__ import annotations

import json
import sys
import time
from typing import Any

import httpx

BASE = "http://127.0.0.1:8000"
EMAIL = "mriganka.dey@wayam.ai"
PASSWORD = "wayam"

results: list[tuple[str, str, str]] = []


def record(name: str, ok: bool, detail: str) -> None:
    status = "PASS" if ok else "FAIL"
    results.append((status, name, detail[:240]))
    print(f"[{status}] {name}: {detail[:240]}")


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=120.0, follow_redirects=False)

    # 1 Health
    try:
        r = client.get("/health")
        record("Health check", r.status_code == 200 and r.json().get("status") == "healthy", r.text)
    except Exception as e:
        record("Health check", False, str(e))

    # 2 Auth status
    try:
        r = client.get("/api/auth/status")
        data = r.json()
        record(
            "Auth status",
            r.status_code == 200 and data.get("password_auth") is True,
            json.dumps(data),
        )
    except Exception as e:
        record("Auth status", False, str(e))

    # 3 Login (seed account)
    try:
        r = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        record("Login seed account", r.status_code == 200, r.text)
    except Exception as e:
        record("Login seed account", False, str(e))

    # 4 Me
    try:
        r = client.get("/api/auth/me")
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        ok = r.status_code == 200 and (data.get("email") == EMAIL or data.get("user_id"))
        record("GET /auth/me", ok, r.text)
    except Exception as e:
        record("GET /auth/me", False, str(e))

    # 5 Dashboard stats
    try:
        r = client.get("/api/dashboard/stats")
        record("Dashboard stats", r.status_code == 200, r.text[:200])
    except Exception as e:
        record("Dashboard stats", False, str(e))

    # 6 Requirements list
    try:
        r = client.get("/api/requirements")
        record("List requirements", r.status_code == 200, f"count={len(r.json()) if r.status_code==200 else r.text}")
    except Exception as e:
        record("List requirements", False, str(e))

    # 7 AI: create requirement (kimi-k3 via backend) may be slow
    req_id = None
    try:
        t0 = time.time()
        r = client.post(
            "/api/requirements",
            json={
                "text": "As a user I can reset my password via email link within 15 minutes.",
                "instructions": "Generate a compact test suite (max 8 cases).",
            },
            timeout=300.0,
        )
        elapsed = time.time() - t0
        ok = r.status_code in (200, 201)
        if ok:
            body = r.json()
            req_id = body.get("id") or body.get("_id") or (body.get("requirement") or {}).get("id")
        record(
            "AI generate requirement tests (kimi-k3:cloud)",
            ok,
            f"status={r.status_code} {elapsed:.1f}s id={req_id} body={r.text[:180]}",
        )
    except Exception as e:
        record("AI generate requirement tests (kimi-k3:cloud)", False, str(e))

    # 8 Test cases list
    try:
        r = client.get("/api/test-cases")
        record("List test cases", r.status_code == 200, f"len={len(r.json()) if isinstance(r.json(), list) else r.text[:120]}")
    except Exception as e:
        record("List test cases", False, str(e))

    # 9 Synthetic data list
    try:
        r = client.get("/api/synthetic-data", params={"limit": 5})
        record("List synthetic data", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("List synthetic data", False, str(e))

    # 10 Prioritization list
    try:
        r = client.get("/api/prioritization")
        record("List prioritization", r.status_code in (200, 404), f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("List prioritization", False, str(e))

    # 11 Pipeline runs
    try:
        r = client.get("/api/pipeline/runs")
        record("Pipeline runs", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("Pipeline runs", False, str(e))

    # 12 Deployments health
    try:
        r = client.get("/api/deployments/health")
        record("Deployments health", r.status_code == 200, r.text[:200])
    except Exception as e:
        record("Deployments health", False, str(e))

    # 13 Root cause list
    try:
        r = client.get("/api/testing/root-cause")
        record("Root cause list", r.status_code == 200, r.text[:200])
    except Exception as e:
        record("Root cause list", False, str(e))

    # 14 Root cause failures
    try:
        r = client.get("/api/testing/root-cause/failures")
        record("Root cause unanalyzed failures", r.status_code == 200, r.text[:200])
    except Exception as e:
        record("Root cause unanalyzed failures", False, str(e))

    # 15 Test selection history
    try:
        r = client.get("/api/testing/test-selection/history")
        record("Test selection history", r.status_code == 200, r.text[:200])
    except Exception as e:
        record("Test selection history", False, str(e))

    # 16 Healing list
    try:
        r = client.get("/api/testing/healing")
        record("Self-healing list", r.status_code == 200, r.text[:220])
    except Exception as e:
        record("Self-healing list", False, str(e))

    # 17 Repo runs
    try:
        r = client.get("/api/repo/runs")
        record("Repo execution runs", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("Repo execution runs", False, str(e))

    # 18 Incidents list
    try:
        r = client.get("/api/incidents")
        record("Incidents list", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("Incidents list", False, str(e))

    # 19 Cost logs
    try:
        r = client.get("/api/cost-logs")
        record("Cost logs", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("Cost logs", False, str(e))

    # 20 GitHub repo info (may fail without token)
    try:
        r = client.get("/api/github/repo-info")
        record(
            "GitHub repo info",
            r.status_code in (200, 400, 401, 404, 500, 503),
            f"{r.status_code} {r.text[:160]}",
        )
    except Exception as e:
        record("GitHub repo info", False, str(e))

    # 21 Jira projects (expected fail if unconfigured)
    try:
        r = client.get("/api/jira/projects")
        record(
            "Jira projects",
            r.status_code in (200, 400, 401, 500, 503),
            f"{r.status_code} {r.text[:160]}",
        )
    except Exception as e:
        record("Jira projects", False, str(e))

    # 22 Monitoring simulate
    try:
        r = client.post("/api/monitoring/simulate-time-series", json={"baseline": 90, "days": 7})
        record("Monitoring simulate series", r.status_code == 200, r.text[:160])
    except Exception as e:
        record("Monitoring simulate series", False, str(e))

    # 23 Release gate evaluate (may need params)
    try:
        r = client.post("/api/release-gate/evaluate", json={})
        record(
            "Release gate evaluate",
            r.status_code in (200, 400, 422),
            f"{r.status_code} {r.text[:160]}",
        )
    except Exception as e:
        record("Release gate evaluate", False, str(e))

    # 24 Orgs current
    try:
        r = client.get("/api/orgs/current")
        record("Current organization", r.status_code in (200, 404), f"{r.status_code} {r.text[:160]}")
    except Exception as e:
        record("Current organization", False, str(e))

    # 25 Frontend proxy reachability
    try:
        fr = httpx.get("http://127.0.0.1:8081/", timeout=10.0)
        record("Frontend home (8081)", fr.status_code == 200, f"status={fr.status_code} len={len(fr.text)}")
    except Exception as e:
        record("Frontend home (8081)", False, str(e))

    # 26 Direct kimi model ping (infra)
    try:
        r = httpx.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "kimi-k3:cloud",
                "messages": [{"role": "user", "content": "Say READY"}],
                "stream": False,
            },
            timeout=90.0,
        )
        content = (r.json().get("message") or {}).get("content", "")
        record("Direct Ollama kimi-k3:cloud", r.status_code == 200 and len(content) > 0, content[:120])
    except Exception as e:
        record("Direct Ollama kimi-k3:cloud", False, str(e))

    # 27 Signup rejection / duplicate (should fail cleanly)
    try:
        r = client.post(
            "/api/auth/signup",
            json={"email": EMAIL, "password": PASSWORD, "name": "Dup"},
        )
        record(
            "Signup duplicate rejected",
            r.status_code in (400, 409, 422),
            f"{r.status_code} {r.text[:160]}",
        )
    except Exception as e:
        record("Signup duplicate rejected", False, str(e))

    # 28 Logout
    try:
        r = client.post("/api/auth/logout")
        record("Logout", r.status_code in (200, 204), f"{r.status_code} {r.text[:80]}")
    except Exception as e:
        record("Logout", False, str(e))

    # 29 Me after logout should be unauthorized
    try:
        r = client.get("/api/auth/me")
        record("Me after logout unauthorized", r.status_code in (401, 403), f"{r.status_code}")
    except Exception as e:
        record("Me after logout unauthorized", False, str(e))

    # 30 Wrong password rejected
    try:
        r = client.post("/api/auth/login", json={"email": EMAIL, "password": "wrong-password"})
        record("Wrong password rejected", r.status_code in (401, 403), f"{r.status_code} {r.text[:120]}")
    except Exception as e:
        record("Wrong password rejected", False, str(e))

    passed = sum(1 for s, _, _ in results if s == "PASS")
    failed = sum(1 for s, _, _ in results if s == "FAIL")
    print("\n======== SUMMARY ========")
    print(f"Total={len(results)} PASS={passed} FAIL={failed}")
    for s, name, detail in results:
        if s == "FAIL":
            print(f"  FAIL {name}: {detail}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
