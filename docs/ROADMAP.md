# Development Roadmap

## 1. Purpose

This document defines the planned implementation sequence for the Mini E-commerce MVP.

Development must proceed incrementally. Each phase should produce a verifiable result before the next phase begins.

The roadmap is a development plan, not a substitute for the functional specification, architecture documents, or approved ADRs.

If implementation reveals an unresolved requirement or a conflict between documents, stop work on the affected behavior and request clarification.

## 2. Development Principles

- Complete the documentation and resolve blocking design questions before implementing dependent behavior.
- Build the backend before the frontend.
- Prefer small, independently verifiable changes.
- Keep the solution buildable throughout development.
- Add tests alongside the behavior they verify.
- Test database-specific behavior against SQL Server.
- Do not replace transactional or concurrency requirements with simpler in-memory assumptions.
- Do not implement out-of-scope features.
- Update documentation when an approved decision or contract changes.

## 3. Phase Overview

| Phase | Name | Main outcome |
|---|---|---|
| 0 | Documentation and design closure | Consistent specifications and resolved blocking questions |
| 1 | Solution and project foundation | Buildable .NET solution with correct project references |
| 2 | Infrastructure foundation | SQL Server, EF Core, migrations, and seed data |
| 3 | Application and API foundation | MediatR, validation, error handling, and authentication setup |
| 4 | Product catalog | Working catalog endpoints |
| 5 | Shopping cart | Persistent cart with validation and concurrency protection |
| 6 | Checkout and idempotency | Transactional order creation and safe retries |
| 7 | Order history and cancellation | Order queries and atomic stock restoration |
| 8 | Backend verification | Comprehensive unit and SQL Server integration tests |
| 9 | Frontend foundation | Vue application and API client |
| 10 | Frontend shopping workflow | Catalog, cart, checkout, and order screens |
| 11 | End-to-end verification | Verified MVP workflow and updated documentation |

Phases may be refined as implementation proceeds, but dependencies and acceptance criteria must remain explicit.

## 4. Phase 0 — Documentation and Design Closure

### Goals

Finalize the specifications needed to implement the backend without guessing important behavior.

### Tasks

- Review `PROJECT.md`, `SPEC.md`, `DOMAIN.md`, `DECISIONS.md`, and `FRONTEND.md`.
- Complete `architecture/architecture.md`.
- Complete `architecture/data-model.md`.
- Complete `architecture/api.md`.
- Review `adr/ADR-001-cart-concurrency.md`.
- Review `adr/ADR-002-checkout-idempotency.md`.
- Resolve blocking questions concerning cart concurrency and idempotency recovery.
- Finalize API DTOs, status codes, stable error codes, and `ProblemDetails` extensions.
- Define integration-test database setup and cleanup.
- Confirm the repository structure and development workflow.

### Exit criteria

- The documents do not contain unresolved contradictions.
- Every implementation-critical business rule has an agreed behavior.
- The API contract is sufficiently detailed to implement both backend and frontend.
- Cart locking, stale-update detection, checkout retries, and abandoned idempotency attempts have defined behavior.
- No production-critical decision is silently delegated to the implementation agent.

Do not begin dependent implementation while blocking questions remain unresolved.

## 5. Phase 1 — Solution and Project Foundation

### Goals

Create a buildable .NET solution with the agreed project structure.

### Tasks

- Create `MiniEcommerce.sln`.
- Create the backend projects:
  - `MiniEcommerce.Domain`
  - `MiniEcommerce.Application`
  - `MiniEcommerce.Infrastructure`
  - `MiniEcommerce.API`
- Create the test projects:
  - `MiniEcommerce.UnitTests`
  - `MiniEcommerce.IntegrationTests`
- Add project references according to Clean Architecture.
- Configure nullable reference types and other agreed compiler settings.
- Add only the dependencies required for the current phase.
- Verify that the solution builds and tests execute.

### Exit criteria

- All projects exist in the agreed locations.
- Project references respect architecture boundaries.
- The solution builds successfully.
- Both test projects can run.
- No business behavior has been added prematurely.

## 6. Phase 2 — Infrastructure Foundation

### Goals

Establish database persistence and a reproducible local development environment.

### Tasks

- Configure SQL Server connectivity.
- Add EF Core configuration and database context.
- Implement the agreed initial entities and database mappings.
- Configure monetary precision using `decimal(18,2)`.
- Configure SQL Server `rowversion` for the cart concurrency mechanism.
- Add migrations.
- Implement idempotent Development seed data for Alice, Bob, and the initial catalog.
- Configure safe local connection-string management.
- Document database creation, migration, and reset procedures.

### Exit criteria

