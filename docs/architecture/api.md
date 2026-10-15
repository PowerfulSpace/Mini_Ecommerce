# API Contract

## 1. Purpose

This document defines the HTTP API contract for the Mini E-commerce MVP.

The API is implemented with ASP.NET Core Controllers. Application use cases are exposed through MediatR commands and queries. Business rules remain in the Application and Domain layers; controllers handle HTTP concerns and map application results to HTTP responses.

The API is designed to make business outcomes, concurrency conflicts, and retry behavior explicit.

## 2. Conventions

- Base path: `/api`
- Content type: `application/json`
- Monetary values use USD.
- Timestamps are returned in UTC using ISO 8601 format.
- Resource identifiers are opaque to clients.
- Request and response DTOs are separate from domain entities.
- Errors use `ProblemDetails` with a stable application-specific `code` extension.
- Client-supplied user identifiers are never used to determine resource ownership.

### 2.1 Authentication for development

During development, requests use the `X-Test-User` header:

- `X-Test-User: alice`
- `X-Test-User: bob`

Missing or unknown values are treated as unauthenticated.

This mechanism is development-only and must not be registered in the Production environment. The API resolves the current user through the authentication context and exposes it to Application through `ICurrentUser`.

### 2.2 Cart version

Cart responses include a `version` field. Clients must send the version they received when performing cart mutations and checkout.

The version is an opaque string. The initial implementation uses a Base64 representation of the SQL Server `rowversion` value. Clients must not parse or construct it.

Every successful cart mutation returns the updated cart, including its new version. If the submitted version is stale, the API returns `409 Conflict` with code `cart_version_conflict`. The client must fetch the current cart before deciding how to proceed; the API must not silently replay a stale mutation.

The version is an additional stale-state check. It does not replace the database transaction and cart-row locking strategy.

## 3. Endpoints

### 3.1 Catalog

#### `GET /api/products`

Returns active products.

Example response:

```json
{
  "items": [
    {
      "id": "product-id",
      "name": "Example Product",
      "description": "Product description",
      "price": 19.99,
      "stockQuantity": 10
    }
  ]
}
```

Rules:

- Only active products are returned.
- Inactive products are not included in the catalog.
- No catalog write endpoints are exposed in the MVP.

#### `GET /api/products/{productId}`

Returns one active product.

Responses:

- `200 OK` — product found and active.
- `404 Not Found` — product does not exist or is inactive.

### 3.2 Cart

Each user has one persistent cart. An empty cart remains available after checkout; checkout removes its items but does not delete the cart itself.

#### `GET /api/cart`

Returns the current user's cart.

Example response:

```json
{
  "items": [
    {
      "productId": "product-id",
      "productName": "Example Product",
      "unitPrice": 19.99,
      "quantity": 2,
      "lineTotal": 39.98,
      "isAvailable": true
    }
  ],
  "totalAmount": 39.98,
  "version": "base64-rowversion"
}
```

Rules:

- The cart belongs to the authenticated user.
- `unitPrice` and totals use the current catalog price.
- Inactive products may remain in the cart and are marked unavailable.
- An unavailable product cannot be added, have its quantity updated, or be checked out. It can be removed.
- The response includes the current cart version, including when the cart is empty.

#### `POST /api/cart/items`

Adds a product to the cart.

Request:

```json
{
  "productId": "product-id",
  "quantity": 1,
  "version": "base64-rowversion"
}
```

Rules:

- `quantity` must be a positive integer.
- Adding a product already in the cart increases its existing quantity.
- The resulting quantity must not exceed available stock.
- The product must exist and be active.
- The submitted `version` must match the current cart version.
- If validation or concurrency checks fail, the operation must not partially modify the cart.

Successful response: `200 OK` with the updated cart and its new version.

#### `PUT /api/cart/items/{productId}`

Sets the quantity of an existing cart item.

Request:

```json
{
  "quantity": 3,
  "version": "base64-rowversion"
}
```

Rules:

