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
- A separate `Common` project is not introduced in the MVP. Shared types stay in the layer that owns them.

### 1.1 Repository Layout and Naming

- All backend and test project names use the deliberate `PS.` prefix (`PS.MiniEcommerce.*`). The prefix is preserved in project names, namespaces, and paths.
- The backend resides in `src/Backend/PS.MiniEcommerce/`.
- The solution file is `src/Backend/PS.MiniEcommerce/PS.MiniEcommerce.slnx`. It uses the `.slnx` format, stays nested under the backend directory, and is not moved to the repository root.
- The backend projects are `PS.MiniEcommerce.Domain`, `PS.MiniEcommerce.Application`, `PS.MiniEcommerce.Infrastructure`, and `PS.MiniEcommerce.API`.
- Automated tests reside in `tests/PS.MiniEcommerce.UnitTests` and `tests/PS.MiniEcommerce.IntegrationTests`.
- `PS.MiniEcommerce.Common` is not part of the agreed structure and is removed during Phase 1. Do not create, reference, or extend a `Common` project.
- `CheckoutAttempt` is an infrastructure concern, not a domain entity. It models idempotency mechanics (fingerprint, lease, persisted response) and is implemented in Infrastructure; the Domain project does not contain it.

### 1.2 Build and Configuration Tooling

- `global.json` and `Directory.Packages.props` are mandatory and are added in Phase 1 together with `Directory.Build.props`.
- Connection strings are never committed. Development uses .NET user secrets; the integration-test database connection string is supplied through the environment variable `MINIECOMMERCE_TEST_DB` or through user secrets for local development. It is not committed to the repository and is not placed in `appsettings*.json`; integration tests read it through the standard configuration provider.
- System.Security.Cryptography.Pkcs is pinned to 9.0.21 (transitive from Microsoft.Data.SqlClient via Microsoft.EntityFrameworkCore.SqlServer) to resolve CVE-2026-84008. Revisit when Microsoft.Data.SqlClient updates its dependency.
- Cart.Items and Order.Items navigations are configured explicitly with HasMany(x => x.Items) and UsePropertyAccessMode(PropertyAccessMode.Field) to avoid shadow FKs (OrderId1) that EF Core would otherwise create for the read-only collection properties.
- Design-time migrations read the connection string from the MINIECOMMERCE_DB environment variable via AppDbContextFactory. Runtime reads ConnectionStrings:Default from configuration.
- The CORS policy allows the frontend development origin `http://localhost:5173`. The decision is recorded now; the policy is implemented in Phase 3 and used by the frontend from Phase 9.
- Continuous integration is deferred beyond the MVP.
- `TreatWarningsAsErrors` and code-style analyzers are enabled in Phase 3, after real application code and the validation pipeline behavior exist, not earlier.
- `Microsoft.AspNetCore.Mvc.Testing` is part of the approved testing stack and is used by the integration test project.

## 2. Catalog and pricing

- The catalog is read-only in the MVP; no administration API is exposed.
- Catalog endpoints are public and do not require authentication.
- Only active products are returned by catalog endpoints.
- Inactive products cannot be added to a cart, updated in a cart, or checked out.
- Inactive products already in a cart remain visible as unavailable and can be removed.
- Products are deactivated through `IsActive = false`; physical deletion is not supported.
- Prices use USD and SQL Server `decimal(18,2)`.
- Cart totals use current catalog prices.
- Order items preserve product name and unit price snapshots from checkout.
- The product list is paginated using the shared list parameters defined in section 10.

## 3. Cart ownership and lifecycle

- A user may have at most one cart and may have multiple orders.
- The cart is created lazily during `GET /api/cart` when the user does not have one yet.
- Cart mutations and checkout never create a cart; they require an existing cart and return `404` with code `cart_not_found` when none exists.
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
- The SQL Server `rowversion` of the cart row is returned to clients as an HTTP `ETag` on cart representations and is submitted back through the `If-Match` request header. The `ETag` value is the Base64 encoding of the 8-byte `rowversion`.
- Cart mutations and checkout must include `If-Match`. A missing required `If-Match` returns `428 Precondition Required`. A mismatching value returns `412 Precondition Failed` with code `cart_version_conflict`.
- The version check is not automatically replayed against the newer cart state.
- Successful cart mutations return the updated cart and its new `ETag`.
- The cart lock serializes operations on one cart; `rowversion` provides additional stale-request protection.
- A successful checkout must change the cart row inside the same transaction, so that the previously issued `ETag` becomes invalid. A concurrent cart mutation with a stale `ETag` must not resurrect old cart items after checkout commits.

## 5. Inventory consistency

- Cart locking does not protect stock shared across different users.
- Stock deductions use atomic conditional database updates that succeed only when sufficient stock remains.
- The implementation checks affected-row counts to detect a failed stock deduction.
- All stock deductions in a checkout belong to one transaction.
- If any stock deduction fails, checkout rolls back completely: no order is created, stock changes are undone, and the cart remains unchanged.
- Insufficient-stock errors identify all affected products by ID and name, read after the failed checkout transaction has rolled back. No stock is reserved after the error response.
- Cancellation restores the exact quantities recorded in the order, even if a product has since become inactive or its stock has changed.

