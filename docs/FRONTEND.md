# Frontend Specification

## 1. Purpose

This document defines the frontend scope, technology choices, user interface structure, and integration principles for the Mini E-commerce MVP.

The frontend will be implemented after the backend API contract and core backend behavior are sufficiently stable.

The frontend must remain simple and focused on the main shopping workflow. It must not introduce functionality outside the approved MVP scope.

## 2. Technology Stack

The planned frontend stack is:

- Vue 3
- TypeScript
- Vite
- Pinia for shared application state
- Vue Router for client-side navigation
- Native Fetch API or a small HTTP client abstraction for backend requests

The exact dependency versions will be selected when frontend implementation begins.

Do not introduce a large UI framework, state-management library, or additional abstraction without a concrete need.

## 3. Application Goals

The frontend must allow a user to:

1. Browse the active product catalog.
2. View product details.
3. Add products to the cart.
4. Change cart quantities or remove items.
5. See unavailable products and stock-related errors.
6. Complete checkout.
7. View order history and order details.
8. Cancel an eligible order.
9. Understand loading states, empty states, validation errors, and conflicts.

The application should make the consequences of an action clear, particularly when the backend rejects an operation because of stock changes or concurrent requests.

## 4. Development Authentication

During local development, the backend supports the test identities `alice` and `bob` through the Development-only `X-Test-User` request header.

The frontend should provide a simple development-only way to select one of these test identities.

The selected identity must be included in requests that require authentication.

Requirements:

- The development identity selector must not be treated as production authentication.
- Do not implement customer registration, passwords, or a custom authentication system.
- Do not send arbitrary user IDs in request bodies to select cart or order ownership.
- Do not include the test authentication mechanism in the production build or production configuration.
- Switching identities should cause user-specific data to be reloaded so that Alice's cart and orders are never displayed as Bob's.

The exact implementation of the development identity selector will be decided during frontend setup.

## 5. Routes and Screens

The following routes are planned. Exact URL patterns may be adjusted during implementation, provided that navigation remains clear and consistent.

| Route | Screen | Purpose |
|---|---|---|
| `/` | Product catalog | Browse active products |
| `/products/:id` | Product details | View product information |
| `/cart` | Shopping cart | Review and modify cart items |
| `/orders` | Order history | View the current user's orders |
| `/orders/:id` | Order details | View an order and its items |

A separate checkout page is optional. Checkout may be initiated from the cart if this provides a simpler user experience.

A successful checkout should navigate to the created order's details page or another clearly identified order confirmation screen.

## 6. Product Catalog

The catalog screen should display active products returned by the backend.

Each product entry should show, where available:

- Product name
- Short description
- Current price in USD
- Availability or stock information when exposed by the API
- An action to open product details
- An action to add the product to the cart

Requirements:

- Do not calculate or invent stock availability on the client.
- Do not assume that a product remains available after the catalog response has been received.
- Disable obviously invalid interactions where appropriate, but rely on the backend as the final authority.
- Display a useful empty state when no active products are returned.
- Display loading and request-error states.
- The catalog is public and must be requested without an authentication header.
- The product list is paginated. Load pages on demand and do not request page sizes above the documented maximum.

## 7. Product Details

The product details screen should show the product's available information and provide an action to add it to the cart.

If the product cannot be retrieved, display a not-found or unavailable state.

Do not implement product creation, editing, deactivation, or deletion in the MVP frontend.

## 8. Shopping Cart

The cart screen should display the current user's persistent cart.

For each cart item, show:

- Product name
- Current product price, when available
- Requested quantity
- Line total, when sufficient information is available
- Availability status
- A quantity update action
- A remove action

Also show the cart total when it can be calculated from the returned data.

### 8.1 Cart behavior

- The first `GET /api/cart` for a user creates the cart on the server. Treat `404` with code `cart_not_found` on a mutation as a signal that the cart must be fetched first.
- Store the `ETag` returned with every cart response and send it back through the `If-Match` header on every cart mutation and on checkout. Do not place a version field in request bodies.
- Adding an existing product follows the backend rule that its quantity is increased.
- Quantity must be a positive integer.
- Removing an item must use the dedicated remove operation rather than sending quantity zero. The delete request has no body.
- The frontend must not silently reduce a quantity to fit available stock.
- If the backend rejects a quantity update, retain or reload the authoritative server state and explain the failure.
- If the cart is empty, show a clear empty state and a link to the catalog.
- An inactive product may remain in the cart but must be identified as unavailable and must not be presented as purchasable.
- Failed checkout must not cause the frontend to clear the cart.

### 8.2 Concurrent cart operations

