# Data Model

## 1. Purpose

This document defines the planned relational data model for the Mini E-commerce MVP.

The model must support:

- A product catalog.
- At most one cart per user, created lazily on the first cart request.
- Cart items with validated quantities.
- Orders with immutable purchase snapshots.
- Stock deduction and restoration.
- Checkout idempotency.
- Transactional consistency under concurrent requests.

SQL Server is the target relational database, and Entity Framework Core is the default persistence technology.

This document defines the intended model and its integrity requirements. Exact EF Core configurations and migrations will be implemented during the infrastructure phase.

## 2. Design Principles

1. Use relational constraints to protect data integrity wherever practical.
2. Represent monetary values using SQL Server `decimal(18,2)`.
3. Store timestamps in UTC.
4. Use primary keys and foreign keys for entity relationships.
5. Avoid physical deletion of products referenced by carts or historical orders.
6. Store purchase-time product names and prices in order items.
7. Keep checkout and cancellation operations atomic.
8. Use SQL Server-specific concurrency mechanisms where required.
9. Do not treat application-level validation as a replacement for transactional database operations.
10. Do not add tables for features outside the MVP.

## 3. Entity Overview

The planned persistent entities are:

- `User`
- `Product`
- `Cart`
- `CartItem`
- `Order`
- `OrderItem`
- `CheckoutAttempt`

The names are logical entity names. Exact table names and naming conventions may be finalized during EF Core configuration.

## 4. Entity Definitions

### 4.1 User

Represents a customer identity known to the application.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `Email` | `nvarchar(320)` | Required; unique |
| `CreatedAtUtc` | `datetime2` | Required; UTC |

Requirements:

- Each user has a stable identifier.
- Email uniqueness must be enforced by the database.
- Development seed data must be repeatable without creating duplicate users.
- User identity used for cart and order ownership comes from the authenticated request context.
- The MVP does not require customer registration or password storage.

The `User` entity represents the application's customer identity. It does not imply that the MVP implements a full identity-management system.

### 4.2 Product

Represents a catalog product and its current inventory state.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `Name` | `nvarchar(200)` | Required |
| `Description` | `nvarchar(max)` | Required unless the finalized contract allows null |
| `Price` | `decimal(18,2)` | Required; non-negative |
| `StockQuantity` | `int` | Required; non-negative |
| `IsActive` | `bit` | Required |
| `CreatedAtUtc` | `datetime2` | Required; UTC |

Requirements:

- Only active products appear in the public catalog.
- Products are deactivated using `IsActive = false`; physical deletion is not part of the MVP.
- Stock cannot be negative.
- Price must be non-negative.
- Checkout uses the current product price when creating the order.
- Stock deductions must be atomic and conditional on sufficient stock.

A database check constraint must enforce non-negative stock and price.

If nullable descriptions are selected during contract finalization, the database mapping and API DTOs must agree.

### 4.3 Cart

Represents a user's persistent shopping cart.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `UserId` | `uniqueidentifier` | Required; foreign key to `User` |
| `RowVersion` | `rowversion` | Required concurrency token |
| `CreatedAtUtc` | `datetime2` | Required; UTC |
| `UpdatedAtUtc` | `datetime2` | Required; UTC |

Requirements:

- A user has at most one cart.
- A cart persists even when it contains no items.
- The cart is created lazily when the user first requests it through `GET /api/cart`.
- Successful checkout removes the cart items but preserves the cart record.
- A unique constraint on `UserId` enforces the one-cart-per-user rule and resolves concurrent first creations: the losing insert fails on the constraint and the implementation re-reads the winning row.
- `RowVersion` is used as part of the stale-update protection strategy and is exposed to clients as the cart `ETag`.
- A successful checkout must update the cart row, for example by setting `UpdatedAtUtc`, inside the same transaction. This guarantees that `rowversion` changes and the previously issued `ETag` becomes invalid.

SQL Server generates and updates the `rowversion` value automatically. Application code must not assign it manually.

Cart mutations and checkout require the client to submit the current `ETag` through `If-Match`. Stale values are rejected with `412 Precondition Failed`, and a missing required `If-Match` is rejected with `428 Precondition Required`.

