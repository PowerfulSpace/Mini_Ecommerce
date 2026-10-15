# Architecture and Product Decisions

This document summarizes the key decisions for the Mini E-commerce MVP. Detailed concurrency and idempotency behavior is specified in the corresponding ADR documents.

## 1. Architecture

- Use .NET 10 and ASP.NET Core Controllers.
- Follow Clean Architecture with Domain, Application, Infrastructure, and API projects.
- Use MediatR for commands, queries, and pipeline behaviors.
- Use SQL Server and Entity Framework Core for persistence.
- Use FluentValidation for request and application-level validation.
- Use xUnit and NSubstitute for automated tests.
- Keep business rules in Domain and Application rather than in API controllers.
- Do not introduce a separate Common project unless a concrete need justifies it.

## 2. Catalog and pricing

- The catalog is read-only in the MVP; no administration API is exposed.
- Only active products are returned by catalog endpoints.
- Inactive products cannot be added to a cart, updated in a cart, or checked out.
- Inactive products already in a cart remain visible as unavailable and can be removed.
- Products are deactivated through `IsActive = false`; physical deletion is not supported.
- Prices use USD and SQL Server `decimal(18,2)`.
- Cart totals use current catalog prices.
- Order items preserve product name and unit price snapshots from checkout.

## 3. Cart ownership and lifecycle

- Each user has one persistent cart and may have multiple orders.
- The cart remains after checkout; successful checkout removes its items rather than deleting the cart.
- Cart ownership is determined by the authenticated user context, never by a client-supplied user ID.
- Development uses the `X-Test-User` header for seeded users `alice` and `bob`.
- The development authentication mechanism must not be enabled in Production.
- Cart quantities must be positive integers. Zero and negative values are rejected; removing an item uses the DELETE endpoint.
- Adding a product already in the cart increments its quantity.
- Cart operations reject quantities that exceed available stock; quantities are not silently truncated.
- Failed cart operations must not partially modify the cart.

## 4. Cart concurrency

The cart concurrency strategy is defined in [ADR-001](adr/ADR-001-cart-concurrency.md).

- Every cart mutation and checkout runs in a database transaction.
- Cart mutations and checkout explicitly lock the persistent cart row for the duration of the transaction.
- The implementation must use SQL Server `UPDLOCK` or an equivalent explicit mechanism; ordinary EF Core LINQ queries must not be assumed to provide this lock.
- SQL Server `rowversion` is exposed through the API as an opaque string named `version`, initially encoded as Base64.
- Cart mutation and checkout requests must include the version on which the operation is based.
- A stale version returns `409 Conflict` with code `cart_version_conflict`. The operation is not automatically replayed.
- Successful cart mutations return the updated cart and its new version.
- The cart lock serializes operations on one cart; `rowversion` provides additional stale-request protection.
- A concurrent cart update must not resurrect old cart items after checkout commits.

## 5. Inventory consistency

- Cart locking does not protect stock shared across different users.
- Stock deductions use atomic conditional database updates that succeed only when sufficient stock remains.
- The implementation checks affected-row counts to detect a failed stock deduction.
- All stock deductions in a checkout belong to one transaction.
- If any stock deduction fails, checkout rolls back completely: no order is created, stock changes are undone, and the cart remains unchanged.
- Insufficient-stock errors should identify all affected products by ID and name based on a consistent validation attempt.
- Cancellation restores the exact quantities recorded in the order, even if a product has since become inactive or its stock has changed.

## 6. Checkout idempotency

The idempotency strategy is defined in [ADR-002](adr/ADR-002-checkout-idempotency.md).

- `POST /api/orders` requires an `Idempotency-Key` header.
- Keys are scoped to the authenticated user.
- Each key is associated with a fingerprint of the checkout request body, including the submitted cart version.
- The server checks for an existing key before reading the current cart.
- The same key and same request body return the saved result; a completed retry must not create another order or deduct stock again.
- Reusing a key with a different request body returns `409 Conflict` with code `idempotency_key_reused`.
- New keys are reserved in a short, separate transaction using a durable `InProgress` record.
- Successful order creation, stock deductions, cart clearing, and idempotency completion commit atomically.
- Final business errors are saved after the checkout transaction rolls back and are replayed for matching retries.
- Unexpected infrastructure errors are not persisted as final business results.
- An uncertain commit outcome must be resolved by checking durable state; the server must not assume that checkout failed.
- A matching in-progress request must not start an independent checkout. The client retries with the same key and body.
- Recovery of stale `InProgress` records requires an expired lease or timeout and verification of durable database state before recovery.
- The implementation must ensure that concurrent requests and recovery workers cannot execute the same checkout independently.

## 7. Orders and cancellation

- Order statuses are `Created` and `Cancelled`.
- A user may view only their own orders.
- An order belonging to another user returns `404 Not Found`.
- Orders preserve product name and unit price snapshots.
- Only orders in the `Created` state may be cancelled.
- Cancellation changes the order status and restores all item quantities in one transaction.
- Concurrent cancellation attempts must not restore stock more than once.
- Repeated cancellation returns `409 Conflict`.
- Cancellation does not modify the cart.

## 8. Error handling

- API errors use `ProblemDetails` with a stable application-specific `code`.
- Stale cart versions, insufficient stock, idempotency conflicts, and invalid order-state transitions use `409 Conflict`.
- Missing or invalid authentication returns `401 Unauthorized`.
- Missing resources and resources owned by another user return `404 Not Found`.
- A temporary unresolved idempotency attempt must not be reported as a definitive checkout failure.
- Final business-error responses are persisted for idempotent replay; unexpected infrastructure errors are not persisted as final business outcomes.

## 9. Out of scope

The MVP does not include:

- Payment processing
- Shipping or delivery integration
- Coupons or discounts
- Catalog administration
- Production-grade registration or authentication
- Microservices or message brokers
- External payment or inventory providers
- Multi-warehouse inventory

## 10. Decision records

- [ADR-001: Cart Concurrency and Locking Strategy](adr/ADR-001-cart-concurrency.md)
- [ADR-002: Checkout Idempotency](adr/ADR-002-checkout-idempotency.md)