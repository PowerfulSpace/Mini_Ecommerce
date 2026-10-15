# ADR-002: Checkout Idempotency

- **Status:** Accepted, amended on 2026-10-15 (bounded wait, `503` temporary response, on-demand recovery, key format and fingerprint definition, cart version transmitted through `If-Match`)
- **Date:** 2026-10-15

## Context

Checkout creates an order, deducts product stock, and clears the current user's cart. Clients may retry a request when a network failure or timeout leaves them uncertain whether the operation completed.

Without idempotency, a retry could create a duplicate order or deduct stock more than once.

The system must also handle:

- Concurrent requests using the same key.
- Reuse of a key with a different request.
- Business validation failures.
- Unexpected infrastructure errors.
- Database commits whose outcome is temporarily uncertain.
- Attempts that remain in progress after a process failure.

The MVP uses SQL Server and EF Core. Checkout must preserve atomicity across order creation, stock deduction, cart clearing, the cart-row version change, and successful idempotency completion.

## Decision

`POST /api/orders` requires an `Idempotency-Key` header and an `If-Match` header carrying the cart `ETag`.

The idempotency mechanism follows a hybrid strategy:

1. Reserve the key in a short, separate transaction.
2. Execute checkout in a transaction that atomically commits the order, stock deductions, cart clearing, the cart-row version change, and the successful idempotency result.
3. If checkout ends with a final business error, roll back the checkout transaction and persist the final error response in a separate transaction.
4. Do not persist unexpected infrastructure errors as final business results.
5. Recover stale `InProgress` records on demand, only after a lease has expired and durable database state has been verified. No background recovery service is used.

## Key scope and request fingerprint

An idempotency key is unique within the authenticated user's scope.

The key must match the format defined in `../DECISIONS.md` section 10. An invalid key is rejected as a request validation failure before any reservation is made.

The request fingerprint covers the semantically relevant content of the checkout request:

```text
fingerprint = SHA-256( "POST /api/orders" + "\n" + <submitted If-Match value> )
```

The MVP checkout request body is empty, so the submitted cart `ETag` is the only request-specific value. The same key and the same fingerprint represent the same checkout attempt. The same key with a different fingerprint is a conflict, including when the client retries with a newer cart version.

The fingerprint is stored as Base64-encoded SHA-256 output. The comparison of a stored and an incoming fingerprint is exact.

The key and fingerprint must be stored durably. A database uniqueness constraint on `(UserId, IdempotencyKey)` must prevent two concurrent requests from reserving the same user/key pair.

## Required request-processing order

The server must check for an existing idempotency record **before reading the current cart**.

The order of operations is:

1. Authenticate the request and resolve the current user.
2. Validate the `Idempotency-Key` header and the `If-Match` header.
3. Calculate the request fingerprint.
4. Look up the idempotency record for the current user and key.
5. If a record exists, compare its stored fingerprint with the incoming fingerprint.
6. If the fingerprint differs, return `409 Conflict` with code `idempotency_key_reused`.
7. If the matching record is completed, return its saved HTTP status and response body without reading the current cart or executing checkout again.
8. If the matching record is in progress, follow the in-progress wait and recovery policy.
9. If no record exists, reserve the key in a short transaction and create an `InProgress` record.
10. Only after successful reservation, start checkout and read the cart under the cart-locking strategy.

If two requests race to reserve the same key, the database uniqueness constraint determines the winner. The losing request must re-read the existing record and follow the same fingerprint and state rules. It must not start an independent checkout.

## Idempotency record lifecycle

An idempotency record contains the durable information needed to identify and safely recover an attempt:

- User scope.
- Idempotency key.
- Request fingerprint.
- Processing state.
- Creation and update timestamps.
- Lease expiry used by on-demand recovery.
- Saved HTTP status and response body for a completed attempt.
- Optional link to the created order.

The exact table and column definitions belong in `../architecture/data-model.md`.

The logical states are:

- `InProgress` — the attempt has been reserved and has not yet reached a durable final result.
- `Completed` — a final response has been stored and must be replayed for a matching retry.