### 4.4 CartItem

Represents a product and quantity currently present in a cart.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `CartId` | `uniqueidentifier` | Required; foreign key to `Cart` |
| `ProductId` | `uniqueidentifier` | Required; foreign key to `Product` |
| `Quantity` | `int` | Required; greater than zero |
| `CreatedAtUtc` | `datetime2` | Required; UTC |
| `UpdatedAtUtc` | `datetime2` | Required; UTC |

Requirements:

- A cart cannot contain multiple rows for the same product.
- A unique constraint on `(CartId, ProductId)` enforces this rule.
- Quantity must be positive.
- Adding a product already present in the cart increases its existing quantity.
- Cart operations must validate product activity and stock according to the specification.
- A product becoming inactive does not automatically delete its existing cart item.
- Cart items are removed through explicit removal or successful checkout.

A database check constraint must enforce `Quantity > 0`.

The cart item's product reference is retained for navigation and validation. The cart item is not a purchase snapshot: its displayed price comes from the current catalog data according to the approved business rules.

### 4.5 Order

Represents a completed checkout.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `UserId` | `uniqueidentifier` | Required; foreign key to `User` |
| `Status` | `nvarchar(20)` | Required; `Created` or `Cancelled` |
| `CreatedAtUtc` | `datetime2` | Required; UTC |
| `TotalAmount` | `decimal(18,2)` | Required; non-negative |

Supported statuses in the MVP:

- `Created`
- `Cancelled`

Requirements:

- An order belongs to one user.
- Order creation and stock deduction happen in the same checkout transaction.
- An order contains one or more order items.
- The order total is calculated from saved order-item unit prices and quantities.
- Historical order data must remain independent of later catalog price or product-name changes.
- Cancellation changes the order status and restores stock atomically.
- Orders are not physically deleted as part of the MVP.

A check constraint must enforce non-negative totals and must restrict `Status` to the supported set.

### 4.6 OrderItem

Represents a line in an order and preserves the purchase-time snapshot.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `OrderId` | `uniqueidentifier` | Required; foreign key to `Order` |
| `ProductId` | `uniqueidentifier` | Required; foreign key to `Product` |
| `ProductName` | `nvarchar(200)` | Required; snapshot |
| `UnitPrice` | `decimal(18,2)` | Required; snapshot |
| `Quantity` | `int` | Required; positive |

Requirements:

- `ProductName` is copied from the product when checkout creates the order.
- `UnitPrice` is copied from the current catalog price during checkout.
- `Quantity` is copied from the validated cart quantity.
- The line total is `UnitPrice × Quantity`.
- The order total is the sum of all line totals.
- Later product renames or price changes must not alter historical order data.
- Cancellation restores the exact quantities recorded in the order items.

A check constraint must enforce `Quantity > 0` and non-negative `UnitPrice`.

`ProductId` remains a reference to the catalog product, while `ProductName` and `UnitPrice` preserve the historical purchase details.

Products must not be physically deleted while referenced by order items.

### 4.7 CheckoutAttempt

Represents an idempotent checkout attempt.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `UserId` | `uniqueidentifier` | Required; foreign key to `User` |
| `IdempotencyKey` | `nvarchar(128)` | Required; must match the key format defined in `../DECISIONS.md` |
| `RequestFingerprint` | `varbinary(32)` | Required; SHA-256 of the request target and submitted `If-Match` value |
| `Status` | `nvarchar(20)` | Required; `InProgress` or `Completed` |
| `OrderId` | `uniqueidentifier` | Nullable foreign key to `Order` |
| `ResponseStatusCode` | `int` | Nullable until a final result is recorded |
| `ResponsePayload` | `nvarchar(max)` | Nullable until a final result is recorded |
| `LeaseExpiresAtUtc` | `datetime2` | Required; used by on-demand recovery |
| `CreatedAtUtc` | `datetime2` | Required; UTC |
| `UpdatedAtUtc` | `datetime2` | Required; UTC |

Requirements:

