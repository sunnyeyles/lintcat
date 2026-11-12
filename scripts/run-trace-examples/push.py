#!/usr/bin/env python3
"""Emits and pushes a lintcat run format stream: RUN_TRACE_URL=... RUN_TRACE_TOKEN=... python3 push.py"""
import json
import os
import time
import urllib.request
from datetime import datetime, timezone

URL = os.environ["RUN_TRACE_URL"]
TOKEN = os.environ["RUN_TRACE_TOKEN"]
RUN_ID = f"demo-py-{int(time.time())}"
events: list[str] = []


def emit(**event: object) -> None:
    at = datetime.now(timezone.utc).isoformat()
    events.append(json.dumps({"v": 1, "at": at, **event}))
    body = json.dumps({"format": "lintcat", "files": [{"name": "run.ndjson", "text": "\n".join(events)}]})
    request = urllib.request.Request(
        f"{URL}/api/run-trace/{RUN_ID}",
        data=body.encode(),
        method="POST",
        headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/json"},
    )
    urllib.request.urlopen(request, timeout=30).read()


emit(type="run_started", run=RUN_ID, title="Python demo")
emit(type="agent_started", agent="main", role="worker", prompt="Count the files")
emit(type="event", agent="main", name="ls", category="command", status="ok", text="$ ls | wc -l", durationMs=12)
emit(type="step", agent="main", kind="text", text="There are 12 files.")
emit(type="agent_finished", agent="main", status="done")
emit(type="run_finished", status="delivered")
print(f"{URL}/dev/run-trace/{RUN_ID}")
