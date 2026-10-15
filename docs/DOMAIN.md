# Domain Model

## 1. Purpose

This document describes the Mini E-commerce business domain, its main concepts, relationships, lifecycle rules, and invariants.

It defines what the application means from a business perspective, independently of the technical implementation.

Detailed functional behavior is specified in `SPEC.md`. Database structure is defined in `architecture/data-model.md`.

## 2. Domain Overview

Mini E-commerce represents a small online store where users purchase products through shopping carts and orders.

The core domain concepts are:

- User
- Product
- Cart
- Cart Item
- Order
- Order Item
- Checkout Attempt

The system must preserve business consistency when requests fail or execute concurrently.

## 3. User

A User represents a customer who can maintain a shopping cart and create orders.

A user has:

- A unique identifier.
- A unique email address.
- A creation timestamp in UTC.

### Business Rules

- Each user has at most one cart, created lazily when the user first requests it.
- A user can create multiple orders over time.
- A user can access only their own cart and orders.
- User identity is determined by the authenticated request context.
- A client cannot select another user as the owner of a cart or order by submitting a user ID.

The MVP does not include customer registration, profile management, or password-based authentication.

## 4. Product

A Product represents an item available for purchase.

A product has:

- A unique identifier.
- A name.
- A description.
- A current price.
- An available stock quantity.
- An active or inactive state.

### Business Rules

- Only active products can be purchased.
- Product prices are represented using decimal monetary values.
- The application uses USD.
- Stock must not become negative as a result of a successful purchase.
- Product deactivation prevents new purchases but does not erase historical order information.
- Products referenced by historical orders must not be physically deleted.
- Changing a product's current price must not change the price recorded in an existing order.

A product's current state and its historical representation in an order serve different purposes.

## 5. Cart

A Cart represents the current purchasing selection of one user.

The cart is created when the user first requests it and persists for the lifetime of the user account. It remains available after checkout.

### Business Rules

- A user has at most one cart.
- The cart is created lazily during the user's first cart request; concurrent first requests must still produce only one cart.
- A cart belongs to exactly one user.
- Cart ownership cannot be changed through public API requests.
- A cart may contain zero or more cart items.
- Successful checkout removes all cart items but preserves the cart itself.
- A successful checkout invalidates the cart version that was issued before it, so that concurrent operations based on the old state cannot be applied.
- Failed checkout must leave the cart unchanged.
- Order cancellation must not modify the current cart.

The cart represents current purchase intent, not a confirmed purchase.

## 6. Cart Item

A Cart Item represents the requested quantity of a product in a user's cart.

It associates a cart with a product and a positive integer quantity.

### Business Rules

- A cart must not contain duplicate entries for the same product.
- Adding an already-present product increases its existing quantity.
- Updating an item replaces its quantity with the requested positive integer.
- Zero or negative quantities are invalid.
- Removing an item is a separate operation.
- Requested quantities must not exceed currently available stock when adding or updating an item.
- Stock must be checked again at checkout.
- An inactive product may remain in a cart.
- An inactive product cannot be added, have its quantity changed, or be purchased.
- An inactive product can still be removed from a cart.

A cart item is not a reservation of stock. Availability may change before checkout.

## 7. Order

An Order represents a purchase successfully created from a user's cart.

An order belongs to one user and contains one or more order items.

### Order States

The MVP supports two states:

- `Created`
- `Cancelled`

The initial state of a successfully created order is `Created`.

The only permitted state transition in the MVP is:

`Created → Cancelled`

A cancelled order remains in the order history.

### Business Rules

- An order is created only after checkout succeeds.
- An order must contain at least one item.
- An order belongs to the user whose cart was checked out.
- An order's total amount is calculated from its stored item prices and quantities.
- A failed checkout must not create a partial order.
- A user may access only their own orders.
- An order cannot be physically removed as part of the normal MVP workflow.
- An order in `Created` state may be cancelled.
- An order in `Cancelled` state cannot be cancelled again successfully.

## 8. Order Item

An Order Item represents one purchased product line within an order.

It records the product reference, purchase-time product name, unit price, and quantity.

### Business Rules

- Every order item belongs to one order.
- The item quantity is a positive integer.
- The product name is copied into the order item when checkout succeeds.
- The unit price is copied into the order item when checkout succeeds.
- Existing order item snapshots do not change when the product name or current price changes.
- Historical order information remains meaningful even when the product is later deactivated.
- Cancelling an order restores the quantity recorded in its order items.

The order item snapshot represents the purchase as it occurred, rather than the current catalog state.

## 9. Checkout

Checkout is the business operation that converts a user's cart into an order.

### Preconditions

- The user is authenticated.
- The cart belongs to the authenticated user.
- The cart contains at least one item.
- Every product in the cart is active.
- Sufficient stock is available for every requested quantity.
- The checkout attempt satisfies the idempotency rules.

### Successful Outcome