The backend rejects a stale cart operation with `412 Precondition Failed` and code `cart_version_conflict`, and a missing `If-Match` with `428 Precondition Required` and code `precondition_required`.

When this happens:

1. Explain that the cart changed or the precondition was missing.
2. Reload the cart from the backend to obtain the current `ETag`.
3. Show the current server state.
4. Do not automatically repeat a stale mutation without obtaining the required current `ETag`.

The client must not assume that a locally cached cart or `ETag` is authoritative.

## 9. Checkout

Checkout is initiated from the cart.

Before sending the request, the frontend should:

- Verify that the cart contains items.
- Prevent accidental duplicate submissions while a request is in progress.
- Generate an idempotency key for the checkout attempt, using the documented key format.
- Preserve that key when retrying the same attempt.
- Send the current cart `ETag` through the `If-Match` header.

### 9.1 Idempotency behavior

The backend requires an `Idempotency-Key` header and an `If-Match` header for checkout.

The frontend must follow these rules:

- A retry of the same checkout attempt must reuse the same key and the same `If-Match` value.
- A genuinely new attempt must use a new key.
- Do not generate a new key merely because a request timed out or the response was lost.
- Do not automatically retry checkout using a new key when the outcome of the previous request is unknown.
- If the backend returns `503` with code `idempotency_in_progress`, wait briefly and retry the same request with the same key and the same `If-Match` value.
- After the backend has saved a final business error for a key, a new attempt requires a new key and a fresh cart `ETag`. Reusing the old key only replays the saved error.
- Once a successful order is confirmed, navigate to that order.

The exact client-side persistence mechanism for an outstanding idempotency key will be selected during implementation. It must support safe retry behavior without creating a second order.

### 9.2 Checkout results

On success, display an order confirmation and the relevant order information.

On business-rule failure:

- Show the error returned by the backend.
- Preserve the cart.
- Reload authoritative cart or product information when appropriate, including the current `ETag`.
- Make it clear when the user needs to review the cart before trying again, and generate a new idempotency key for that new attempt.

Do not treat a network failure, an unexpected server error, or a `503` `idempotency_in_progress` response as proof that checkout failed.

## 10. Orders

### 10.1 Order history

The order history screen should display the current user's orders for the current page. Load further pages on demand and respect the documented maximum page size.

Where returned by the API, show:

- Order identifier
- Creation time
- Status
- Total amount

An empty history should have a useful empty state.

### 10.2 Order details

The order details screen should display:

- Order identifier
- Creation time
- Current status
- Order items
- Product names captured at checkout
- Unit prices captured at checkout
- Quantities
- Total amount

Order details must use the saved order snapshot returned by the backend. They must not substitute current catalog prices or names for historical order values.

### 10.3 Cancellation

A `Created` order may be cancelled according to the backend contract.

The frontend should:

- Show a cancellation action only when appropriate.
- Ask for confirmation before cancellation.
- Display the updated order status after success.
- Explain conflicts if the order can no longer be cancelled.
- Refresh the order details after a conflict when appropriate.

A cancelled order must not be presented as a successful active order.

## 11. API Integration

All business operations must be performed through the backend API.

The frontend must not connect directly to SQL Server or reproduce backend business rules as its source of truth.

Use a small API client layer to centralize:

- Base URL configuration
- Request construction
- JSON serialization and deserialization
- Development authentication headers
- Idempotency headers for checkout
- HTTP error handling
- `ProblemDetails` parsing

Keep API transport logic separate from page components.

Use TypeScript types for API request and response contracts. These types should reflect the approved backend API contract rather than speculative fields.

Do not invent final endpoint paths, request properties, response properties, or error codes when the backend contract has not yet been finalized.

## 12. State Management

Use Pinia for shared state when it is genuinely needed, such as:

- Current development identity
- Cart state
- Shared request status or other cross-screen state, if justified

Do not place every component's local state into Pinia.

The backend remains authoritative for products, cart contents, stock, order status, and order totals.

After mutations, update shared state from the server response or reload the affected resource.

Avoid optimistic updates for operations where concurrency or stock correctness could make the displayed result misleading.

## 13. Error Handling and User Feedback

The frontend should distinguish between:

- Validation errors, including an invalid idempotency key or query parameters
- Not-found responses, including `cart_not_found`
- Business conflicts, including insufficient stock
- Stale cart versions reported as `412 Precondition Failed`
- Missing preconditions reported as `428 Precondition Required`
- Temporary checkout states reported as `503 Service Unavailable`
- Authentication failures
- Network failures
- Unexpected server errors
- Checkout outcomes that remain unknown

Use the backend's `ProblemDetails` response when available.

Do not display raw stack traces, database errors, or internal exception details to users.

Messages should explain what happened and, where possible, what the user can do next.