- `quantity` must be a positive integer. Zero and negative values are rejected; use `DELETE` to remove an item.
- The product must be active.
- The requested quantity must not exceed available stock.
- The submitted version must match the current cart version.
- A failed operation must not partially modify the cart.

Successful response: `200 OK` with the updated cart and its new version.

#### `DELETE /api/cart/items/{productId}`

Removes a product from the cart.

Request body:

```json
{
  "version": "base64-rowversion"
}
```

Rules:

- The submitted version must match the current cart version.
- Removing an unavailable product is allowed.
- A failed operation must not partially modify the cart.

Successful response: `200 OK` with the updated cart and its new version.

The DELETE request uses a body to carry the cart version. Clients and API tooling must support sending that body. If this proves impractical for a chosen client, the transport can be revised consistently before implementation; the version check itself remains required.

### 3.3 Checkout and orders

#### `POST /api/orders`

Creates an order from the current user's cart.

Required header:

```http
Idempotency-Key: <unique-client-generated-key>
```

Request body:

```json
{
  "version": "base64-rowversion"
}
```

The submitted version identifies the cart state the client intends to check out. A stale version results in `409 Conflict` with code `cart_version_conflict`.

Checkout rules:

1. Authenticate the user.
2. Validate the `Idempotency-Key` header.
3. Look up an existing idempotency record for the current user and key **before reading the current cart**.
4. If a completed record exists and its request fingerprint matches, return its saved HTTP status and response body. Do not create another order.
5. If the key exists with a different request fingerprint, return `409 Conflict` with code `idempotency_key_reused`.
6. If the matching request is still in progress, return a temporary response and instruct the client to retry using the same key. Do not start an independent checkout for that key.
7. Only when no existing record applies, proceed with the checkout attempt and read the cart under the required transaction and locking strategy.
8. Validate that the cart is not empty, products are active, quantities are valid, and sufficient stock remains.
9. Create the order and order-item snapshots using the current product names and prices.
10. Deduct all stock, clear the cart items, and mark the idempotency record completed atomically in the successful checkout transaction.

The `version` in the request is part of the request fingerprint. Retrying the same attempt must use the same idempotency key and the same request body, including the same version.

If a business validation fails, the checkout transaction must roll back: no order is created, no stock is deducted, and the cart remains unchanged. Final business-error responses are saved for the idempotency key so that a retry of the same attempt receives the same result.

Unexpected infrastructure errors are not saved as final business results. If the outcome of a database commit is uncertain, the client must retry with the same key. The server must verify durable state before deciding whether to return a saved result or permit recovery; it must not assume that an uncertain checkout failed.

Responses:

- `201 Created` — order created.
- `400 Bad Request` — malformed request or missing required header, according to the validation policy.
- `401 Unauthorized` — unauthenticated request.
- `409 Conflict` — stale cart version, business-rule conflict, key reused with a different request, or an in-progress request requiring retry.
- `503 Service Unavailable` — when the server cannot safely resolve an uncertain or temporarily unavailable checkout state.

The exact response status and body for a final business error must be persisted and replayed consistently. Unexpected `5xx` infrastructure errors must not be represented as definitive checkout failures.

#### `GET /api/orders`

Returns orders belonging to the current user.

Rules:

- Orders belonging to other users are never returned.
- The response does not expose orders belonging to another user, even if the client knows their identifiers.

#### `GET /api/orders/{orderId}`

Returns one order belonging to the current user.

Responses:

- `200 OK` — order found and owned by the current user.
- `404 Not Found` — order does not exist or belongs to another user.

Example response:

```json
{
  "id": "order-id",
  "status": "Created",
  "createdAtUtc": "2026-01-15T12:30:00Z",
  "totalAmount": 39.98,
  "items": [
    {
      "productId": "product-id",
      "productName": "Example Product",
      "unitPrice": 19.99,
      "quantity": 2,
      "lineTotal": 39.98
    }
  ]
}
```

Order items preserve the product name and unit price from the time of checkout. Later catalog changes must not change historical order details.

