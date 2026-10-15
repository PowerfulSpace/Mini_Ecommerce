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

The catalog is read-only through the public API.

Required endpoints:

- `GET /api/products`
- `GET /api/products/{id}`

`GET /api/products` returns active products only.

Products must not be physically deleted as part of normal catalog lifecycle management. Deactivation is represented by `IsActive = false`.

An inactive product cannot be purchased.

The intended behavior for retrieving a single inactive product is `404 Not Found`; this detail must remain consistent with the final API contract.

### 4.3 Product Prices

The cart uses the current product price.

When checkout succeeds, each order item stores a snapshot of the product name and unit price at the time of purchase.

Later product changes must not modify existing order item snapshots.

No taxes, discounts, shipping charges, or currency conversion are applied.

## 5. Shopping Cart

### 5.1 Cart Ownership and Lifecycle

Each user has exactly one active cart.

The cart is associated with the authenticated user, not with a user ID supplied by the client.

The cart persists after successful checkout and becomes empty. Checkout does not delete the cart itself.

Required endpoint:

- `GET /api/cart`

### 5.2 Cart Operations

Required endpoints:

- `POST /api/cart/items`
- `PUT /api/cart/items/{productId}`
- `DELETE /api/cart/items/{productId}`

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

A stale update must be rejected with `409 Conflict` and a `ProblemDetails` response.

Concurrent cart modification and checkout must produce one consistent outcome:

- If the cart update wins, checkout uses the updated cart.
- If checkout wins, the concurrent stale update must not restore old cart items or modify the checked-out cart.

No partial cart or order state is allowed.

## 6. Checkout and Order Creation

### 6.1 Checkout Endpoint

Required endpoint:

- `POST /api/orders`

The endpoint creates an order from the authenticated user's current cart.

The client must not submit a different user ID to select the cart owner.

### 6.2 Checkout Preconditions

Checkout must reject the request if:

- The cart is empty.
- Any cart item references an inactive product.
- Any requested quantity exceeds available stock.
- The request is invalid.
- The idempotency key conflicts with a previous request.

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
8. Complete the idempotency record.

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

All stock deductions must belong to the same checkout transaction.

If any product cannot be deducted, the entire checkout transaction must roll back.

The implementation must identify all products with insufficient stock for the final conflict response, while respecting the concurrency and consistency requirements.

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

The checkout endpoint requires an `Idempotency-Key` header.

The key identifies one checkout attempt for the authenticated user.

Requirements:

- The same user and key must not create more than one order.
- Repeating the same key with the same request content must return the saved result.
- Reusing the key with different request content must return `409 Conflict`.
- A new attempt after a final business-rule failure requires a new key.
- Concurrent requests using the same key must not execute independent checkout attempts.
- Final business errors must be saved for repeat requests.
- Unexpected internal server errors must not automatically be stored as final results.
- An uncertain transaction commit outcome must be resolved by retrying with the same key and checking durable state.
- A request must not start an independent checkout while the outcome of a previous attempt with the same key remains unknown.

The approved strategy reserves the key in a short transaction before executing checkout. The successful order transaction then commits the order, stock changes, cart cleanup, and completed idempotency result together.

Recovery of abandoned `InProgress` records requires an explicit, safe recovery strategy. The implementation must not automatically rerun such attempts without checking durable state.

See `adr/ADR-002-checkout-idempotency.md`.

## 7. Order History and Details

Required endpoints:

- `GET /api/orders`
- `GET /api/orders/{id}`

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

The initial HTTP status mapping is:

| Condition | HTTP status |
|---|---:|
| Invalid request or validation failure | `400 Bad Request` |
| Missing or invalid authentication | `401 Unauthorized` |
| Missing resource | `404 Not Found` |
| Insufficient stock | `409 Conflict` |
| Inactive product prevents an operation | `409 Conflict` |
| Empty cart checkout | `409 Conflict` |
| Stale cart update | `409 Conflict` |
| Repeated order cancellation | `409 Conflict` |
| Idempotency key reused with different content | `409 Conflict` |
| Unexpected server error | `500 Internal Server Error` |

The final API document must define the exact error response fields and stable error codes.

Error responses must not expose stack traces or sensitive implementation details.

## 10. Data Integrity and Persistence

The implementation must preserve the following requirements:

- User email addresses are unique.
- Each user has one persistent active cart.
- Cart items cannot have non-positive quantities.
- Monetary values use the approved precision.
- Order items preserve purchase-time product name and price.
- Stock cannot become negative as a result of a successful purchase.
- Checkout stock deductions and cart cleanup are atomic.
- Cancellation status changes and stock restoration are atomic.
- Idempotency state remains consistent with the corresponding checkout result.
- Product records referenced by historical orders must not be physically deleted.

Detailed schema, indexes, foreign keys, and database constraints are specified in `architecture/data-model.md`.

## 11. Testing Requirements

The implementation must include unit and integration tests.

Critical scenarios include:

- Authentication with Alice and Bob.
- Rejection of unknown test-user identities.
- Isolation of carts and orders between users.
- Product catalog filtering.
- Invalid cart quantities.
- Repeated cart additions.
- Stock validation when adding and updating cart items.
- Checkout of an empty cart.
- Checkout containing an inactive product.
- Successful checkout with correct totals and snapshots.
- Rollback when any stock deduction fails.
- Concurrent purchases competing for limited stock.
- Concurrent cart updates.
- Cart update racing with checkout.
- Repeated checkout using the same idempotency key.
- Concurrent requests using the same idempotency key.
- Reuse of a key with different request content.
- Cancellation restoring stock exactly once.
- Concurrent cancellation attempts.
- Safe repeated seeding.
- Integration tests using a dedicated SQL Server test database.

SQL Server-specific concurrency behavior must be tested against SQL Server rather than inferred from in-memory persistence tests.

## 12. Acceptance Criteria

The MVP is accepted when all applicable criteria below are satisfied.

### Environment and Authentication

- The solution builds successfully.
- The API starts with valid local configuration.
- The health endpoint responds successfully when the application is healthy.
- Database migrations can be applied.
- Development test authentication works for Alice and Bob.
- Unknown test-user values do not authenticate.
- The test authentication scheme is not registered in Production.
- Repeated development seeding does not create duplicate users.

### Catalog and Cart

- The API returns active products in the catalog.
- Each user has an isolated cart.
- Cart operations enforce positive quantities and stock availability.
- Inactive products cannot be newly purchased.
- Failed cart operations preserve the existing cart state.
- Stale cart updates are rejected.
- Checkout and cart modifications do not produce inconsistent states.

### Checkout and Orders

- A valid cart can be checked out successfully.
- Order totals and item snapshots are correct.
- Stock is deducted atomically.
- Failed checkout leaves no partial order or stock changes and preserves the cart.
- Repeated requests with the same idempotency key do not create duplicate orders.
- A key reused with different request content is rejected.
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

## 13. Unresolved Decisions

The following details require explicit resolution in the relevant architecture or API documents before implementation of the affected behavior:

- Exact DTO shapes and validation error codes.
- Exact `ProblemDetails` fields and stable error identifiers.
- The safe recovery mechanism for abandoned `InProgress` idempotency records.
- The precise precondition mechanism used to reject stale cart operations after checkout wins a race.
- Any remaining SQL Server locking, retry, and transaction-isolation details not fully specified by the approved ADRs.

An implementation agent must not silently invent these details. They must be resolved and documented before the affected behavior is implemented.