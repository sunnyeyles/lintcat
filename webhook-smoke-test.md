# Webhook smoke test

Temporary file to trigger a `pull_request.opened` webhook delivery for testing.

Repush to trigger `pull_request.synchronize`.

Second repush attempt.

Third repush, tailing Vercel logs live to catch the 500.

Fourth repush, streaming with --follow this time.

Fifth repush, verifying the fix after adding WORKER_PING_SECRET and redeploying.