#### `POST /api/orders/{orderId}/cancellation`

Cancels an order in the `Created` state.

Rules:

- Only the owner can cancel the order.
- Cancellation changes the status to `Cancelled`.
- Stock is restored for every order item, including when a product is now inactive.
- The status change and all stock restoration happen in one transaction.
- Concurrent cancellation attempts must not restore stock more than once.
- Cancellation does not modify the user's cart.

Responses:

- `200 OK` — order cancelled.
- `404 Not Found` — order does not exist or belongs to another user.
- `409 Conflict` — order is already cancelled or cannot be cancelled in its current state.

## 4. Error format

Errors use the standard `ProblemDetails` shape with a stable `code` extension.

Example:

```json
{
  "type": "https://example.invalid/problems/cart-version-conflict",
  "title": "Cart version conflict",
  "status": 409,
  "detail": "The cart changed after it was retrieved. Fetch the latest cart and retry with an updated request.",
  "code": "cart_version_conflict"
}
```

The example `type` URI is illustrative. The implementation should use a consistent problem-type convention.

### 4.1 Error codes

The following codes are part of the API contract:

| Code | HTTP status | Meaning |
|---|---:|---|
| `validation_error` | 400 | Request fields are invalid |
| `unauthenticated` | 401 | Authentication is missing or invalid |
| `product_not_found` | 404 | Product does not exist or is inactive |
| `cart_item_not_found` | 404 | Cart item does not exist |
| `order_not_found` | 404 | Order does not exist or is not owned by the current user |
| `cart_empty` | 409 | Checkout was requested for an empty cart |
| `product_unavailable` | 409 | A product cannot be used for the requested operation |
| `insufficient_stock` | 409 | One or more products have insufficient stock |
| `cart_version_conflict` | 409 | The submitted cart version is stale |
| `idempotency_key_reused` | 409 | The same key was used with a different request |
| `idempotency_in_progress` | 503 | The matching checkout attempt is still being resolved |
| `order_already_cancelled` | 409 | The order has already been cancelled |
| `order_cannot_be_cancelled` | 409 | The order is not in a cancellable state |

The implementation may add codes when required, but existing codes and their meanings must remain stable.

For insufficient stock, the response should identify every affected product using its product ID and name. The list must be derived from a consistent validation result and must not imply that stock is reserved after the response.

## 5. Concurrency and consistency requirements

HTTP responses must reflect the outcome of the underlying transaction.

- Cart mutations and checkout use the agreed cart-row locking strategy.
- Cart mutations and checkout validate the submitted cart version.
- Inventory deductions use atomic conditional updates that succeed only when sufficient stock remains.
- Checkout stock deductions, order creation, cart clearing, and successful idempotency completion commit atomically.
- A failed checkout must not leave a partial order, partial stock deductions, or a cleared cart.
- Cancellation status changes and stock restoration commit atomically.
- A concurrent cart update must not resurrect old cart contents after checkout has completed.
- Deadlock retries, if implemented, must revalidate state and preserve checkout idempotency.

## 6. Idempotency record lifecycle

The checkout idempotency mechanism follows these rules:

- Keys are scoped to the authenticated user.
- A key is associated with a fingerprint of the checkout request body.
- A matching completed request returns the persisted response without reading the current cart or creating another order.
- A matching in-progress request must not execute checkout independently.
- A key associated with a different request body returns `idempotency_key_reused`.
- Final business errors are persisted and replayed.
- Unexpected infrastructure errors are not persisted as final business results.
- Recovery of an old `InProgress` record requires a lease or timeout and verification of durable database state before any retry or recovery action.
- If the commit outcome is uncertain, durable state must be checked before deciding whether the attempt completed or can safely be retried.

The exact database schema and recovery procedure are defined in the architecture and ADR documents.

## 7. Out of scope

The MVP API does not include:

- Payment processing
- Shipping and delivery
- Coupons or discounts
- Catalog administration
- User registration or production-grade authentication
- External messaging or background processing infrastructure
- Multi-warehouse inventory