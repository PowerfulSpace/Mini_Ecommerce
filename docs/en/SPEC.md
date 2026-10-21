# Functional Specification

## 1. Purpose

This document defines the functional requirements and acceptance criteria for the Mini E-commerce MVP.

It specifies the expected behavior of the product catalog, shopping cart, checkout, orders, cancellation, authentication, and error handling.

The requirements in this document are mandatory unless explicitly marked as proposed or unresolved.

Related documents:

- `PROJECT.md` — project goals and scope.
- `DOMAIN.md` — domain concepts, business rules, and invariants.
- `DECISIONS.md` — register of approved technical decisions.
- `architecture/architecture.md` — backend architecture.
- `architecture/data-model.md` — database structure and constraints.
- `architecture/api.md` — HTTP API contracts.
- `adr/ADR-001-cart-concurrency.md` — cart concurrency strategy.
- `adr/ADR-002-checkout-idempotency.md` — checkout idempotency strategy.

## 2. MVP Scope

The MVP includes:

- Development-only test authentication.
- Two seeded test users.
- A read-only product catalog.
- User-specific shopping carts.
- Adding, updating, and removing cart items.
- Stock availability checks.
- Transactional order creation.
- Order history and order details.
- Order cancellation and stock restoration.
- Protection against concurrent cart updates and purchases.
- Checkout idempotency.
- Standardized API errors using `ProblemDetails`.
- Unit tests and SQL Server integration tests.
- A frontend implemented after the backend foundation and API contracts are established.

The MVP excludes payments, shipping, coupons, customer registration, complex authorization, microservices, message brokers, and product administration endpoints.

## 3. Users and Authentication

### 3.1 User Model

A user has the following attributes:

- `Id`: unique identifier.
- `Email`: required and unique email address.
- `CreatedAtUtc`: creation timestamp in UTC.

The application does not provide user registration or profile management.

### 3.2 Test Users

The Development environment must seed the following users:

- Alice — `alice@example.com`.
- Bob — `bob@example.com`.

Seeding must be idempotent: repeated application startup must not create duplicate users.

Each user must have a distinct identifier.

### 3.3 Development Authentication

The Development environment uses the `X-Test-User` HTTP header.

Supported values:

- `X-Test-User: alice`
- `X-Test-User: bob`

The header selects one of the seeded test identities.

Requirements:

- The test authentication scheme must only be registered in Development.
- The scheme must not be available in Production.
- Missing or unknown test-user values must not authenticate the request.
- Protected endpoints must reject unauthenticated requests.
- The application must derive the current user ID from the authenticated request context.
- Clients must not choose cart or order ownership by submitting a user ID.

The protected endpoints are every endpoint except `GET /health`, `GET /api/products`, and `GET /api/products/{id}`. Catalog and health endpoints are public and must work without authentication.

### 3.4 User Data Isolation

Users must only access their own carts and orders.

A user attempting to access another user's order must receive `404 Not Found`.

Cart operations must not reveal or modify another user's cart.

## 4. Product Catalog

### 4.1 Product Attributes

A product contains:

- `Id`: unique identifier.
- `Name`: product name.
- `Description`: product description.
- `Price`: current price, represented by `decimal`.
- `StockQuantity`: available stock quantity.
- `IsActive`: whether the product is available for purchase.

The database must store monetary values using SQL Server `decimal(18,2)`.

The application uses USD as its currency.

### 4.2 Catalog Behavior

The catalog is read-only through the public API. Catalog endpoints do not require authentication.

Required endpoints:

- `GET /api/products`
- `GET /api/products/{id}`

`GET /api/products` returns active products only and is paginated with the shared list parameters defined in `architecture/api.md` (default and maximum page sizes are defined in `DECISIONS.md`).

Product order must be stable across pages so that pagination is deterministic.

Products must not be physically deleted as part of normal catalog lifecycle management. Deactivation is represented by `IsActive = false`.

An inactive product cannot be purchased.

Retrieving a single inactive or unknown product returns `404 Not Found` with the code `product_not_found`.