A successful checkout must:

1. Validate the cart and its products.
2. Verify current stock availability.
3. Deduct the purchased quantities from stock.
4. Create the order.
5. Store order item snapshots.
6. Calculate the order total.
7. Remove all items from the cart.
8. Change the cart so that its previously issued version is no longer valid.
9. Record the completed idempotency result.

These changes must be consistent as one business operation.

### Failed Outcome

A failed checkout must not leave partial business changes.

If checkout fails due to a business rule:

- No order is created by that failed attempt.
- No partial stock deduction remains.
- The cart remains unchanged.
- The failure is returned according to the API contract.

If the database commit outcome is unknown, the application must not assume that checkout failed. It must resolve the result using the same idempotency key and durable state.

## 10. Checkout Attempt and Idempotency

A Checkout Attempt represents one logical checkout request identified by an idempotency key and its authenticated user.

### Business Rules

- A key identifies one attempt for one user.
- The same key and the same request must not create multiple orders.
- A repeated request must return the saved result when one exists.
- Reusing the key with a different request is a conflict.
- A new attempt after a final business-rule failure requires a new key.
- Concurrent requests using the same key must not start independent checkout executions.
- A matching attempt that is still running may be awaited for a limited time; when no result is available in time, the request fails temporarily and the client retries the same attempt.
- Final business errors are retained for repeat requests.
- Unexpected internal server errors are not automatically treated as final business results.
- An attempt left in `InProgress` must not be blindly executed again without checking durable state.
- Recovery runs on demand during a retry, only after the attempt's lease has expired. No background recovery process is part of the MVP.

The technical reservation, persistence, and recovery mechanisms are defined in `ADR-002-checkout-idempotency.md`.

## 11. Stock and Inventory Consistency

Stock represents the quantity currently available for purchase.

### Purchase Rules

- Checkout deducts stock for every order item.
- Stock deduction must be atomic with respect to competing purchases.
- A deduction is permitted only if sufficient stock remains.
- If any item cannot be deducted, the entire checkout business transaction fails.
- The system must not silently accept a partial purchase.

### Cancellation Rules

- Successful cancellation restores the exact quantities deducted for that order.
- Restoration is based on the order item quantities, not the current cart.
- Restoration is permitted even if a product is now inactive.
- A cancellation restores stock only once.
- Order status transition and stock restoration must be atomic.

The cart lock alone does not protect shared product stock. Inventory consistency requires separate database-level concurrency control.

## 12. Business Invariants

The following invariants must always hold after a successful committed business operation.

### Identity and Ownership

1. Every cart belongs to exactly one user.
2. Every order belongs to exactly one user.
3. Users cannot access another user's cart or order.
4. The application derives ownership from authenticated identity.

### Cart

5. A user has at most one cart, and concurrent first requests create only one cart.
6. A cart contains at most one item for each product.
7. Every cart item has a positive integer quantity.
8. Failed cart operations do not partially modify the cart.
9. Checkout clears cart items without deleting the cart and invalidates the cart version issued before it.
10. Failed checkout preserves the cart.

### Orders

11. A successfully created order contains at least one item.
12. Order item quantities are positive integers.
13. Order totals equal the sum of stored unit prices multiplied by stored quantities.
14. Order item names and prices are historical snapshots.
15. A cancelled order remains in history.

### Inventory

16. A successful purchase cannot deduct more stock than is available.
17. Failed checkout does not leave partial stock deductions.
18. A cancelled order restores exactly the quantities recorded in its order items.
19. The same order cannot restore its stock more than once.

### Idempotency and Transactions

20. One user and one idempotency key identify at most one logical checkout attempt.
21. Repeating a checkout request with the same key and request cannot create a duplicate order.
22. Reusing a key with a different request is rejected.
23. Checkout and cancellation must not leave partial committed business changes.
24. An operation based on a stale cart version never modifies the cart after a successful checkout.

These invariants must be protected by application logic, database constraints, transactions, and concurrency controls as appropriate.

## 13. Domain Errors

The domain and application layers must distinguish business-rule failures from unexpected technical failures.

Examples of business-rule failures include:

- Invalid cart quantity.
- Product unavailable for purchase.
- Insufficient stock.
- Empty cart checkout.
- Stale cart version.
- Missing cart version precondition.
- Conflicting idempotency key reuse.
- Repeated cancellation of an already-cancelled order.

The API maps these failures to the documented HTTP status codes and `ProblemDetails` responses.

The domain model must not depend on HTTP response types or ASP.NET Core.

## 14. Domain Boundaries

The following concerns are outside the domain model for the MVP:

- Payment processing.
- Shipping and delivery.
- Taxes and discounts.
- Currency conversion.
- Customer identity management beyond the agreed development authentication.
- Product administration workflows.
- Distributed messaging and cross-service consistency.

The domain should remain small and focused on catalog availability, cart state, checkout, orders, inventory, and cancellation.