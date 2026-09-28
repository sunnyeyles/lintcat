# notify-worker

Polls the notification queue and POSTs each message to the subscriber's
endpoint. One process, no database.

## Running it

```bash
NOTIFY_QUEUE_URL=https://queue.internal/notifications \
NOTIFY_MAX_RETRIES=5 \
  node dist/main.js
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOTIFY_QUEUE_URL` | — | Queue the worker polls. Required. |
| `NOTIFY_MAX_RETRIES` | `5` | How many delivery attempts one notification gets before it is dropped. Must be a positive whole number, at most 20. |

## Delivery

A notification is retried with a doubling, capped backoff until its
`NOTIFY_MAX_RETRIES` attempts are used up. Then it is dropped and
`delivery.attempts_exhausted` is logged.