### 4.3 Product Prices

The cart uses the current product price.

When checkout succeeds, each order item stores a snapshot of the product name and unit price at the time of purchase.

Later product changes must not modify existing order item snapshots.

No taxes, discounts, shipping charges, or currency conversion are applied.

## 5. Shopping Cart

### 5.1 Cart Ownership and Lifecycle

A user may have at most one cart.

The cart is created lazily during `GET /api/cart` when the user does not have one yet. Cart mutations and checkout never create a cart; when no cart exists, they fail with `404 Not Found` and the code `cart_not_found`.

The cart is associated with the authenticated user, not with a user ID supplied by the client.

The cart persists after successful checkout and becomes empty. Checkout does not delete the cart itself.

Required endpoint:

- `GET /api/cart`

Repeated `GET /api/cart` requests return the same cart. Concurrent first requests for the same user must be safe: only one cart row may be created, and the losing request must return the winning cart instead of failing.

### 5.2 Cart Operations

Required endpoints:

- `POST /api/cart/items`
- `PUT /api/cart/items/{productId}`
- `DELETE /api/cart/items/{productId}`

Every cart mutation requires the `If-Match` header carrying the cart `ETag` received from the server. The request has no cart version field; `DELETE` has no request body.

Adding a product already present in the cart increases the existing quantity rather than creating a duplicate cart line.

Updating a cart item sets its quantity to the requested positive integer.

Removing an item is a separate operation. Quantity zero is not a substitute for deletion.

### 5.3 Quantity Validation

Cart quantities must be positive integers.

The application must reject:

- Zero quantities.
- Negative quantities.
- Fractional quantities.
- Invalid request payloads.

Validation errors must not modify the cart.

### 5.4 Stock Validation

Adding a product or changing its quantity must validate current availability.

If the requested quantity exceeds available stock, the entire operation must be rejected.

The application must not silently reduce the requested quantity to the available amount.

If a stock check fails, the existing cart state must remain unchanged.

Stock must be checked again during checkout because availability may have changed since the item was added.

### 5.5 Inactive Products

An inactive product may remain in an existing cart.

For an inactive cart item:

- The item remains visible in the cart.
- The item is identified as unavailable.
- Adding it or changing its quantity is rejected.
- Removing it is allowed.
- Checkout is rejected while the cart contains an inactive product.

A failed checkout must not clear the cart.

### 5.6 Empty Cart

An empty cart cannot be checked out.

The checkout request must fail without creating an order or modifying stock.

### 5.7 Cart Concurrency

Concurrent cart operations must not silently overwrite newer state.

The implementation must use SQL Server concurrency controls as specified in `ADR-001-cart-concurrency.md`.

The cart version is exposed as the `ETag` of every cart representation and is submitted by clients through the `If-Match` header on cart mutations and checkout.

- A missing required `If-Match` returns `428 Precondition Required` with the code `precondition_required`.
- A stale `If-Match` value returns `412 Precondition Failed` with the code `cart_version_conflict`.
- A stale operation must not be applied and must not be automatically replayed against the newer cart state.

Concurrent cart modification and checkout must produce one consistent outcome:

- If the cart update wins, checkout uses the updated cart.
- If checkout wins, the concurrent stale update must not restore old cart items or modify the checked-out cart.

A successful checkout must change the cart row within the same transaction, so that the `ETag` issued before checkout becomes invalid. Without this change, a stale mutation could succeed against an emptied cart.

No partial cart or order state is allowed.

## 6. Checkout and Order Creation

### 6.1 Checkout Endpoint

Required endpoint:

- `POST /api/orders`

The endpoint creates an order from the authenticated user's current cart.

Required headers:

- `Idempotency-Key`, with the format defined in `DECISIONS.md`.
- `If-Match`, carrying the cart `ETag` the client intends to check out.

The request body is empty. The client must not submit a different user ID to select the cart owner.

### 6.2 Checkout Preconditions

Checkout must reject the request if:

- The user has no cart yet.
- The cart is empty.
- Any cart item references an inactive product.
- Any requested quantity exceeds available stock.
- The request is invalid, including an invalid `Idempotency-Key` or a missing `If-Match`.
- The idempotency key conflicts with a previous request.

A missing `If-Match` returns `428 Precondition Required` and must not reserve the idempotency key. A stale `If-Match` returns `412 Precondition Failed`.

A business-rule failure must not clear the cart or partially deduct stock.

### 6.3 Transactional Behavior

The checkout operation must be atomic.

A successful checkout must perform the following business changes consistently:

1. Validate the cart and its products.
2. Verify current product availability.
3. Deduct stock for all purchased items.
4. Create the order and its order items.
5. Save product name and unit price snapshots.
6. Calculate and store the order total.
7. Clear cart items while preserving the cart.
8. Change the cart row so that its version changes.
9. Complete the idempotency record.

These changes must be committed consistently with the approved idempotency strategy.

If any stock deduction fails, the transaction must roll back all checkout business changes.

After a failed checkout:

- No order is created by the failed attempt.
- No partial stock deduction remains.
- The cart remains unchanged.
- The failure is returned according to the documented error contract.

### 6.4 Atomic Stock Deduction

Stock deduction must be performed atomically by updating a product only when its available stock is greater than or equal to the requested quantity.

The implementation must verify the number of affected rows.

Product rows must be processed in a stable order, preferably by product identifier, to reduce deadlocks.

Order-item snapshots of product name and unit price must be read while the product rows are still locked by the stock updates, so that a snapshot cannot be taken from a state that the checkout transaction has not locked.

All stock deductions must belong to the same checkout transaction.

If any product cannot be deducted, the entire checkout transaction must roll back.

The list of products with insufficient stock for the final conflict response is read after the failed checkout transaction has rolled back. It is informational only and must not imply that stock remains reserved.

### 6.5 Order Data

An order contains:

- `Id`: unique identifier.
- `UserId`: owner of the order.
- `Status`: current order status.
- `CreatedAtUtc`: creation timestamp in UTC.
- `TotalAmount`: total purchase amount.

Each order item contains:

- `Id`: unique identifier.
- `OrderId`: parent order identifier.
- `ProductId`: referenced product identifier.
- `ProductName`: product name snapshot.
- `UnitPrice`: unit price snapshot.
- `Quantity`: purchased quantity.

The order total is calculated as:

`TotalAmount = SUM(UnitPrice × Quantity)`

The total is expressed in USD and does not include taxes, discounts, or shipping.

### 6.6 Idempotency

The checkout endpoint requires an `Idempotency-Key` header and an `If-Match` header.

The key identifies one checkout attempt for the authenticated user and must match the format defined in `DECISIONS.md`.

Requirements:

- The same user and key must not create more than one order.
- The key is associated with a fingerprint of the request target and the submitted `If-Match` value.
- Repeating the same key with the same fingerprint must return the saved result.
- Reusing the key with a different fingerprint must return `409 Conflict` with the code `idempotency_key_reused`.
- The existing key must be checked before the current cart is read.
- A new attempt after a final business-rule failure requires a new key.
- Concurrent requests using the same key must not execute independent checkout attempts.
- A matching request that is still in progress waits for a bounded period. If no final result is available in time, the server returns `503 Service Unavailable` with the code `idempotency_in_progress` and the client retries with the same key and request.
- Final business errors must be saved for repeat requests.
- Unexpected internal server errors must not automatically be stored as final results.
- An uncertain transaction commit outcome must be resolved by retrying with the same key and checking durable state.
- A request must not start an independent checkout while the outcome of a previous attempt with the same key remains unknown.

The approved strategy reserves the key in a short transaction before executing checkout. The successful order transaction then commits the order, stock changes, cart cleanup, the cart-row version change, and the completed idempotency result together.

Recovery of abandoned `InProgress` records happens on demand when a retry arrives for the same key. It requires an expired lease and verification of durable database state. No background recovery service is used, and the implementation must not automatically rerun such attempts.

See `adr/ADR-002-checkout-idempotency.md`.

## 7. Order History and Details

