# ADR-001: Cart Concurrency and Locking Strategy

- **Status:** Accepted, amended on 2026-10-15 (cart version transport moved to `ETag`/`If-Match`, stale-version status changed from `409` to `412`, checkout is required to change the cart row)
- **Date:** 2026-10-15

## Context

The Mini E-commerce MVP has at most one cart per user. Multiple requests may attempt to modify the same cart concurrently. Checkout also reads and modifies the cart while validating products, deducting stock, creating an order, and clearing cart items.

Without an explicit concurrency strategy, the system may encounter:

- Lost cart updates.
- Checkout using an inconsistent cart state.
- A cart update restoring old items after checkout.
- Duplicate or inconsistent stock deductions.
- Partial business operations when concurrent requests fail.

The application uses SQL Server and Entity Framework Core. The strategy must work with SQL Server transaction semantics and must not rely on EF Core LINQ implicitly providing a specific row-locking hint.

## Decision

Use a combination of:

1. A database transaction for every cart mutation and checkout.
2. An explicit lock on the persistent cart row for the duration of the transaction.
3. SQL Server `rowversion` exposed to clients as the cart `ETag` and submitted back through `If-Match`.
4. Atomic conditional stock updates for inventory protection.
5. A consistent lock acquisition order to reduce deadlocks.

The cart-row lock and the API version serve different purposes and are both required.

## Cart-row locking

Every cart mutation and checkout must:

1. Begin a database transaction.
2. Acquire an update lock on the current user's cart row using SQL Server `UPDLOCK`, or an equivalent explicit mechanism with the required semantics.
3. Read and validate the cart state while holding the lock.
4. Perform the required changes.
5. Commit or roll back the transaction.

The lock must remain held until the transaction finishes.

The implementation must not assume that a normal EF Core LINQ query automatically acquires `UPDLOCK`. Use an explicit SQL or database access mechanism and document it in the Infrastructure implementation.

The cart row must exist before the operation attempts to lock it. Carts are created lazily by `GET /api/cart`, protected by a unique constraint on `Cart.UserId`. A concurrent creation attempt is resolved by catching the unique-constraint violation and re-reading the winning row.

## Cart version through ETag and If-Match

The cart's SQL Server `rowversion` is returned to clients as an HTTP `ETag` on every cart representation. The value is the Base64 encoding of the 8-byte `rowversion`, always sent as a quoted strong entity-tag.

Clients must submit the received `ETag` value in the `If-Match` header of every cart mutation and of checkout. The operations that require `If-Match` are:

- `POST /api/cart/items`
- `PUT /api/cart/items/{productId}`
- `DELETE /api/cart/items/{productId}`
- `POST /api/orders`

Order cancellation does not use `If-Match`; it is protected by a conditional order-status transition instead.

Rules:

- A missing required `If-Match` returns `428 Precondition Required` with code `precondition_required`. A single concrete entity-tag is required; `If-Match: *` is not supported and is rejected as an invalid request.
- The application compares the submitted value with the current `rowversion` while operating under the cart transaction and lock.
- A stale value returns `412 Precondition Failed` with the error code `cart_version_conflict`. The operation is not applied and is not automatically replayed against the newer cart state.
- A successful cart mutation returns the updated cart and its new `ETag`.

`rowversion` is an additional stale-state check. It does not change the cart-row lock. The lock serializes concurrent operations; the version detects requests based on an outdated view of the cart.

This amends the earlier contract, in which the version was a request-body field named `version` and a stale value returned `409 Conflict`. The `code` value `cart_version_conflict` is unchanged so that existing client error handling remains meaningful; only the transport and the HTTP status changed.

## Cart mutation behavior

All cart mutations must validate the complete operation before committing changes.

- Adding an existing product increases its quantity.
- Requested quantities must be positive integers.
- Inactive products cannot be added or updated.
- Requested quantities cannot exceed available stock.
- A failed mutation must not partially change the cart.
- Removing an inactive product is allowed.

The implementation must preserve these rules when requests arrive concurrently.

## Checkout behavior

Checkout acquires the cart-row lock before reading and validating the current cart, but only after the idempotency layer has checked whether the submitted key already has a saved result or an active attempt.

For a new checkout attempt, the transaction remains active while the application:

1. Validates the submitted `If-Match` value against the current cart version.
2. Reads the cart and its items.
3. Validates product activity and requested quantities.
4. Deducts stock using atomic conditional updates, acquiring product rows in a stable order by `ProductId`.
5. Reads the product names and prices used for order-item snapshots while the product rows are still locked by those updates.
6. Creates the order and order-item snapshots.
7. Clears the cart items.
8. Updates the cart row, for example by setting `UpdatedAtUtc`, so that its `rowversion` changes.
9. Marks the idempotency record completed as part of the successful checkout transaction.
10. Commits.

Order creation, stock deduction, cart clearing, the cart-row version change, and successful idempotency completion must commit atomically.

Step 8 is mandatory. Deleting `CartItem` rows does not modify the `Cart` row, so without an explicit cart-row update the previously issued `ETag` would remain valid after checkout and a stale mutation could succeed against an emptied cart.

