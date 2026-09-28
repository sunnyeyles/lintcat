# Architecture

Requests flow one way: `src/routes` -> `src/services` -> `src/data` -> `src/db`.

- Routes parse the request and shape the response. They never import `src/data` or `src/db`.
- Services hold the business rules. A voided invoice is never shown to a customer.
- Data modules own every SQL query, and every query is scoped to the caller's tenant.
- Shared helpers live in `src/lib`. Check there before writing a new one.
