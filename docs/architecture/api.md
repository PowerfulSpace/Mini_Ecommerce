# API Contract

## 1. Purpose

This document defines the HTTP API contract for the Mini E-commerce MVP.

The API is implemented with ASP.NET Core Controllers. Application use cases are exposed through MediatR commands and queries. Business rules remain in the Application and Domain layers; controllers handle HTTP concerns and map application results to HTTP responses.

The API is designed to make business outcomes, concurrency conflicts, and retry behavior explicit.

## 2. Conventions

- Base path: `/api`, except for `GET /health`.
- Content type: `application/json`.
- Monetary values use USD.
- Timestamps are returned in UTC using ISO 8601 format.
- Resource identifiers are opaque to clients.
- Request and response DTOs are separate from domain entities.
- Errors use `ProblemDetails` with a stable application-specific `code` extension, except for the successful `GET /health` response.
- Client-supplied user identifiers are never used to determine resource ownership.
- Numeric parameters such as page sizes, wait durations, and lease durations are defined once in `../DECISIONS.md` section 10 and are referenced here instead of being restated.

### 2.1 Authentication

Endpoints that require authentication reject anonymous requests with `401 Unauthorized` and code `unauthenticated`.

| Endpoint | Authentication |
|---|---|
| `GET /health` | Not required |
| `GET /api/products` | Not required |
| `GET /api/products/{productId}` | Not required |
| All other endpoints | Required |

During development, authenticated requests use the `X-Test-User` header:

- `X-Test-User: alice`
- `X-Test-User: bob`

Missing or unknown values are treated as unauthenticated.

This mechanism is development-only and must not be registered in the Production environment. The API resolves the current user through the authentication context and exposes it to Application through `ICurrentUser`.

### 2.2 Cart version through ETag and If-Match

Every cart representation is returned with an `ETag` response header. The value is a quoted strong entity-tag containing the Base64 encoding of the 8-byte SQL Server `rowversion` of the cart row, for example:

```http
ETag: "bmV3dmVyc2lvbg=="
```

Clients must not parse or construct the value.

`If-Match` is required on the following operations:

- `POST /api/cart/items`
- `PUT /api/cart/items/{productId}`
- `DELETE /api/cart/items/{productId}`
- `POST /api/orders`

Rules:

- A missing required `If-Match` returns `428 Precondition Required` with code `precondition_required`.
- Only a single concrete entity-tag is accepted. `If-Match: *` is not supported and is rejected as an invalid request.
- A stale value returns `412 Precondition Failed` with code `cart_version_conflict`. The operation is not applied and is not automatically replayed.
- Every successful cart mutation returns the updated cart with a new `ETag`.
- A successful checkout changes the cart row, so the previously issued `ETag` becomes invalid.

The version is an additional stale-state check. It does not replace the database transaction and cart-row locking strategy defined in `../adr/ADR-001-cart-concurrency.md`.

### 2.3 Pagination

`GET /api/products` and `GET /api/orders` accept the same query parameters:

| Parameter | Default | Maximum | Rules |
|---|---|---|---|
| `page` | see `../DECISIONS.md` section 10 | — | Integer, `>= 1` |
| `pageSize` | see `../DECISIONS.md` section 10 | see `../DECISIONS.md` section 10 | Integer, within the documented bounds |

Out-of-range or non-integer values return `400 Bad Request` with code `validation_error`. A page beyond the last available page returns an empty `items` array.

Paginated responses use the same envelope:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "totalCount": 0
}
```

## 3. Endpoints

### 3.1 Health

#### `GET /health`

Reports whether the application can reach the database. The endpoint is public and does not require authentication.

Responses:

- `200 OK` — the database is reachable.

```json
{
  "status": "Healthy"
}
```

- `503 Service Unavailable` — the database is not reachable. The body uses the standard `ProblemDetails` format with code `health_unavailable`.

This is the only endpoint whose successful body is not part of the shopping workflow. It does not expose configuration, connection strings, or exception details.

### 3.2 Catalog

Catalog endpoints are public.

#### `GET /api/products`

Returns active products for the requested page.

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
  ],
  "page": 1,
  "pageSize": 20,
  "totalCount": 1
}
```

