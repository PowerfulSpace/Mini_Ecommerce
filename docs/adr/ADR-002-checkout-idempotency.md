# ADR-002: Checkout Idempotency

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Checkout creates an order, deducts product stock, and clears the current user's cart. Clients may retry a request when a network failure or timeout leaves them uncertain whether the operation completed.

Without idempotency, a retry could create a duplicate order or deduct stock more than once.

The system must also handle:

- Concurrent requests using the same key.
- Reuse of a key with a different request body.
- Business validation failures.
- Unexpected infrastructure errors.
- Database commits whose outcome is temporarily uncertain.
- Attempts that remain in progress after a process failure.

The MVP uses SQL Server and EF Core. Checkout must preserve atomicity across order creation, stock deduction, cart clearing, and successful idempotency completion.

## Decision

`POST /api/orders` requires an `Idempotency-Key` header.

The idempotency mechanism follows a hybrid strategy:

1. Reserve the key in a short, separate transaction.
2. Execute checkout in a transaction that atomically commits the order, stock deductions, cart clearing, and successful idempotency result.
3. If checkout ends with a final business error, roll back the checkout transaction and persist the final error response in a separate transaction.
4. Do not persist unexpected infrastructure errors as final business results.
5. Recover stale `InProgress` records only after a lease or timeout has expired and durable database state has been verified.

## Key scope and request fingerprint

An idempotency key is unique within the authenticated user's scope.

The key is associated with a fingerprint of the checkout request body. The API request includes the cart `version` that the client intends to check out.

The same key and same request body represent the same checkout attempt. The same key with a different request body is a conflict.

The fingerprint must be calculated consistently. Semantically equivalent request bodies should produce the same fingerprint when the API contract defines them as equivalent. The implementation must not rely on raw JSON property order unless that is an explicit part of the contract.

The key and fingerprint must be stored durably. A database uniqueness constraint must prevent two concurrent requests from reserving the same user/key pair.

## Required request-processing order

The server must check for an existing idempotency record **before reading the current cart**.

The order of operations is:

1. Authenticate the request and resolve the current user.
2. Validate the `Idempotency-Key` header and request structure.
3. Calculate the request fingerprint.
4. Look up the idempotency record for the current user and key.
5. If a record exists, compare its stored fingerprint with the incoming fingerprint.
6. If the fingerprint differs, return `409 Conflict` with code `idempotency_key_reused`.
7. If the matching record is completed, return its saved HTTP status and response body without reading the current cart or executing checkout again.
8. If the matching record is in progress, follow the in-progress response and recovery policy.
9. If no record exists, reserve the key in a short transaction and create an `InProgress` record.
10. Only after successful reservation, start checkout and read the cart under the cart-locking strategy.

If two requests race to reserve the same key, the database uniqueness constraint determines the winner. The losing request must re-read the existing record and follow the same fingerprint and state rules. It must not start an independent checkout.

## Idempotency record lifecycle

An idempotency record must contain enough durable information to identify and safely recover an attempt. At minimum, it needs:

- User scope.
- Idempotency key.
- Request fingerprint.
- Processing state.
- Creation and update timestamps.
- Lease or processing-ownership information for recovery.
- Saved HTTP status and response body for a completed attempt.

The exact table and column definitions belong in the data-model and Infrastructure implementation.

The logical states are:

- `InProgress` — the attempt has been reserved and has not yet reached a durable final result.
- `Completed` — a final response has been stored and must be replayed for a matching retry.

`Completed` includes both successful checkout responses and final business-error responses.

Unexpected infrastructure errors must not be recorded as definitive business failures. The record may remain `InProgress` while the outcome is being safely resolved.

## Successful checkout

The successful checkout transaction must atomically:

1. Validate the submitted cart version.
2. Read and validate the cart while holding the required cart-row lock.
3. Validate product activity and stock requirements.
4. Deduct all required stock using atomic conditional updates.
5. Create the order and order-item snapshots.
6. Clear cart items.
7. Store the final successful HTTP status and response body.
8. Change the idempotency record to `Completed`.
9. Commit.

If the transaction commits, a retry with the same user, key, and request fingerprint returns the saved result. It must not create another order or deduct stock again.

If the transaction rolls back, its order creation, stock deductions, cart changes, and successful idempotency completion are all rolled back together.

## Final business errors

Examples of final business errors include:

- Empty cart.
- Stale cart version.
- Inactive product in the cart.
- Insufficient stock.
- Other defined business-state conflicts.

When checkout produces a final business error:

1. Roll back the checkout transaction.
2. Start a separate transaction.
3. Persist the final HTTP status and response body for the reserved key.
4. Mark the idempotency record `Completed`.
5. Commit the error result.