`Completed` covers both successful checkout responses and final business-error responses. Final business errors are not represented by a separate state; they are distinguished by the stored `ResponseStatusCode`.

Unexpected infrastructure errors must not be recorded as definitive business failures. The record remains `InProgress` while the outcome is being safely resolved.

## Successful checkout

The successful checkout transaction must atomically:

1. Validate the submitted `If-Match` value.
2. Read and validate the cart while holding the required cart-row lock.
3. Validate product activity and stock requirements.
4. Deduct all required stock using atomic conditional updates.
5. Read the product names and prices used for the order-item snapshots while the product rows are locked.
6. Create the order and order-item snapshots.
7. Clear cart items.
8. Change the cart row, for example by updating `UpdatedAtUtc`, so that its `rowversion` changes.
9. Store the final successful HTTP status and response body.
10. Change the idempotency record to `Completed`.
11. Commit.

If the transaction commits, a retry with the same user, key, and fingerprint returns the saved result. It must not create another order or deduct stock again.

If the transaction rolls back, its order creation, stock deductions, cart changes, cart-row version change, and successful idempotency completion are all rolled back together.

## Final business errors

Examples of final business errors include:

- Empty cart.
- Stale cart version (`412 Precondition Failed`).
- Missing `If-Match` on an otherwise valid request (`428 Precondition Required`).
- Inactive product in the cart.
- Insufficient stock.
- Cart not found.
- Other defined business-state conflicts.

When checkout produces a final business error:

1. Roll back the checkout transaction.
2. Start a separate transaction.
3. Persist the final HTTP status and response body for the reserved key.
4. Mark the idempotency record `Completed`.
5. Commit the error result.

A retry using the same key and the same fingerprint receives the same saved business-error result, even if the cart or stock later changes.

To make another checkout attempt after changing the cart or resolving a business error, the client must use a new idempotency key and submit the appropriate current cart `ETag`.

If persisting the final error fails because of an infrastructure problem, the server must not pretend that the error was durably recorded. The record remains subject to on-demand recovery and durable-state verification.

## Unexpected infrastructure errors

Unexpected infrastructure errors include database connectivity failures, process failures, and other errors that prevent the server from establishing a definitive business outcome.

Such errors must not be stored as final business results.

The server must not infer that checkout failed solely because it did not receive a successful database response. In particular, a connection failure during commit may leave the transaction outcome uncertain.

When the outcome is uncertain:

- The client retries with the same idempotency key and identical request.
- The server checks the existing idempotency record before reading the cart.
- The server verifies durable state before determining whether the attempt completed or can safely be retried.
- The server does not independently execute another checkout while the original outcome remains unresolved.
- If the outcome cannot be established safely, the server returns a temporary error and does not claim that no order exists.

## Concurrent requests with the same key

Concurrent requests with the same user, key, and fingerprint must result in at most one checkout execution.

The first request reserves the key. Other requests must observe the durable record and follow its state.

For a matching `InProgress` record, the server waits for the active attempt for a bounded period defined in `../DECISIONS.md` section 10. If the record still has no final result when that period expires, the server returns `503 Service Unavailable` with code `idempotency_in_progress` and instructs the client to retry the same key and the same request.

The API must not require the client to generate a new key merely because a matching attempt is still in progress.

If the request differs, the server returns `409 Conflict` with code `idempotency_key_reused`, regardless of whether the original record is in progress or completed.

## On-demand lease recovery

An `InProgress` record may outlive the process that created it. The system must not treat every old record as proof that checkout failed. No background recovery worker exists in the MVP; recovery is performed on demand when a later request arrives for the same key.

A retry may start recovery only when both conditions hold:

1. The lease of the `InProgress` record has expired, using the lease duration defined in `../DECISIONS.md` section 10.
2. Durable database state has been checked to determine whether the checkout transaction committed, rolled back, or remains unresolved.

Recovery ownership is claimed atomically with a conditional update that only succeeds when the record is still `InProgress` and its lease is expired, for example:

```sql
UPDATE CheckoutAttempts
SET LeaseExpiresAtUtc = DATEADD(second, @LeaseSeconds, SYSUTCDATETIME()),
    UpdatedAtUtc = SYSUTCDATETIME()
WHERE Id = @Id AND Status = 'InProgress' AND LeaseExpiresAtUtc < SYSUTCDATETIME()
```

Only the request that affects one row owns the recovery attempt. Every other concurrent request follows the in-progress wait policy instead.

The correlation between the attempt and durable checkout state uses the order link stored on the record, when present, and the presence of an order created within the attempt.

Possible outcomes:

- **Checkout committed:** reconstruct or use the stored final response and mark the record completed consistently.
- **Checkout rolled back and no successful result exists:** the attempt may resume checkout under the claimed lease.
- **Outcome remains uncertain:** keep the attempt unresolved and return a temporary response. Do not start an independent checkout.

Recovery must never create a second order or deduct stock twice.

Records are kept for the lifetime of the MVP without automatic cleanup, as defined in `../DECISIONS.md` section 10.

## Transaction boundaries

The reservation transaction is separate and short-lived. It creates the durable `InProgress` record and commits before checkout begins.

The successful checkout transaction includes:

- Cart validation and changes.
- The cart-row version change.
- Stock deductions.
- Order and order-item creation.
- Cart clearing.
- Successful idempotency completion.

The final business-error transaction runs only after the failed checkout transaction has rolled back. It persists the final business response and marks the record completed.

This design prevents a successful order from committing without its corresponding successful idempotency result, while allowing final business errors to be saved even though the checkout transaction rolled back.

## HTTP behavior

| Situation | Response behavior |
|---|---|
| New key, successful checkout | `201 Created`; save and return the result |
| Existing key, matching completed request | Replay saved status and body |
| Existing key, different request | `409 Conflict`, `idempotency_key_reused` |
| Existing matching request still in progress, bounded wait exceeded | `503 Service Unavailable`, `idempotency_in_progress`; retry same key |
| Final business error | Persist and replay the final error response |
| Unexpected infrastructure error | Do not persist as a final business result |
| Commit outcome uncertain | Verify durable state; otherwise return a temporary error |
| Lease expired, durable state committed | Complete the record from durable state |
| Lease expired, durable state rolled back | Resume the attempt under the claimed lease |

The response for a completed request must be consistent with the original saved response. The implementation must not generate a new order identifier or substitute a new result during replay.

## Consequences

### Benefits

- Network retries do not create duplicate orders.
- Concurrent requests using the same key cannot independently execute checkout.
- Reusing a key for different request content is detected.
- Final business failures have deterministic retry behavior.
- Infrastructure failures are not falsely presented as definitive business outcomes.
- Recovery can distinguish a committed checkout from a rolled-back attempt without a background service.

### Trade-offs

- The system requires durable idempotency storage and uniqueness constraints.
- Successful checkout and idempotency completion must share a transaction.
- Final business errors require a separate persistence transaction.
- On-demand recovery requires leases, a conditional claim update, and verification of durable state.
- A client that retries during an active attempt may receive `503` before a final result is available.

## Implementation requirements

- Require `Idempotency-Key` and `If-Match` for `POST /api/orders`.
- Validate the key format defined in `../DECISIONS.md` section 10.
- Scope keys to the authenticated user and enforce uniqueness for the user/key pair in the database.
- Fingerprint the request from the request target and the submitted `If-Match` value.
- Check an existing key before reading the current cart.
- Reserve new keys in a separate short transaction.
- Commit successful checkout, the cart-row version change, and idempotency completion atomically.
- Persist final business errors only after the checkout transaction rolls back.
- Do not persist unexpected infrastructure errors as final business results.
- Wait for a bounded period for a matching in-progress attempt, then return `503` with `idempotency_in_progress`.
- Implement on-demand lease-based recovery with an atomic claim and durable-state verification; do not add a background recovery service.
- Ensure concurrent requests and recovery cannot execute the same checkout independently.
- Add SQL Server integration tests for duplicate requests, mismatched requests, concurrent reservations, business-error replay, bounded wait and `503`, uncertain outcomes, and recovery after an abandoned `InProgress` record.