- The idempotency key is scoped to a user.
- A unique constraint on `(UserId, IdempotencyKey)` prevents duplicate attempts for the same user and key and decides which concurrent reservation wins.
- The request fingerprint represents the semantically relevant request content as defined in `../adr/ADR-002-checkout-idempotency.md`.
- Reusing the same key with a different request fingerprint produces `409 Conflict` with code `idempotency_key_reused`.
- Repeating the same key and fingerprint returns the saved result when one exists.
- A successful attempt is linked to the created order.
- `ResponseStatusCode` and `ResponsePayload` store the response that must be replayed, including final business-error responses.
- Unexpected internal errors must not be recorded as final business results; the record stays `InProgress`.
- Recovery must not blindly execute an attempt whose durable outcome is uncertain.

State model:

- `InProgress` — the attempt is reserved and has no durable final result. `ResponseStatusCode` and `ResponsePayload` are null.
- `Completed` — a final response is stored and must be replayed. `Completed` covers both successful checkouts and final business errors; the stored status code distinguishes them.

Transitions:

- Insert as `InProgress` during key reservation, with `LeaseExpiresAtUtc` set to the current UTC time plus the lease duration.
- `InProgress` → `Completed` inside the successful checkout transaction, together with the order, stock, and cart changes.
- `InProgress` → `Completed` in a separate transaction after a failed checkout transaction has rolled back, storing the final business-error response.
- `InProgress` stays `InProgress` after an infrastructure error or an uncertain commit outcome.

On-demand recovery claims an expired attempt with a conditional update that succeeds only when the record is still `InProgress` and `LeaseExpiresAtUtc` is in the past. Only the request that affects one row proceeds; all others follow the in-progress wait policy. The claim extends `LeaseExpiresAtUtc` for the duration of the recovery attempt.

Records are not cleaned up automatically in the MVP, as defined in `../DECISIONS.md`.

## 5. Relationships

The intended relationships are:

```text
User 1 ─── 0..1 Cart
Cart 1 ─── 0..* CartItem
Product 1 ─── 0..* CartItem

User 1 ─── 0..* Order
Order 1 ─── 1..* OrderItem
Product 1 ─── 0..* OrderItem

User 1 ─── 0..* CheckoutAttempt
Order 1 ─── 0..* CheckoutAttempt
```

The `Order` to `CheckoutAttempt` relationship is optional on the attempt side because a checkout may fail before an order is created.

The uniqueness of `Cart.UserId` ensures at most one cart per user. The cart row is created lazily when the user first requests the cart through `GET /api/cart`; no other operation creates it.

## 6. Constraints and Indexes

The database schema must enforce the following constraints.

| Entity | Constraint | Purpose |
|---|---|---|
| `User` | Unique `Email` | Prevent duplicate customer identities |
| `Product` | `Price >= 0` | Prevent negative prices |
| `Product` | `StockQuantity >= 0` | Prevent negative stock |
| `Cart` | Unique `UserId` | One cart per user |
| `CartItem` | Unique `(CartId, ProductId)` | One row per product in a cart |
| `CartItem` | `Quantity > 0` | Prevent invalid quantities |
| `Order` | `TotalAmount >= 0` | Prevent negative order totals |
| `Order` | `Status IN ('Created', 'Cancelled')` | Restrict statuses to the supported set |
| `OrderItem` | `Quantity > 0` | Prevent invalid order quantities |
| `OrderItem` | `UnitPrice >= 0` | Prevent negative purchase prices |
| `CheckoutAttempt` | Unique `(UserId, IdempotencyKey)` | Prevent duplicate idempotency attempts |
| `CheckoutAttempt` | `Status IN ('InProgress', 'Completed')` | Restrict states to the supported set |
| `CheckoutAttempt` | `LeaseExpiresAtUtc IS NOT NULL` | Support on-demand recovery |

Foreign keys must protect the intended relationships.

Additional indexes should support common queries:

- Active product catalog queries.
- Cart lookup by user.
- Cart item lookup by cart.
- Order history lookup by user and creation time.
- Order item lookup by order.
- Idempotency lookup by user and key.

Exact index ordering and additional included columns should be chosen based on the final query patterns. Do not add speculative indexes without a clear need.

## 7. Deletion and Referential Integrity

Physical deletion of products is not supported by the MVP.

Recommended behavior:

- Deactivate products using `IsActive = false`.
- Preserve product records referenced by cart items or order items.
- Remove cart items explicitly or during successful checkout.
- Preserve order and order-item records after cancellation.
- Preserve idempotency records for the period required by the approved retry and recovery policy.

Cascade deletion must not accidentally delete historical orders, purchase snapshots, or idempotency results.

Any configured cascade behavior must be reviewed explicitly in EF Core mappings.

## 8. Money and Order Calculations

All monetary values use USD and SQL Server `decimal(18,2)`.

For each order item:

`LineTotal = UnitPrice × Quantity`

For an order:

`TotalAmount = SUM(LineTotal)`

Requirements:

- Use decimal arithmetic, not floating-point types, for money.
- Calculate the order total from the purchase-time unit prices and quantities.
- Persist the resulting order total as part of order creation.
- Do not apply taxes, shipping charges, coupons, discounts, or currency conversion in the MVP.
- Validate numeric bounds so that a calculation cannot silently overflow the supported database precision.

The exact application-level representation and numeric bounds should be consistent with the API contract and database schema.

## 9. Transactional Invariants

### 9.1 Checkout

A successful checkout must atomically:

1. Validate the current cart under the approved cart-locking strategy, including the submitted `If-Match` value.
2. Validate product activity and requested quantities.
3. Deduct stock using atomic conditional updates.
4. Create the order and order-item snapshots, reading product names and prices while the product rows are locked.
5. Clear cart items.
6. Update the cart row so that its `rowversion` changes.
7. Record the completed idempotency result consistently with the order.

If any required stock deduction fails, the checkout transaction must roll back all business changes.

The idempotency reservation may be committed separately according to the approved hybrid strategy. That reservation must not cause a partial order or stock deduction.

### 9.2 Cancellation

Cancellation must atomically:

1. Verify ownership.
2. Transition the order to `Cancelled` with a conditional update that succeeds only when the order is still in the `Created` state.
3. Restore the quantities recorded in the order items, processing product rows in a stable order.

Only the request whose status transition affects one row may restore stock. Concurrent cancellation attempts must not restore the same quantities more than once; losing attempts receive `409 Conflict`.

### 9.3 Cart concurrency

Cart mutation and checkout must follow the approved locking strategy.

`rowversion` is a concurrency token, not a replacement for the explicit cart-locking mechanism. Clients submit it through `If-Match`; stale values are rejected with `412 Precondition Failed` and a missing required `If-Match` with `428 Precondition Required`.

The cart row must be updated whenever the cart contents change, including during checkout, so that `rowversion` always reflects the logical cart state.

## 10. EF Core Mapping Guidance

- Use explicit entity configurations when they make relational constraints and behavior easier to review.
- Configure decimal precision explicitly.
- Configure `RowVersion` using SQL Server's rowversion support.
- Configure foreign keys, unique indexes, and check constraints explicitly.
- Use migrations to evolve the schema.
- Do not rely on EF Core conventions alone for critical uniqueness, precision, or concurrency requirements.
- Keep SQL Server-specific locking and conditional update logic visible and testable.
- Do not use EF Core's in-memory provider to claim correctness for SQL Server locking or transaction behavior.

## 11. Remaining Details

The decisions that affect the schema are resolved in `../DECISIONS.md`, `../adr/ADR-001-cart-concurrency.md`, and `../adr/ADR-002-checkout-idempotency.md`: lazy cart creation, `If-Match` and `rowversion` handling, the checkout attempt state model, the key format, the fingerprint algorithm, and the lease fields.

The following implementation details remain open and do not affect the contract:

- Exact nullability and maximum lengths for optional product fields.
- The final index list, chosen from measured query patterns.
- The exact representation of the stored response payload, provided that it reproduces the documented response.

Do not invent details that would change API compatibility, transaction safety, or recovery correctness.

## 12. Related Documents

- `../PROJECT.md`
- `../SPEC.md`
- `../DOMAIN.md`
- `../DECISIONS.md`
- `../ROADMAP.md`
- `architecture.md`
- `api.md`
- `../adr/ADR-001-cart-concurrency.md`
- `../adr/ADR-002-checkout-idempotency.md`