Required endpoints:

- `GET /api/orders`
- `GET /api/orders/{id}`

`GET /api/orders` is paginated with the shared list parameters defined in `architecture/api.md`. Order order must be stable across pages, newest first.

Users may view only their own orders.

Order history must preserve cancelled orders.

The API must return the stored order item snapshots rather than substituting current product names or prices.

An order belonging to another user must return `404 Not Found`.

## 8. Order Cancellation

### 8.1 Endpoint

Required endpoint:

- `POST /api/orders/{id}/cancel`

### 8.2 Cancellation Rules

The MVP supports the following order statuses:

- `Created`
- `Cancelled`

An order in `Created` status may be cancelled.

Cancellation changes the status to `Cancelled` and restores the exact quantities previously deducted for that order.

Stock must be restored even if the corresponding product is now inactive.

Cancellation must not change the user's current cart.

### 8.3 Atomic Cancellation

The status transition and all stock restorations must occur in one transaction.

The transition from `Created` to `Cancelled` must succeed only if the order is still in `Created` status.

When cancellation requests race:

- Only one request may perform the successful transition.
- Only the winning request restores stock.
- Repeated cancellation must not restore stock a second time.
- A repeated cancellation returns `409 Conflict`.

A failure must not leave the order cancelled with only some stock restored.

## 9. API Error Handling

API errors use ASP.NET Core `ProblemDetails`.

The HTTP status mapping is:

| Condition | HTTP status |
|---|---:|
| Invalid request, header, or query parameter | `400 Bad Request` |
| Missing or invalid authentication | `401 Unauthorized` |
| Missing resource | `404 Not Found` |
| Insufficient stock | `409 Conflict` |
| Inactive product prevents an operation | `409 Conflict` |
| Empty cart checkout | `409 Conflict` |
| Repeated order cancellation | `409 Conflict` |
| Idempotency key reused with a different request | `409 Conflict` |
| Stale cart `If-Match` value | `412 Precondition Failed` |
| Required `If-Match` header missing | `428 Precondition Required` |
| Checkout attempt still in progress after the bounded wait, or the database is unreachable | `503 Service Unavailable` |
| Unexpected server error | `500 Internal Server Error` |

A `503` response is temporary. It must not be interpreted as a definitive checkout failure and must not be stored as a final business result.

The exact error response fields and stable error codes are defined in `architecture/api.md`.

Error responses must not expose stack traces or sensitive implementation details.

## 10. Data Integrity and Persistence

The implementation must preserve the following requirements:

- User email addresses are unique.
- A user has at most one cart, and the cart is created lazily on the first `GET /api/cart`.
- Cart items cannot have non-positive quantities.
- Monetary values use the approved precision.
- Order items preserve purchase-time product name and price.
- Stock cannot become negative as a result of a successful purchase.
- Checkout stock deductions, cart cleanup, and the cart-row version change are atomic.
- A successful checkout invalidates the previously issued cart `ETag`.
- Cancellation status changes and stock restoration are atomic.
- Idempotency state remains consistent with the corresponding checkout result.
- Product records referenced by historical orders must not be physically deleted.

Detailed schema, indexes, foreign keys, and database constraints are specified in `architecture/data-model.md`.

## 11. Testing Requirements

The implementation must include unit and integration tests.

Critical scenarios include:

- Authentication with Alice and Bob.
- Rejection of unknown test-user identities.
- Public access to the catalog without authentication.
- Rejection of unauthenticated cart and order requests.
- Isolation of carts and orders between users.
- Product catalog filtering and stable pagination, including maximum page sizes.
- Invalid cart quantities.
- Repeated cart additions.
- Stock validation when adding and updating cart items.
- Concurrent first `GET /api/cart` requests creating exactly one cart.
- Cart mutation and checkout with a missing `If-Match` header.
- Cart mutation and checkout with a stale `ETag`.
- Checkout of an empty cart.
- Checkout containing an inactive product.
- Successful checkout with correct totals and snapshots.
- The cart `ETag` returned before checkout is rejected after a successful checkout.
- Rollback when any stock deduction fails.
- Concurrent purchases competing for limited stock.
- Concurrent cart updates.
- Cart update racing with checkout.
- Repeated checkout using the same idempotency key.
- Concurrent requests using the same idempotency key.
- Reuse of a key with a different request, including a different cart `ETag`.
- Replay of a saved final business error for the same key and request.
- Bounded wait for an in-progress attempt followed by `503` and a successful retry with the same key.
- On-demand recovery of an abandoned `InProgress` record after the lease expires.
- An uncertain commit outcome resolved through durable state without creating a second order.
- Cancellation restoring stock exactly once.
- Concurrent cancellation attempts.
- `GET /health` success and failure when the database is unavailable.
- Safe repeated seeding.
- Integration tests using a dedicated SQL Server test database.

SQL Server-specific concurrency behavior must be tested against SQL Server rather than inferred from in-memory persistence tests.

## 12. Acceptance Criteria

The MVP is accepted when all applicable criteria below are satisfied.

### Environment and Authentication

- The solution builds successfully.
- The API starts with valid local configuration.
- `GET /health` responds successfully when the database is reachable and `503` when it is not.
- Database migrations can be applied.
- The catalog responds without authentication.
- Development test authentication works for Alice and Bob.
- Unknown test-user values do not authenticate.
- The test authentication scheme is not registered in Production.
- Repeated development seeding does not create duplicate users.

### Catalog and Cart

- The API returns active products in the catalog with stable pagination and the configured maximum page size.
- Each user has an isolated cart, created lazily on the first `GET /api/cart`.
- Cart operations enforce positive quantities and stock availability.
- Cart mutations and checkout require `If-Match`; missing values return `428` and stale values return `412`.
- Inactive products cannot be newly purchased.
- Failed cart operations preserve the existing cart state.
- Stale cart updates are rejected.
- Checkout and cart modifications do not produce inconsistent states.
- The cart `ETag` issued before a successful checkout is no longer accepted.

### Checkout and Orders

- A valid cart can be checked out successfully.
- Order totals and item snapshots are correct.
- Stock is deducted atomically.
- Failed checkout leaves no partial order or stock changes and preserves the cart.
- Repeated requests with the same idempotency key and the same request do not create duplicate orders.
- A key reused with a different request is rejected with `409`.
- A retry of an in-progress attempt waits, then returns `503` and succeeds when retried with the same key.
- Abandoned `InProgress` attempts are recovered on demand after the lease expires, without creating a second order.
- Users can access only their own order history and details.

### Cancellation

- Eligible orders can be cancelled.
- Cancellation restores the exact deducted stock.
- Cancellation does not modify the current cart.
- Concurrent cancellation cannot restore stock more than once.
- Cancelled orders remain available in order history.

### Quality

- Critical business rules are covered by automated tests.
- Integration tests use a dedicated SQL Server test database.
- API errors follow the approved `ProblemDetails` contract.
- Documentation and implementation remain consistent.

## 13. Resolved and Remaining Decisions

The decisions that previously blocked implementation are resolved:

- DTO shapes, status codes, and stable error identifiers: `architecture/api.md`.
- Cart version transport, `ETag`/`If-Match`, and the stale-version status: `ADR-001-cart-concurrency.md` and `architecture/api.md`.
- Key format, fingerprint, bounded wait, `503`, lease, and on-demand recovery of `InProgress` records: `ADR-002-checkout-idempotency.md` and `DECISIONS.md`.
- Transaction boundaries, lock ordering, isolation level, and deadlock handling: `ADR-001-cart-concurrency.md` and `architecture/architecture.md`.
- Lazy cart creation and the cart uniqueness rule: `DOMAIN.md`, `architecture/data-model.md`, and `architecture/api.md`.

The following details remain non-blocking and may be finalized during implementation without changing the contract:

- The exact `ProblemDetails` `type` URI convention.
- The final index list, chosen from measured query patterns.
- The client-side storage mechanism for an outstanding idempotency key.

An implementation agent must not invent contract behavior that is already defined in the documents above.