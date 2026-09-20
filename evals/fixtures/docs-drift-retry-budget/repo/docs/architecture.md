# Architecture

`runWorker` reads configuration once, then loops forever: `receiveBatch` pulls
at most ten notifications, and each one goes through `sendNotification`.

Delivery is serial on purpose. The worker is scaled by running more replicas,
not by adding concurrency inside one, so a single notification's retry
behaviour decides how long one bad endpoint can block a replica.