If validation or a stock update fails, the checkout transaction rolls back. No order is created, stock deductions are undone, and the cart remains unchanged.

Final business-error responses, including `cart_version_conflict`, are persisted by the idempotency mechanism after the failed checkout transaction has rolled back. Unexpected infrastructure errors are not persisted as final business results.

## Cart update versus checkout

A cart update and checkout for the same user must be serialized by the cart-row lock.

### Update acquires the lock first

The update validates and applies its changes, then commits. Checkout acquires the lock afterward and evaluates the resulting cart state.

Checkout may still fail with `412 Precondition Failed` if the version submitted by the client is stale. The client must fetch the current cart and initiate a new checkout attempt with a new idempotency key.

### Checkout acquires the lock first

Checkout validates the cart, creates the order, deducts stock, clears the cart items, changes the cart row, and commits. A waiting cart mutation then acquires the lock.

Because checkout changed the cart row, the waiting mutation's `If-Match` value no longer matches the current `rowversion`, and the mutation fails with `412 Precondition Failed`. It must not restore items from the pre-checkout cart.

This rule prevents a stale cart update from resurrecting items after a successful checkout.

## Inventory concurrency

The cart-row lock protects one user's cart. It does not protect product stock shared by different users.

Inventory deductions must therefore use atomic conditional database updates that only succeed when the product has at least the requested quantity in stock, for example:

```sql
UPDATE Products
SET StockQuantity = StockQuantity - @Quantity
WHERE Id = @ProductId AND StockQuantity >= @Quantity
```

The application must check the number of affected rows. A failed conditional update means the stock requirement was not satisfied at the time of the update.

All stock deductions for one checkout belong to the same transaction. If any deduction fails, the entire checkout transaction rolls back.

Insufficient-stock responses identify every affected product after the failed transaction has rolled back, using a separate read of the current stock. The list is informational and does not imply that stock remains reserved.

## Lock ordering and deadlocks

When an operation needs to lock multiple product rows, it must acquire them in a stable order, preferably by `ProductId`.

The MVP does not retry deadlocks automatically inside the process. A deadlock victim's transaction is rolled back and the request fails. The client retries checkout with the same idempotency key and request, or refetches the cart before a new mutation. A retry must re-read and revalidate the relevant state and must never create a separate checkout attempt.

## Transaction boundaries and isolation

The following operations must be atomic:

- A single cart mutation and its version update.
- Checkout order creation, all stock deductions, cart clearing, the cart-row version change, and successful idempotency completion.
- Order cancellation, status transition, and all stock restoration.

The MVP runs these transactions at SQL Server `READ COMMITTED`, the database default, and relies on explicit `UPDLOCK` hints, conditional updates with affected-row checks, and stable lock ordering instead of a stronger isolation level. This is a recommendation for the MVP, not a claim that a specific level is already implemented.

For cancellation, the database must ensure that only one concurrent request can perform the `Created` to `Cancelled` transition and restore stock, using a conditional update such as `UPDATE Orders SET Status = 'Cancelled' WHERE Id = @OrderId AND Status = 'Created'`. A repeated or losing cancellation attempt must not restore stock again.

The checkout orchestration is owned by the Application layer; the transaction itself is opened and committed by a narrow, checkout-specific infrastructure abstraction. See `../architecture/architecture.md` section 9.3.

## Consequences

### Benefits

- Concurrent mutations of one cart are serialized.
- Stale client requests are detected explicitly.
- Checkout cannot silently consume an outdated cart state.
- Cart updates cannot resurrect items after checkout.
- Inventory correctness is protected independently of cart locking.
- Transaction boundaries make rollback behavior explicit.

### Trade-offs

- Explicit SQL or another database-specific locking mechanism is required.
- Holding a cart lock through checkout can increase contention for requests involving the same user.
- Long-running transactions must be avoided.
- Deadlocks remain possible and are surfaced to the client instead of being retried in-process.
- The locking implementation is specific to the chosen relational database unless an equivalent strategy is implemented for another database.
- `READ COMMITTED` requires the explicit lock and conditional-update mechanisms to remain correct; removing them would weaken the guarantees.

## Implementation requirements

- Keep transaction orchestration in the Infrastructure/Application boundary defined in `../architecture/architecture.md`; do not put database locking code in API controllers.
- Ensure the user-to-cart relationship has a database uniqueness constraint.
- Implement explicit cart-row locking in SQL Server.
- Configure and expose EF Core `rowversion` as the cart `ETag`, and require `If-Match` on cart mutations and checkout.
- Return `cart_version_conflict` with `412` for stale versions and `precondition_required` with `428` for missing `If-Match`.
- Make a successful checkout change the cart row so that the previous `ETag` becomes invalid.
- Use atomic conditional stock updates and verify affected-row counts.
- Keep checkout and cancellation transaction boundaries aligned with this ADR.
- Add integration tests using SQL Server for concurrent cart updates, checkout races, stale `ETag` after checkout, stock contention, and concurrent cancellation.