- The application can connect to the configured SQL Server database.
- Migrations create the expected schema.
- Development seed data can be applied repeatedly without duplication.
- Database precision and concurrency mappings match the approved design.
- Database setup and reset procedures are documented.

## 7. Phase 3 — Application and API Foundation

### Goals

Implement the common infrastructure required by feature endpoints.

### Tasks

- Configure dependency injection.
- Register MediatR handlers.
- Register FluentValidation validators.
- Add a centralized validation pipeline behavior.
- Implement consistent `ProblemDetails` error handling.
- Implement Development-only test authentication.
- Ensure the test authentication scheme is not registered in Production.
- Implement the `ICurrentUser` abstraction.
- Add health checks or a minimal health endpoint if required by the agreed API design.
- Add basic API and application-layer tests.

### Exit criteria

- Application commands and queries can be dispatched through MediatR.
- Validation failures use the agreed API error format.
- Authenticated user identity is derived from the request context.
- Alice and Bob can be used for local development.
- The test authentication mechanism is unavailable in Production.
- No feature accepts an arbitrary client-supplied user ID to determine ownership.

## 8. Phase 4 — Product Catalog

### Goals

Implement read-only catalog access.

### Tasks

- Implement the product list query.
- Return active products only.
- Implement product details.
- Apply the approved not-found behavior for unavailable or missing products.
- Define response DTOs according to the API contract.
- Add unit and integration tests.

### Exit criteria

- The catalog returns active products.
- Product details follow the approved not-found behavior.
- No product administration endpoints exist.
- Monetary values are represented consistently.
- Catalog behavior is covered by tests.

## 9. Phase 5 — Shopping Cart

### Goals

Implement persistent user-specific cart operations and concurrency protection.

### Tasks

- Implement retrieval of the current user's cart.
- Implement adding a product to the cart.
- Increase quantity when adding a product already present.
- Implement quantity updates.
- Implement item removal.
- Validate positive integer quantities.
- Validate product activity and stock according to the specification.
- Implement explicit cart locking using the approved SQL Server mechanism.
- Implement stale-update detection using the approved precondition and `rowversion` strategy.
- Ensure cart queries and mutations respect user ownership.
- Add unit and SQL Server integration tests.

### Exit criteria

- Each user has an independent persistent cart.
- Cart operations obey the approved quantity and stock rules.
- Inactive products cannot be added or updated for purchase.
- Failed mutations do not leave partial state.
- Concurrent cart operations follow the approved locking and conflict behavior.
- Stale requests cannot resurrect obsolete cart contents after checkout.
- Integration tests verify the actual SQL Server behavior.

## 10. Phase 6 — Checkout and Idempotency

### Goals

Implement atomic checkout with correct stock handling and safe retries.

### Tasks

- Require an `Idempotency-Key`.
- Implement user-scoped idempotency records.
- Implement the approved initial reservation transaction.
- Validate that the cart is non-empty.
- Validate product activity and stock.
- Acquire the cart lock using the approved locking strategy.
- Deduct stock using atomic conditional updates.
- Process product stock changes in a stable order where required.
- Create an order and its item snapshots.
- Calculate the order total from the saved unit prices and quantities.
- Clear cart items while preserving the cart record.
- Commit order creation, stock changes, cart cleanup, and the completed idempotency result consistently.
- Persist final business-rule failures according to the approved strategy.
- Implement recovery and retry behavior for abandoned attempts according to the finalized design.
- Add unit and SQL Server integration tests.

### Exit criteria

- Successful checkout creates exactly one order for an attempt.
- Stock is deducted atomically and cannot become negative through checkout.
- Any checkout failure rolls back all business changes.
- Failed checkout preserves the cart.
- Successful checkout clears cart items but preserves the cart.
- Repeating a request with the same key and content returns the saved result.
- Reusing a key with different content produces the approved conflict.
- Concurrent requests with the same key do not execute checkout twice.
- Uncertain outcomes are handled without blindly creating a second order.
- Tests cover stock races, transaction rollback, and idempotency recovery.

## 11. Phase 7 — Order History and Cancellation

### Goals

Implement order retrieval and safe cancellation.

### Tasks

- Implement order history for the current user.
- Implement order details using saved order-item snapshots.
- Enforce order ownership.
- Implement cancellation for eligible orders.
- Change order status and restore stock in one transaction.
- Restore the exact quantities recorded in the order.
- Handle concurrent cancellation attempts.
- Define and test the behavior when the order is already cancelled.
- Add unit and SQL Server integration tests.

### Exit criteria

- Users can retrieve only their own orders.
- Historical product names and prices come from order snapshots.
- Only eligible orders can be cancelled.
- Cancellation restores stock exactly once.
- Concurrent cancellation attempts cannot restore stock more than once.
- Repeated cancellation returns the approved conflict response.
- Cancellation does not modify the current cart.

