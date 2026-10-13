"""Write-through persistence for background job state.

A job's owner keeps the live state in memory and calls keep_flushed() for the
job's lifetime. The state is written to MongoDB when the job starts, about once
a second while it changes, and when it ends; every write also refreshes
`heartbeat_at`. Any process can then read the last state from MongoDB.

A job whose record says it is still active but whose heartbeat has stopped was
cut off by a restart of the process that owned it. Readers report it as failed
(see is_orphaned) instead of leaving it "running" forever. The heartbeat, not
"is it in this process's memory", is the test, so it is also correct when
several workers serve the same database.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

log = logging.getLogger("durable_state")

FLUSH_SECONDS = 1.0
# An unchanged job still writes a heartbeat this often.
HEARTBEAT_SECONDS = 5.0
STALE_AFTER_SECONDS = 30.0
INTERRUPTED_ERROR = "Interrupted by a server restart before it finished. Please start it again."


def now() -> datetime:
    return datetime.now(timezone.utc)


def is_orphaned(doc: dict[str, Any], active_statuses: tuple[str, ...] = ("pending", "running")) -> bool:
    """True when a stored job claims to be active but its owner stopped writing."""
    if doc.get("status") not in active_statuses:
        return False
    beat = doc.get("heartbeat_at")
    if not isinstance(beat, datetime):
        return True
    if beat.tzinfo is None:  # MongoDB returns naive UTC datetimes
        beat = beat.replace(tzinfo=timezone.utc)
    return now() - beat > timedelta(seconds=STALE_AFTER_SECONDS)


async def keep_flushed(
    write: Callable[[], Awaitable[None]],
    version: Callable[[], Any],
    stop: asyncio.Event,
) -> bool:
    """Call `write` whenever `version()` changes, and at least every HEARTBEAT_SECONDS, until `stop`.

    `write` persists the current state and its heartbeat. A failed write is
    logged and retried on the next tick; it never interrupts the job.
    Returns whether the final state (written after `stop`) was persisted.
    """
    last_version: Any = object()
    last_write = 0.0
    loop = asyncio.get_running_loop()
    while True:
        stopping = stop.is_set()
        current = version()
        written = False
        if stopping or current != last_version or loop.time() - last_write >= HEARTBEAT_SECONDS:
            try:
                await write()
                last_version = current
                last_write = loop.time()
                written = True
            except Exception as exc:
                log.warning("could not persist job state: %s", exc)
        if stopping:
            return written
        try:
            await asyncio.wait_for(stop.wait(), timeout=FLUSH_SECONDS)
        except asyncio.TimeoutError:
            pass
