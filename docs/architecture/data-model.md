# Data Model

## 1. Purpose

This document defines the planned relational data model for the Mini E-commerce MVP.

The model must support:

- A product catalog.
- One persistent cart per user.
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

A database check constraint should enforce non-negative stock and price where supported by the final schema design.

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

- Each user has at most one cart.
- A cart persists even when it contains no items.
- Successful checkout removes the cart items but preserves the cart record.
- A unique constraint on `UserId` enforces the one-cart-per-user rule.
- `RowVersion` is used as part of the stale-update protection strategy.

SQL Server generates and updates the `rowversion` value automatically. Application code must not assign it manually.

The exact stale-update precondition and its HTTP representation must follow the finalized concurrency and API contracts.

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

A database check constraint should enforce `Quantity > 0`.

The cart item's product reference is retained for navigation and validation. The cart item is not a purchase snapshot: its displayed price comes from the current catalog data according to the approved business rules.

### 4.5 Order

Represents a completed checkout.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `UserId` | `uniqueidentifier` | Required; foreign key to `User` |
| `Status` | `nvarchar(20)` or agreed compact representation | Required |
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

A check constraint may enforce non-negative totals. Status values must be restricted to the supported set using the agreed schema and mapping strategy.

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

A check constraint should enforce `Quantity > 0` and non-negative `UnitPrice`.

`ProductId` remains a reference to the catalog product, while `ProductName` and `UnitPrice` preserve the historical purchase details.

Products must not be physically deleted while referenced by order items.

### 4.7 CheckoutAttempt

Represents an idempotent checkout attempt.

| Property | Suggested SQL type | Requirements |
|---|---|---|
| `Id` | `uniqueidentifier` | Primary key |
| `UserId` | `uniqueidentifier` | Required; foreign key to `User` |
| `IdempotencyKey` | `nvarchar` with a finalized bounded length | Required |
| `RequestFingerprint` | `nvarchar` or `varbinary` with a finalized representation | Required |
| `Status` | `nvarchar(20)` or agreed compact representation | Required |
| `OrderId` | `uniqueidentifier` | Nullable foreign key to `Order` |
| `ResponseStatusCode` | `int` | Nullable until a final result is recorded |
| `ResponsePayload` | `nvarchar(max)` | Nullable until a final result is recorded |
| `CreatedAtUtc` | `datetime2` | Required; UTC |
| `UpdatedAtUtc` | `datetime2` | Required; UTC |

The exact schema depends on the finalized idempotency design.

Requirements:

- The idempotency key is scoped to a user.
- A unique constraint on `(UserId, IdempotencyKey)` prevents duplicate attempts for the same user and key.
- The request fingerprint represents the semantically relevant checkout request content.
- Reusing the same key with different request content produces the approved conflict response.
- Repeating the same key and request content returns the saved result when one exists.
- A successful attempt is linked to the created order.
- The saved response must contain enough information to reproduce the approved response contract.
- Unexpected internal errors must not be recorded as final business results.
- Recovery must not blindly execute an attempt whose durable outcome is uncertain.

Possible attempt states include:

- `InProgress`
- `Completed`
- A finalized business-failure state, with its exact representation to be defined by the idempotency design.

The final state model, fingerprint algorithm, response storage format, key length, and recovery fields must be specified before implementation.

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

The uniqueness of `Cart.UserId` ensures at most one cart per user. A cart may be created lazily or during user initialization; the exact creation strategy must be consistent across the application.

## 6. Constraints and Indexes

The database schema should enforce the following constraints.

| Entity | Constraint | Purpose |
|---|---|---|
| `User` | Unique `Email` | Prevent duplicate customer identities |
| `Product` | `Price >= 0` | Prevent negative prices |
| `Product` | `StockQuantity >= 0` | Prevent negative stock |
| `Cart` | Unique `UserId` | One cart per user |
| `CartItem` | Unique `(CartId, ProductId)` | One row per product in a cart |
| `CartItem` | `Quantity > 0` | Prevent invalid quantities |
| `Order` | `TotalAmount >= 0` | Prevent negative order totals |
| `OrderItem` | `Quantity > 0` | Prevent invalid order quantities |
| `OrderItem` | `UnitPrice >= 0` | Prevent negative purchase prices |
| `CheckoutAttempt` | Unique `(UserId, IdempotencyKey)` | Prevent duplicate idempotency attempts |

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

1. Validate the current cart under the approved cart-locking strategy.
2. Validate product activity and requested quantities.
3. Deduct stock using atomic conditional updates.
4. Create the order and order-item snapshots.
5. Clear cart items.
6. Record the completed idempotency result consistently with the order.

If any required stock deduction fails, the checkout transaction must roll back all business changes.

The idempotency reservation may be committed separately according to the approved hybrid strategy. That reservation must not cause a partial order or stock deduction.

### 9.2 Cancellation

Cancellation must atomically:

1. Verify ownership.
2. Verify that the order is in the `Created` state.
3. Transition the order to `Cancelled`.
4. Restore the quantities recorded in the order items.

Only the successful status transition may restore stock. Concurrent cancellation attempts must not restore the same quantities more than once.

### 9.3 Cart concurrency

Cart mutation and checkout must follow the approved locking strategy.

`rowversion` is a concurrency token, not a replacement for the explicit cart-locking mechanism.

The exact mechanism for detecting stale client requests must follow the finalized cart API precondition contract.

## 10. EF Core Mapping Guidance

- Use explicit entity configurations when they make relational constraints and behavior easier to review.
- Configure decimal precision explicitly.
- Configure `RowVersion` using SQL Server's rowversion support.
- Configure foreign keys, unique indexes, and check constraints explicitly.
- Use migrations to evolve the schema.
- Do not rely on EF Core conventions alone for critical uniqueness, precision, or concurrency requirements.
- Keep SQL Server-specific locking and conditional update logic visible and testable.
- Do not use EF Core's in-memory provider to claim correctness for SQL Server locking or transaction behavior.

## 11. Open Questions

The following details must be finalized before the affected schema or behavior is implemented:

- Exact nullability and maximum lengths for optional product fields.
- Exact `CheckoutAttempt` state model and representation of final business failures.
- Idempotency key length, fingerprint algorithm, and response payload format.
- Recovery metadata for abandoned `InProgress` attempts.
- Exact deletion behavior and retention policy for completed and failed idempotency records.
- Whether cart creation is lazy or performed during user initialization.
- Exact HTTP precondition used to reject stale cart mutations.
- Exact schema representation and validation strategy for order statuses.

Do not invent these details independently when they affect API compatibility, transaction safety, or recovery correctness.

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