## 12. Phase 8 — Backend Verification

### Goals

Verify that the backend satisfies the functional and consistency requirements.

### Tasks

- Review unit-test coverage for business rules.
- Complete SQL Server integration tests for transactional behavior.
- Verify concurrent cart updates.
- Verify checkout versus cart-update races.
- Verify simultaneous checkout attempts against limited stock.
- Verify idempotency under repeated and concurrent requests.
- Verify cancellation races.
- Verify user isolation between Alice and Bob.
- Verify consistent API error responses.
- Review logs and ensure internal exception details are not exposed to clients.
- Run the complete build and test suite.

### Exit criteria

- All automated tests pass.
- Critical concurrency and transaction scenarios have integration-test coverage.
- User isolation is verified.
- API behavior matches the approved contract.
- No known blocking correctness defects remain.
- Local setup instructions are sufficient for another developer to run the backend.

## 13. Phase 9 — Frontend Foundation

### Goals

Create the Vue application and establish API communication.

### Tasks

- Create the Vite application with Vue 3 and TypeScript.
- Configure Vue Router.
- Configure Pinia.
- Implement a small API client.
- Configure the API base URL.
- Implement Development-only selection of Alice or Bob.
- Add shared request and error-handling utilities.
- Define TypeScript contracts based on the finalized backend API.
- Add the minimum required frontend testing setup.

### Exit criteria

- The frontend starts locally.
- Routes and shared state work.
- API requests reach the backend.
- Development identity selection works without leaking state between users.
- API errors can be parsed and displayed.
- No speculative API contract is embedded in the client.

## 14. Phase 10 — Frontend Shopping Workflow

### Goals

Implement the user-facing shopping workflow.

### Tasks

- Implement the product catalog.
- Implement product details.
- Implement the cart screen.
- Implement quantity updates and item removal.
- Display stock and availability errors.
- Implement checkout with idempotency-key reuse for retries.
- Implement order confirmation.
- Implement order history and details.
- Implement order cancellation.
- Add loading, empty, error, and success states.
- Ensure responsive layouts and basic accessibility.
- Add appropriate frontend tests.

### Exit criteria

- A user can browse products, manage a cart, and complete checkout.
- Checkout retries follow the idempotency contract.
- The UI handles business conflicts and unknown checkout outcomes correctly.
- Order history and details show saved order snapshots.
- Cancellation updates the displayed order state.
- Switching between test users does not expose another user's data.
- Core screens work on desktop and mobile layouts.

## 15. Phase 11 — End-to-End Verification

### Goals

Verify the complete MVP through realistic user workflows.

### Tasks

- Run the application against a clean local SQL Server database.
- Verify the Alice shopping workflow from catalog to order.
- Verify the Bob workflow and user isolation.
- Verify stock exhaustion and checkout rollback.
- Verify retries after a lost or delayed checkout response.
- Verify concurrent cart operations and stale updates.
- Verify cancellation and exact stock restoration.
- Verify that the frontend reflects server-authoritative state.
- Review error messages and logs.
- Update `README.md` with final setup and execution instructions.
- Update documentation for any approved contract or behavior changes.

### Exit criteria

- The core end-to-end workflows pass.
- Critical transactional and concurrency guarantees have automated coverage.
- The backend and frontend can be started using documented instructions.
- No known blocking defects remain.
- The MVP stays within the approved scope.
- Documentation matches the implemented behavior.

## 16. Definition of Done

A feature or phase is complete only when:

- Its agreed requirements are implemented.
- The code follows the architecture boundaries.
- Relevant automated tests have been added and pass.
- SQL Server-specific behavior has been verified where applicable.
- Error handling follows the API contract.
- No unresolved critical design question has been silently bypassed.
- Relevant documentation has been updated.
- The solution remains buildable.

A successful build alone does not prove that transaction, concurrency, or idempotency requirements are satisfied.

## 17. Change Management

The roadmap may be reordered or refined when implementation provides new information.

However:

- Do not skip a dependency without an explicit reason.
- Do not begin frontend integration against an unstable or invented API contract.
- Do not weaken acceptance criteria merely to complete a phase faster.
- Record significant approved changes in `DECISIONS.md` and the relevant ADRs.
- If a new requirement changes the MVP scope, obtain approval before implementation.

## 18. Related Documents

- `PROJECT.md`
- `SPEC.md`
- `DOMAIN.md`
- `DECISIONS.md`
- `FRONTEND.md`
- `architecture/architecture.md`
- `architecture/data-model.md`
- `architecture/api.md`
- `adr/ADR-001-cart-concurrency.md`
- `adr/ADR-002-checkout-idempotency.md`
- `AGENTS.md`