Rules:

- Only active products are returned.
- Inactive products are not included in the catalog.
- Results are ordered by product name for stable pagination.
- No catalog write endpoints are exposed in the MVP.

#### `GET /api/products/{productId}`

Returns one active product.

Responses:

- `200 OK` — product found and active. Body is a single product object without the pagination envelope.
- `404 Not Found` — product does not exist or is inactive, with code `product_not_found`.

### 3.3 Cart

Each user has at most one cart. The cart is created lazily during `GET /api/cart` when the user does not have one. Cart mutations and checkout never create a cart.

An empty cart remains available after checkout; checkout removes its items but does not delete the cart itself.

#### `GET /api/cart`

Returns the current user's cart, creating it when it does not exist.

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
  "totalAmount": 39.98
}
```

Rules:

- The cart belongs to the authenticated user and is returned with an `ETag` header, including when the cart is empty.
- A newly created cart is empty and carries a fresh `ETag`.
- Repeated requests return the same cart.
- Concurrent first requests for the same user are safe: the database unique constraint on the cart owner decides which row wins, and the losing request re-reads and returns the winning cart.
- `unitPrice` and totals use the current catalog price.
- Inactive products may remain in the cart and are marked unavailable.
- An unavailable product cannot be added, have its quantity updated, or be checked out. It can be removed.

#### `POST /api/cart/items`

Adds a product to the cart.

Requires `If-Match`.

Request:

```json
{
  "productId": "product-id",
  "quantity": 1
}
```

Rules:

- `quantity` must be a positive integer.
- Adding a product already in the cart increases its existing quantity.
- The resulting quantity must not exceed available stock.
- The product must exist and be active.
- The submitted `If-Match` value must match the current cart version.
- If validation or concurrency checks fail, the operation must not partially modify the cart.

Responses:

- `200 OK` — the updated cart and a new `ETag`.
- `400 Bad Request` — invalid payload, with code `validation_error`.
- `404 Not Found` — the user has no cart yet, with code `cart_not_found`, or the product does not exist, with code `product_not_found`.
- `409 Conflict` — insufficient stock or inactive product.
- `412 Precondition Failed` — stale `If-Match`.
- `428 Precondition Required` — `If-Match` is missing.

#### `PUT /api/cart/items/{productId}`

Sets the quantity of an existing cart item.

Requires `If-Match`.

Request:

```json
{
  "quantity": 3
}
```

Rules:

- `quantity` must be a positive integer. Zero and negative values are rejected; use `DELETE` to remove an item.
- The product must be active.
- The requested quantity must not exceed available stock.
- The submitted `If-Match` value must match the current cart version.
- A failed operation must not partially modify the cart.

Responses: the same set as `POST /api/cart/items`, with code `cart_item_not_found` when the product is not in the cart.

#### `DELETE /api/cart/items/{productId}`

Removes a product from the cart.

Requires `If-Match`. The request has no body; the cart version is transmitted only through `If-Match`.

Rules:

- The submitted `If-Match` value must match the current cart version.
- Removing an unavailable product is allowed.
- A failed operation must not partially modify the cart.

Responses:

- `200 OK` — the updated cart and a new `ETag`.
- `404 Not Found` — the user has no cart or the item does not exist.
- `412 Precondition Failed` — stale `If-Match`.
- `428 Precondition Required` — `If-Match` is missing.

### 3.4 Checkout and orders

#### `POST /api/orders`

Creates an order from the current user's cart.

Required headers:

```http
Idempotency-Key: <client-generated key>
If-Match: "<cart ETag>"
```

The request body is empty.

Checkout rules:

1. Authenticate the user.
2. Validate the `Idempotency-Key` format and the presence of `If-Match`. A failure here returns `400` or `428` and does not reserve the key.
3. Calculate the request fingerprint from the request target and the submitted `If-Match` value.
4. Look up an existing idempotency record for the current user and key **before reading the current cart**.
5. If a completed record exists and its fingerprint matches, return its saved HTTP status and response body. Do not create another order.
6. If the key exists with a different fingerprint, return `409 Conflict` with code `idempotency_key_reused`.
7. If the matching record is in progress, wait for a bounded period. If no final result is available in time, return `503 Service Unavailable` with code `idempotency_in_progress` and instruct the client to retry the same key and request. If the lease has expired, on-demand recovery may claim the attempt.
8. Only when no existing record applies, reserve the key in a short transaction, then read the cart under the required transaction and locking strategy.
9. Validate that the cart is not empty, products are active, quantities are valid, and sufficient stock remains.
10. Create the order and order-item snapshots using the current product names and prices.
11. Deduct all stock, clear the cart items, change the cart row so its version changes, and mark the idempotency record completed atomically in the successful checkout transaction.

The submitted `If-Match` value is part of the request fingerprint. Retrying the same attempt must use the same idempotency key and the same `If-Match` value.

If a business validation fails, the checkout transaction must roll back: no order is created, no stock is deducted, and the cart remains unchanged. Final business-error responses are saved for the idempotency key so that a retry of the same attempt receives the same result. After a saved final business error, a new attempt requires a new idempotency key.

Unexpected infrastructure errors are not saved as final business results. If the outcome of a database commit is uncertain, the client must retry with the same key. The server must verify durable state before deciding whether to return a saved result or permit recovery; it must not assume that an uncertain checkout failed.

Responses:

- `201 Created` — order created. The body is the order representation and the `Location` header points to `/api/orders/{orderId}`.
- `400 Bad Request` — malformed request or an invalid `Idempotency-Key`.
- `401 Unauthorized` — unauthenticated request.
- `404 Not Found` — the user has no cart, with code `cart_not_found`.
- `409 Conflict` — business-rule conflict or an idempotency conflict.
- `412 Precondition Failed` — stale cart `ETag`.
- `428 Precondition Required` — `If-Match` is missing.
- `503 Service Unavailable` — the matching attempt is still in progress after the bounded wait, or the server cannot safely resolve an uncertain checkout state.

The exact response status and body for a final business error must be persisted and replayed consistently. Unexpected `5xx` infrastructure errors must not be represented as definitive checkout failures.

#### `GET /api/orders`

Returns orders belonging to the current user for the requested page.

Example response:

```json
{
  "items": [
    {
      "id": "order-id",
      "status": "Created",
      "createdAtUtc": "2026-01-15T12:30:00Z",
      "totalAmount": 39.98
    }
  ],
  "page": 1,
  "pageSize": 20,
  "totalCount": 1
}
```

Rules:

- Orders belonging to other users are never returned.
- Results are ordered by creation time, newest first, for stable pagination.
- Order items are not included in the list; use the order details endpoint.

#### `GET /api/orders/{orderId}`

Returns one order belonging to the current user.

Responses:

- `200 OK` — order found and owned by the current user.
- `404 Not Found` — order does not exist or belongs to another user, with code `order_not_found`.

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

#### `POST /api/orders/{orderId}/cancel`

Cancels an order in the `Created` state.

Rules:

- Only the owner can cancel the order.
- Cancellation changes the status to `Cancelled`.
- Stock is restored for every order item, including when a product is now inactive.
- The status change and all stock restoration happen in one transaction, guarded by a conditional status update so that only one concurrent request wins.
- Concurrent cancellation attempts must not restore stock more than once.
- Cancellation does not modify the user's cart.
- `If-Match` is not used on this endpoint.

Responses:

- `200 OK` — the updated order with status `Cancelled`.
- `404 Not Found` — order does not exist or belongs to another user.
- `409 Conflict` — the order has already been cancelled or cannot be cancelled in its current state.

## 4. Error format

Errors use the standard `ProblemDetails` shape with a stable `code` extension.

Example:

```json
{
  "type": "https://example.invalid/problems/cart-version-conflict",
  "title": "Cart version conflict",
  "status": 412,
  "detail": "The cart changed after it was retrieved. Fetch the latest cart and retry with an updated request.",
  "code": "cart_version_conflict"
}
```

The example `type` URI is illustrative. The implementation should use a consistent problem-type convention.

### 4.1 Error codes

The following codes are part of the API contract:

| Code | HTTP status | Meaning |
|---|---:|---|
| `validation_error` | 400 | Request fields, headers, or query parameters are invalid |
| `unauthenticated` | 401 | Authentication is missing or invalid |
| `product_not_found` | 404 | Product does not exist or is inactive |
| `cart_not_found` | 404 | The user does not have a cart yet |
| `cart_item_not_found` | 404 | Cart item does not exist |
| `order_not_found` | 404 | Order does not exist or is not owned by the current user |
| `cart_version_conflict` | 412 | The submitted `If-Match` value is stale |
| `precondition_required` | 428 | A required `If-Match` header is missing |
| `cart_empty` | 409 | Checkout was requested for an empty cart |
| `product_unavailable` | 409 | A product cannot be used for the requested operation |
| `insufficient_stock` | 409 | One or more products have insufficient stock |
| `idempotency_key_reused` | 409 | The same key was used with a different request |
| `order_already_cancelled` | 409 | The order has already been cancelled |
| `order_cannot_be_cancelled` | 409 | The order is not in a cancellable state |
| `idempotency_in_progress` | 503 | The matching checkout attempt is still being resolved |
| `health_unavailable` | 503 | The database is not reachable |

The implementation may add codes when required, but existing codes and their meanings must remain stable. In particular, `cart_version_conflict` keeps its name even though its status changed from `409` to `412` when the version moved to `If-Match`.

A `503` response is temporary. It never means that the checkout definitively failed, and it must not be stored as a final business result.

For insufficient stock, the response should identify every affected product using its product ID and name, read after the failed checkout transaction has rolled back. The list must not imply that stock is reserved after the response.

## 5. Concurrency and consistency requirements

HTTP responses must reflect the outcome of the underlying transaction.

- Cart mutations and checkout use the agreed cart-row locking strategy.
- Cart mutations and checkout validate the submitted cart `ETag` through `If-Match`.
- A successful checkout changes the cart row so that the previous `ETag` becomes invalid.
- Inventory deductions use atomic conditional updates that succeed only when sufficient stock remains.
- Checkout stock deductions, order creation, cart clearing, the cart-row version change, and successful idempotency completion commit atomically.
- A failed checkout must not leave a partial order, partial stock deductions, or a cleared cart.
- Cancellation status changes and stock restoration commit atomically and are guarded by a conditional status update.
- A concurrent cart update must not resurrect old cart contents after checkout has completed.
- Deadlocks are not retried in-process; the client retries with the same idempotency key or refetches the cart.

## 6. Idempotency record lifecycle

The checkout idempotency mechanism follows these rules:

- Keys are scoped to the authenticated user and must match the format defined in `../DECISIONS.md` section 10.
- A key is associated with a fingerprint of the request target and the submitted `If-Match` value.
- A matching completed request returns the persisted response without reading the current cart or creating another order.
- A matching in-progress request waits for a bounded period and then returns `503` with `idempotency_in_progress`; it must not execute checkout independently.
- A key associated with a different request returns `idempotency_key_reused`.
- Final business errors are persisted and replayed. A new attempt after a saved final business error requires a new key.
- Unexpected infrastructure errors are not persisted as final business results.
- Recovery of an old `InProgress` record happens on demand during a retry and requires an expired lease plus verification of durable database state. No background recovery service exists.
- If the commit outcome is uncertain, durable state must be checked before deciding whether the attempt completed or can safely be retried.

The exact database schema and recovery procedure are defined in `data-model.md` and `../adr/ADR-002-checkout-idempotency.md`.

## 7. Out of scope

The MVP API does not include:

- Payment processing
- Shipping and delivery
- Coupons or discounts
- Catalog administration
- User registration or production-grade authentication
- External messaging or background processing infrastructure
- Multi-warehouse inventory