## 6. Checkout idempotency

The idempotency strategy is defined in [ADR-002](adr/ADR-002-checkout-idempotency.md).

- `POST /api/orders` requires an `Idempotency-Key` header and an `If-Match` header.
- Keys are scoped to the authenticated user and must match the format defined in section 10.
- Each key is associated with a fingerprint of the semantically relevant request content: the request target and the submitted cart `ETag`.
- The server checks for an existing key before reading the current cart.
- The same key and same fingerprint return the saved result; a completed retry must not create another order or deduct stock again.
- Reusing a key with a different fingerprint returns `409 Conflict` with code `idempotency_key_reused`.
- New keys are reserved in a short, separate transaction using a durable `InProgress` record.
- Successful order creation, stock deductions, cart clearing, cart-row version change, and idempotency completion commit atomically.
- Final business errors are saved after the checkout transaction rolls back and are replayed for matching retries. A new checkout attempt after a saved final business error requires a new idempotency key.
- Unexpected infrastructure errors are not persisted as final business results.
- An uncertain commit outcome must be resolved by checking durable state; the server must not assume that checkout failed.
- A matching in-progress request waits for a bounded period. If no final result is available in time, the server returns `503 Service Unavailable` with code `idempotency_in_progress` and instructs the client to retry with the same key and request.
- Recovery of stale `InProgress` records is performed on demand by a later request for the same key. It requires an expired lease and verification of durable database state. No background recovery service is used.
- Concurrent requests and on-demand recovery must not independently execute the same checkout.

## 7. Orders and cancellation

- Order statuses are `Created` and `Cancelled`.
- A user may view only their own orders.
- An order belonging to another user returns `404 Not Found`.
- Orders preserve product name and unit price snapshots.
- Only orders in the `Created` state may be cancelled.
- The cancellation endpoint is `POST /api/orders/{id}/cancel`.
- Cancellation changes the order status and restores all item quantities in one transaction, using a conditional status update so that only one concurrent request wins.
- Concurrent cancellation attempts must not restore stock more than once.
- Repeated cancellation returns `409 Conflict`.
- Cancellation does not modify the cart.
- The order list is paginated using the shared list parameters defined in section 10.

## 8. Error handling

- API errors use `ProblemDetails` with a stable application-specific `code`.
- Stale or missing cart preconditions use `412 Precondition Failed` and `428 Precondition Required`.
- Insufficient stock, idempotency conflicts, empty cart checkout, and invalid order-state transitions use `409 Conflict`.
- Missing or invalid authentication returns `401 Unauthorized`.
- Missing resources and resources owned by another user return `404 Not Found`.
- A temporary unresolved idempotency attempt returns `503 Service Unavailable`; it must not be reported as a definitive checkout failure.
- Final business-error responses are persisted for idempotent replay; unexpected infrastructure errors are not persisted as final business outcomes.

## 9. API surface

- Public endpoints: `GET /health`, `GET /api/products`, `GET /api/products/{id}`.
- All other endpoints require authentication.
- Cart mutations and checkout require `If-Match`. Order cancellation does not, because it is protected by the conditional order-status transition instead.
- `GET /api/products` and `GET /api/orders` are paginated. Other endpoints are not paginated in the MVP.
- `GET /health` reports database reachability and is the only endpoint whose success body is not a resource representation of the shopping workflow.

## 10. MVP constants

These values are the single source of truth for cross-document numeric parameters. Other documents must reference this section instead of restating the values independently.

| Parameter | Value |
|---|---|
| `Idempotency-Key` format | `^[A-Za-z0-9_-]{8,128}$` |
| Bounded wait for a matching in-progress checkout | 3 seconds |
| Lease or timeout of an `InProgress` checkout attempt | 30 seconds |
| Checkout attempt record retention | No automatic cleanup in the MVP |
| List pagination: `page` default / `pageSize` default / `pageSize` maximum | `1` / `20` / `100` |
| `ETag` format | Quoted strong entity-tag: Base64 of the 8-byte SQL Server `rowversion` |
| Transaction isolation level for the MVP | `READ COMMITTED`, combined with explicit `UPDLOCK` and conditional updates |
| Deadlock handling for the MVP | No automatic in-process retries; the request fails and the client retries with the same idempotency key or refetches the cart |

## 11. Out of scope

The MVP does not include:

- Payment processing
- Shipping or delivery integration
- Coupons or discounts
- Catalog administration
- Production-grade registration or authentication
- Microservices or message brokers
- External payment or inventory providers
- Multi-warehouse inventory
- Background recovery or cleanup workers

## 12. Decision records

- [ADR-001: Cart Concurrency and Locking Strategy](adr/ADR-001-cart-concurrency.md)
- [ADR-002: Checkout Idempotency](adr/ADR-002-checkout-idempotency.md)
