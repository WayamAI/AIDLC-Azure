import time
import httpx

BASE = "http://127.0.0.1:8001"
c = httpx.Client(base_url=BASE, timeout=300.0)
r = c.post("/api/auth/login", json={"email": "mriganka.dey@wayam.ai", "password": "wayam"})
print("login", r.status_code, r.text[:200])
t0 = time.time()
r = c.post(
    "/api/requirements",
    json={
        "text": "Password reset via email link expires in 15 minutes.",
        "instructions": "Max 5 test cases.",
    },
)
print("req", r.status_code, f"{time.time() - t0:.1f}s", r.text[:500])
