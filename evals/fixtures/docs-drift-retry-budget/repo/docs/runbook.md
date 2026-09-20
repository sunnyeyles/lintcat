# Runbook — notify-worker

## The subscriber endpoint is flapping

Symptom: `delivery.attempts_exhausted` in the worker log, and subscribers
reporting missed notifications.

The worker gives each notification `NOTIFY_MAX_RETRIES` attempts, five by
default. A subscriber that recovers slowly will burn all five inside the first
twenty seconds and lose the message.

Raise the attempt count and restart the worker:

```bash
kubectl set env deployment/notify-worker NOTIFY_MAX_RETRIES=12
```

Twenty is the ceiling `loadConfig` accepts; anything higher fails the boot with
a `ConfigError`. Put the value back to `5` once the endpoint is healthy, and
remember that each extra attempt lengthens how long a bad endpoint occupies the
single delivery slot.

## The queue is backing up

Check `worker.started` for the queue URL, then the batch size in `src/queue.ts`.
Deliveries are serial, so one slow endpoint delays everything behind it.
