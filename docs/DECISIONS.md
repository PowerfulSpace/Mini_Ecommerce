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
- `CheckoutAttempt` and `CheckoutAttemptStatus` are infrastructure concerns, not domain entities. The entity, its persistence configuration, and the status enum live in `PS.MiniEcommerce.Infrastructure.Persistence`. The Application layer interacts with idempotency through `ICheckoutAttemptRepository` and the `CheckoutAttemptData` record.

### 1.2 Build and Configuration Tooling

- `global.json` and `Directory.Packages.props` are mandatory and are added in Phase 1 together with `Directory.Build.props`.
- Connection strings are never committed to the repository. The specific connection-string sources used at runtime, at design time, and in tests are described later in this section.
- System.Security.Cryptography.Pkcs is pinned to 9.0.21 (transitive from Microsoft.Data.SqlClient via Microsoft.EntityFrameworkCore.SqlServer) to resolve CVE-2026-84008. Revisit when Microsoft.Data.SqlClient updates its dependency.
- Cart.Items and Order.Items navigations are configured explicitly with HasMany(x => x.Items) and UsePropertyAccessMode(PropertyAccessMode.Field) to avoid shadow FKs (OrderId1) that EF Core would otherwise create for the read-only collection properties.
- Domain entities generate their Guid identifiers in the domain (Guid.NewGuid()). The Id of every entity is configured with ValueGeneratedNever() so that EF Core treats an entity added through a tracked collection navigation as Added. Without it, EF Core marks an application-keyed child added to a tracked parent as Modified and SaveChanges fails with a DbUpdateConcurrencyException because it issues an UPDATE for a row that does not exist yet.
- Application feature folders use plural names (Products, Carts, Orders) to avoid namespace-vs-type ambiguity between PS.MiniEcommerce.Application.Cart (namespace) and PS.MiniEcommerce.Domain.Cart (type).
- Design-time migrations read the connection string from the MINIECOMMERCE_DB environment variable via AppDbContextFactory. Runtime development reads ConnectionStrings:Default from appsettings.Development.json in the API project (not committed; .gitignored; appsettings.Development.example.json in the repository). Integration tests read MINIECOMMERCE_TEST_DB from the environment.
- API documentation uses Swashbuckle.AspNetCore for Swagger UI. Microsoft.AspNetCore.OpenApi is removed because it has no interactive UI, which is needed for manual verification in Phase 4+.
- AddProblemDetails() is registered to satisfy UseExceptionHandler()'s requirement for IProblemDetailsService. Domain and application exceptions are handled first by the custom IExceptionHandler; the built-in ProblemDetails service is a fallback for unhandled exceptions.
- ProblemDetails responses include a stable code extension field defined in architecture/api.md §4.1. For validation_error and not_found the code is set by ExceptionHandler.
- NotFoundException carries a Code property. It defaults to not_found and is set to product_not_found for catalog queries. DomainConflictException carries an analogous Code property. It defaults to conflict and is set to specific codes (cart_version_conflict, precondition_required, insufficient_stock, product_unavailable) by application handlers; the ExceptionHandler maps cart_version_conflict to 412 and precondition_required to 428. IAuthorizationMiddlewareResultHandler returns ProblemDetails with code = unauthenticated for 401 and code = forbidden for 403. This replaces the "open decision for Phase 4" note.
- If-Match must contain a single strong entity-tag in the form "<base64>". A missing value returns 428 precondition_required. A wildcard (*) or a malformed (non-Base64) value is rejected as 400 validation_error. A value that parses as Base64 but does not match the current cart rowversion returns 412 cart_version_conflict.
- Checkout attempt lease duration is 30 seconds (per section 10). The lease is set at reservation time (LeaseExpiresAtUtc = utcNow + 30s) and is currently unused; Phase 8 will use it for on-demand recovery of stale InProgress attempts.
- The request fingerprint for checkout idempotency is a 32-byte SHA-256 hash computed by the API controller from the request target and the submitted If-Match value. It is stored as varbinary(32) and compared byte-for-byte.
- FluentValidation messages are pinned to InvariantCulture: AddApplication sets ValidatorOptions.Global.LanguageManager.Culture to CultureInfo.InvariantCulture, and Program.cs sets the API host's default thread culture to InvariantCulture. The unit test assembly sets the language-manager culture as well, because unit tests do not start the API host.
- Development-only authentication uses the X-Test-User header with values alice and bob. The handler resolves the seeded user's UserId from the database and places it in the sub claim. The scheme is registered only in Development; it is not available in Production.
- CORS policy Frontend allows http://localhost:5173 (Vite dev server) with any header and any method. The policy is registered unconditionally; production origins are out of MVP scope.
- Continuous integration is deferred beyond the MVP.
- `TreatWarningsAsErrors` and code-style analyzers are enabled in Phase 3, after real application code and the validation pipeline behavior exist, not earlier.
- `Microsoft.AspNetCore.Mvc.Testing` is part of the approved testing stack and is used by the integration test project.
- Bounded wait (3 seconds, polling every 100ms) is implemented in ICheckoutAttemptRepository.WaitForCompletionAsync. Concurrent requests with the same idempotency key wait for the active attempt to complete and replay its result, or return 503 idempotency_in_progress on timeout. This resolves the previous deviation from ADR-002. On-demand stale-lease recovery is implemented in CheckoutHandler: when bounded wait times out and the attempt's lease has expired, the handler claims the attempt via a conditional update (TryClaimExpiredAsync) and resumes checkout. Concurrent claim attempts are serialized by the conditional update; only the winner proceeds.
- The race between recovery and an already-running checkout is resolved by a conditional update on the idempotency record (ExecuteUpdateAsync WHERE Status = 'InProgress') in CheckoutTransactionExecutor. Only one executor can complete the attempt; losers roll back their transaction and replay the winner's result. Uncertain commit outcomes (exceptions from SaveChangesAsync or CommitAsync) are surfaced as CheckoutCommitUncertainException and mapped to 503 idempotency_in_progress without persisting a final error.
- Uncertain commit outcomes (exceptions from SaveChangesAsync or CommitAsync after the transaction has started) are mapped to 503 idempotency_in_progress via CheckoutCommitUncertainException. This path is not covered by automated tests; the failure mode is difficult to simulate reliably without a test double. Manual verification is deferred.

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
- Known deviations from the error contract that are consciously accepted and deferred for the MVP are listed in section 13.

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

