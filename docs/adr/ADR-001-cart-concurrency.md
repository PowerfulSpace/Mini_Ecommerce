# ADR-001: Cart Concurrency and Locking Strategy

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

The Mini E-commerce MVP has one persistent cart per user. Multiple requests may attempt to modify the same cart concurrently. Checkout also reads and modifies the cart while validating products, deducting stock, creating an order, and clearing cart items.

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
3. SQL Server `rowversion` exposed through the API as an opaque cart `version`.
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

A cart must exist before the operation attempts to lock it. Cart creation must be safe under concurrent first requests for a user, for example by relying on a unique constraint for the user-to-cart relationship and handling a concurrent creation attempt correctly.

## API cart version

The cart's SQL Server `rowversion` is returned by the API as an opaque string named `version`. The initial encoding is Base64.

Clients must submit the version they received when performing cart mutations and checkout.

The application compares the submitted version with the current version while operating under the cart transaction and lock.

If the submitted version is stale:

- Return `409 Conflict`.
- Use the error code `cart_version_conflict`.
- Do not apply the requested mutation.
- Do not automatically replay the operation against the newer cart state.

A successful cart mutation returns the updated cart and its new version.

`rowversion` is an additional stale-state check. It does not replace the cart-row lock. The lock serializes concurrent operations; the version detects requests based on an outdated view of the cart.

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

1. Validates the submitted cart version.
2. Reads the cart and its items.
3. Validates product activity and requested quantities.
4. Deducts stock using atomic conditional updates.
5. Creates the order and order-item snapshots.
6. Clears the cart items.
7. Marks the idempotency record completed as part of the successful checkout transaction.
8. Commits.

Order creation, stock deduction, cart clearing, and successful idempotency completion must commit atomically.

If validation or a stock update fails, the checkout transaction rolls back. No order is created, stock deductions are undone, and the cart remains unchanged.

Final business-error responses are persisted by the idempotency mechanism after the failed checkout transaction has rolled back. Unexpected infrastructure errors are not persisted as final business results.

## Cart update versus checkout

A cart update and checkout for the same user must be serialized by the cart-row lock.

### Update acquires the lock first

The update validates and applies its changes, then commits. Checkout acquires the lock afterward and evaluates the resulting cart state.

Checkout may still fail if the version submitted by the client is stale. The client must fetch the current cart and initiate a new checkout attempt with a new idempotency key when appropriate.

### Checkout acquires the lock first

Checkout validates the cart, creates the order, deducts stock, clears the cart, and commits. A waiting cart mutation then acquires the lock.

If the waiting mutation was based on the old cart version, its version check fails with `409 Conflict`. It must not restore items from the pre-checkout cart.

This rule prevents a stale cart update from resurrecting items after a successful checkout.

## Inventory concurrency

The cart-row lock protects one user's cart. It does not protect product stock shared by different users.

Inventory deductions must therefore use atomic conditional database updates that only succeed when the product has at least the requested quantity in stock.

The application must check the number of affected rows. A failed conditional update means the stock requirement was not satisfied at the time of the update.

All stock deductions for one checkout belong to the same transaction. If any deduction fails, the entire checkout transaction rolls back.

When reporting insufficient stock, the application should identify all products found to be insufficient during a consistent validation attempt. It must not imply that stock remains reserved after the error response.

## Lock ordering and deadlocks

When an operation needs to lock multiple product rows, it must acquire them in a stable order, preferably by `ProductId`.

A deadlock victim's transaction must be rolled back. Any retry must re-read and revalidate the relevant state.

Checkout retries must preserve the original idempotency key and request body. The system must not create a separate checkout attempt merely because the first attempt encountered a deadlock or an uncertain commit outcome.

## Transaction boundaries

The following operations must be atomic:

- A single cart mutation and its version update.
- Checkout order creation, all stock deductions, cart clearing, and successful idempotency completion.
- Order cancellation, status transition, and all stock restoration.

For cancellation, the database must ensure that only one concurrent request can perform the `Created` to `Cancelled` transition and restore stock. A repeated or losing cancellation attempt must not restore stock again.

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
- Deadlocks remain possible and require deliberate handling.
- The locking implementation is specific to the chosen relational database unless an equivalent strategy is implemented for another database.

## Implementation requirements

- Keep transaction orchestration in the Infrastructure/Application boundary appropriate to the use case; do not put database locking code in API controllers.
- Ensure the user-to-cart relationship has a database uniqueness constraint.
- Implement explicit cart-row locking in SQL Server.
- Configure and expose EF Core `rowversion` through the API DTO version field.
- Return `cart_version_conflict` for stale versions.
- Use atomic conditional stock updates and verify affected-row counts.
- Keep checkout and cancellation transaction boundaries aligned with this ADR.
- Add integration tests using SQL Server for concurrent cart updates, checkout races, stock contention, and concurrent cancellation.
- Verify that a stale update cannot resurrect cart items after checkout.