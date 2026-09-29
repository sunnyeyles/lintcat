# Working on billing-api

Read ARCHITECTURE.md for how a request flows. These are the house rules on top of it.

## Services

- Every data and service function takes the caller's `RequestContext` first.
- A service reports a record the caller may not see — missing, voided, or another tenant's — by throwing `HttpError(404, ...)`. It never returns `undefined` for a route to check.
- Routes never set an error status themselves: a thrown `HttpError` becomes the response.

## Money

- Amounts are integer cents in a field named `amountCents`.
- Format an amount for display only in a route, with `formatMoney` from `src/lib/money.ts`.