## 13. Known issues (deferred)

The following deviations from the API contract are known, consciously accepted, and deferred beyond the MVP. They are recorded so the frontend can rely on the current behavior instead of the contract text where the two differ. They are not silent defects.

- **D1 — `Idempotency-Key` is consumed when `If-Match` is missing.** Contrary to `architecture/api.md` §3.4 step 2, a `POST /api/orders` request with a valid `Idempotency-Key` but no `If-Match` reserves the key and persists the `428 precondition_required` result. A later request with the same key receives `409 idempotency_key_reused`, even when it supplies the correct `If-Match`. The frontend avoids this by always sending `If-Match` on checkout. Fixing it would change the idempotency reservation core; the risk is not justified for the MVP.
- **D2 — `insufficient_stock` does not list the affected products.** Contrary to `architecture/api.md` §4 and section 5 of this document, the response describes only the first failing product by name and does not include a list of affected product IDs and names. The frontend displays the `detail` message for the MVP. Extending the payload is a contract change deferred beyond the MVP.
- **D4 — checkout `ProblemDetails` omit `instance`.** Checkout final-error responses contain `type`, `title`, `status`, `detail`, and `code` but omit `instance`, unlike responses produced by the API exception handler. This is cosmetic; the frontend does not rely on `instance`. Not fixed in the MVP.


