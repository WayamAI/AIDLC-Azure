"""
Probe public GitHub repos through the live AIDLC API and persist results
into org activity history (kind=repo_probe).

Usage:
  .venv\\Scripts\\python.exe scripts\\repo_probe_history.py --base http://127.0.0.1:8001
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

DEFAULT_REPOS = [
    ("fastapi", "fastapi"),
    ("encode", "httpx"),
    ("pallets", "flask"),
]

# Prefer seed accounts used by live_smoke.py
LOGIN_CANDIDATES = [
    ("mriganka.dey@wayam.ai", "wayam"),
    ("mriganka.dey@wayam.ai", "wayam"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8001")
    parser.add_argument("--email")
    parser.add_argument("--password")
    args = parser.parse_args()

    report: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "base": args.base,
        "probes": [],
        "history_after": [],
    }

    client = httpx.Client(base_url=args.base, timeout=90.0, follow_redirects=False)

    for path in ("/health", "/ready"):
        try:
            r = client.get(path)
            print(f"[{r.status_code}] {path}: {r.text[:240]}")
        except Exception as exc:
            print(f"[ERR] {path}: {exc}")
            if path == "/health":
                return 1

    logged_in = False
    candidates = (
        [(args.email, args.password)]
        if args.email and args.password
        else LOGIN_CANDIDATES
    )
    for email, password in candidates:
        if not email:
            continue
        r = client.post("/api/auth/login", json={"email": email, "password": password})
        print(f"[{r.status_code}] login {email}: {r.text[:160]}")
        if r.status_code == 200:
            logged_in = True
            break
    if not logged_in:
        print("Login failed cannot probe authenticated GitHub routes.")
        return 1

    for owner, repo in DEFAULT_REPOS:
        entry: dict = {"owner": owner, "repo": repo, "ok": False}
        t0 = time.time()
        try:
            info = client.get("/api/github/repo-info", params={"owner": owner, "repo": repo})
            commits = client.get(
                "/api/github/commits",
                params={"owner": owner, "repo": repo, "since_days": 30},
            )
            prs = client.get(
                "/api/github/prs",
                params={"owner": owner, "repo": repo, "per_page": 5},
            )
            elapsed = round(time.time() - t0, 2)
            info_json = info.json() if "json" in info.headers.get("content-type", "") else {}
            commits_json = commits.json() if commits.status_code == 200 else []
            prs_json = prs.json() if prs.status_code == 200 else []

            summary = {
                "repo_info_status": info.status_code,
                "full_name": info_json.get("full_name") or info_json.get("name"),
                "stars": info_json.get("stargazers_count") or info_json.get("stars"),
                "default_branch": info_json.get("default_branch"),
                "language": info_json.get("language"),
                "commits_status": commits.status_code,
                "commits_count": len(commits_json) if isinstance(commits_json, list) else None,
                "prs_status": prs.status_code,
                "open_prs": len(prs_json) if isinstance(prs_json, list) else None,
                "elapsed_s": elapsed,
                "error": None if info.status_code == 200 else (info.text[:200] if info.text else None),
            }
            ok = info.status_code == 200
            entry.update({"ok": ok, "summary": summary})

            hist = client.post(
                "/api/activity/history",
                json={
                    "kind": "repo_probe",
                    "title": f"Repo probe {owner}/{repo}",
                    "url": f"https://github.com/{owner}/{repo}",
                    "section": "GitHub",
                    "payload": summary,
                },
            )
            entry["history_status"] = hist.status_code
            print(
                f"[{'PASS' if ok else 'FAIL'}] {owner}/{repo} "
                f"info={info.status_code} commits={commits.status_code} "
                f"prs={prs.status_code} history={hist.status_code} ({elapsed}s) "
                f"stars={summary.get('stars')} language={summary.get('language')}"
            )
        except Exception as exc:
            entry["error"] = str(exc)
            print(f"[FAIL] {owner}/{repo}: {exc}")
        report["probes"].append(entry)

    h = client.get("/api/activity/history", params={"kind": "repo_probe", "limit": 20})
    print(f"[{h.status_code}] activity history: {h.text[:500]}")
    if h.status_code == 200:
        body = h.json()
        report["history_after"] = body.get("items", body)

    out_dir = Path(__file__).resolve().parents[1] / "reports"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = out_dir / f"repo_probe_{stamp}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}")

    passed = sum(1 for p in report["probes"] if p.get("ok"))
    print(
        f"Summary: {passed}/{len(report['probes'])} repo probes OK; "
        f"history items={len(report['history_after'])}"
    )
    return 0 if passed == len(report["probes"]) else 2


if __name__ == "__main__":
    sys.exit(main())