Do not assume that all `409 Conflict` responses have the same meaning. Use stable backend error codes once they are defined.

## 14. Visual Design and Accessibility

The UI should be clean, readable, and responsive.

Requirements:

- Support desktop and mobile layouts.
- Use semantic HTML elements.
- Ensure form controls have accessible labels.
- Provide visible focus indicators and keyboard-accessible interactions.
- Make loading, error, empty, and success states distinguishable.
- Format USD amounts consistently.
- Avoid unnecessary animations and complex visual effects.

A dedicated design system is not required for the MVP.

## 15. Testing

Frontend testing scope and tooling will be selected when implementation begins.

At minimum, verify the following behavior manually or through automated tests:

- Catalog loading, pagination, and empty states
- Adding, updating, and removing cart items with the current `ETag`
- Handling stock and validation errors
- Handling stale cart conflicts and missing `If-Match`
- Successful checkout
- Retrying checkout with the same idempotency key
- Retrying after `503` with code `idempotency_in_progress`
- Generating a new key after a saved final business error
- Handling an unknown checkout outcome
- Displaying order history and order snapshots
- Cancelling an eligible order
- Switching between Alice and Bob without leaking user-specific state

Backend integration tests remain responsible for proving database transactions, stock consistency, concurrency, and idempotency.

## 16. Out of Scope

The frontend MVP does not include:

- Payment processing
- Shipping or delivery management
- Coupons or discounts
- Customer registration or production identity management
- Product administration
- Real-time inventory updates
- Offline checkout
- A complex design system
- A dedicated administrative interface

## 17. Resolved Implementation Details

Endpoint paths, DTO schemas, error codes, and the cart precondition mechanism are defined in `architecture/api.md` and are not open questions.

The details that were left open for frontend implementation have been decided during Phase 9–10. They do not change the backend contract.

### 17.1 Outstanding checkout idempotency key

- The outstanding key is persisted in `sessionStorage` under the name `mini-ecommerce:checkout-key` (`src/utils/idempotency.ts`, `KEY_STORAGE_NAME`). `sessionStorage` is used because the key is scoped to a single browser tab/session and must not leak across tabs.
- When `sessionStorage` is unavailable (SSR, private mode, storage disabled), an in-memory fallback preserves retry behavior for the page lifetime.
- The key is generated as a UUID v4, which satisfies the documented format in `DECISIONS.md` §10. It is created on the first checkout attempt and reused for retries of the same attempt. It is cleared only after a confirmed success or a persisted final business error.

### 17.2 Stale or missing cart precondition (`412` / `428`)

- A `412 cart_version_conflict` or `428 precondition_required` is treated as a version conflict: the cart is re-fetched to obtain the current `ETag` and the authoritative server state, and the conflict is surfaced to the user. The stale mutation is never replayed automatically (`src/stores/cart.ts`, `runMutation`).
- Checkout handles the same codes as final business errors: the idempotency key is spent, the cart is re-fetched, and the user must start a new attempt with a new key (`src/stores/checkout.ts`).

### 17.3 Cart `ETag`

- The `ETag` is held in `cartStore` (`src/stores/cart.ts`). It is updated from every cart response (read or mutation) and sent back through `If-Match` on every cart mutation and on checkout. No version field is placed in request bodies.
- The cart service (`src/services/api/cart.ts`) rejects a cart response that does not carry an `ETag`, because a missing version would make subsequent mutations unsafe.

### 17.4 Development identity selector

- The selector lives in `src/components/layout/Header.vue` and is rendered only when `import.meta.env.DEV` is true, so it is absent from the production build.
- The selected identity is stored in `localStorage` (`mini-ecommerce:test-user`) and attached as the `X-Test-User` header by `apiClient`. Public catalog requests opt out via `omitTestUserHeader` so they are sent without an identity header.
- Switching identity resets user-scoped stores so another user's cart and orders are never shown.

### 17.5 Order confirmation

- After a successful checkout the client navigates to the order confirmation route, whose view (`OrderConfirmationView.vue`) immediately redirects to `/orders/:id`. The order details screen is the single source of truth; the confirmation screen does not duplicate its UI.

### 17.6 Testing tooling

- Frontend tests use Vitest with `@vue/test-utils` and `happy-dom`. Dependency versions are pinned in `package.json`.

## 18. Related Documents

- `PROJECT.md`
- `SPEC.md`
- `DOMAIN.md`
- `DECISIONS.md`
- `ROADMAP.md`
- `architecture/architecture.md`
- `architecture/data-model.md`
- `architecture/api.md`
- `adr/ADR-001-cart-concurrency.md`
- `adr/ADR-002-checkout-idempotency.md`