A retry using the same key and same request body receives the same saved business-error result, even if the cart or stock later changes.

To make another checkout attempt after changing the cart or resolving a business error, the client must use a new idempotency key and submit the appropriate current cart version.

If persisting the final error fails because of an infrastructure problem, the server must not pretend that the error was durably recorded. The record remains subject to safe recovery and durable-state verification.

## Unexpected infrastructure errors

Unexpected infrastructure errors include database connectivity failures, process failures, and other errors that prevent the server from establishing a definitive business outcome.

Such errors must not be stored as final business results.

The server must not infer that checkout failed solely because it did not receive a successful database response. In particular, a connection failure during commit may leave the transaction outcome uncertain.

When the outcome is uncertain:

- The client retries with the same idempotency key and identical request body.
- The server checks the existing idempotency record before reading the cart.
- The server verifies durable state before determining whether the attempt completed or can safely be retried.
- The server does not independently execute another checkout while the original outcome remains unresolved.
- If the outcome cannot be established safely, the server returns a temporary error and does not claim that no order exists.

## Concurrent requests with the same key

Concurrent requests with the same user, key, and request fingerprint must result in at most one checkout execution.

The first request reserves the key. Other requests must observe the durable record and follow its state.

For a matching `InProgress` record, the server may wait for the active attempt for a bounded period. If it cannot safely return a final result within that period, it returns a temporary response with code `idempotency_in_progress` and instructs the client to retry the same key and body.

The API must not require the client to generate a new key merely because a matching attempt is still in progress.

If the request body differs, the server returns `409 Conflict` with code `idempotency_key_reused`, regardless of whether the original record is in progress or completed.

## Lease and timeout recovery

An `InProgress` record may outlive the process that created it. The system must not treat every old record as proof that checkout failed.

Recovery requires both:

1. The processing lease or timeout has expired.
2. Durable database state has been checked to determine whether the checkout transaction committed, rolled back, or remains unresolved.

The recovery process must be safe when multiple workers attempt recovery concurrently. Recovery ownership or state transitions must be protected by database concurrency controls.

Possible outcomes:

- **Checkout committed:** recover or reconstruct the saved final response from durable state and mark the record completed consistently.
- **Checkout rolled back and no successful result exists:** permit the same attempt to resume safely after acquiring recovery ownership.
- **Outcome remains uncertain:** keep the attempt unresolved and return a temporary response. Do not start an independent checkout.

Recovery must never create a second order or deduct stock twice. The implementation must document how it correlates the idempotency record with durable checkout state and how it prevents concurrent recovery workers from claiming the same attempt.

## Transaction boundaries

The reservation transaction is separate and short-lived. It creates the durable `InProgress` record and commits before checkout begins.

The successful checkout transaction includes:

- Cart validation and changes.
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
| Existing key, different request body | `409 Conflict`, `idempotency_key_reused` |
| Existing matching request still in progress | Temporary response, `idempotency_in_progress`; retry same key |
| Final business error | Persist and replay the final error response |
| Unexpected infrastructure error | Do not persist as a final business result |
| Commit outcome uncertain | Verify durable state; otherwise return a temporary error |

The response for a completed request must be consistent with the original saved response. The implementation must not generate a new order identifier or substitute a new result during replay.

## Consequences

### Benefits

- Network retries do not create duplicate orders.
- Concurrent requests using the same key cannot independently execute checkout.
- Reusing a key for different request content is detected.
- Final business failures have deterministic retry behavior.
- Infrastructure failures are not falsely presented as definitive business outcomes.
- Recovery can distinguish a committed checkout from a rolled-back attempt.

### Trade-offs

- The system requires durable idempotency storage and uniqueness constraints.
- Successful checkout and idempotency completion must share a transaction.
- Final business errors require a separate persistence transaction.
- Recovery requires leases, concurrency controls, and verification of durable state.
- The implementation must handle uncertain commits carefully.

## Implementation requirements

- Require `Idempotency-Key` for `POST /api/orders`.
- Scope keys to the authenticated user.
- Fingerprint the request body consistently.
- Check an existing key before reading the current cart.
- Reserve new keys in a separate short transaction.
- Enforce uniqueness for the user/key pair in the database.
- Commit successful checkout and idempotency completion atomically.
- Persist final business errors only after the checkout transaction rolls back.
- Do not persist unexpected infrastructure errors as final business results.
- Implement lease/timeout-based recovery with durable-state verification.
- Ensure concurrent requests and recovery workers cannot execute the same checkout independently.
- Add SQL Server integration tests for duplicate requests, mismatched bodies, concurrent reservations, business-error replay, uncertain outcomes, and recovery after an abandoned `InProgress` record.