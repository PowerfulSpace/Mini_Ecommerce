# Backend Architecture

## 1. Purpose

This document defines the backend architecture of the Mini E-commerce MVP.

The backend follows Clean Architecture principles and separates business rules, application use cases, infrastructure concerns, and HTTP delivery.

The architecture should remain understandable for a single-developer project. It must not introduce abstractions or layers without a concrete need.

## 2. Solution Structure

The backend resides in `src/Backend/PS.MiniEcommerce/`. The solution file is `src/Backend/PS.MiniEcommerce/PS.MiniEcommerce.slnx` and uses the `.slnx` format.

The backend consists of four projects:

```text
src/Backend/PS.MiniEcommerce/
├── PS.MiniEcommerce.slnx
├── PS.MiniEcommerce.Domain/
├── PS.MiniEcommerce.Application/
├── PS.MiniEcommerce.Infrastructure/
└── PS.MiniEcommerce.API/
```

Automated tests are maintained separately:

```text
tests/
├── PS.MiniEcommerce.UnitTests/
└── PS.MiniEcommerce.IntegrationTests/
```

The `PS.` prefix is part of the agreed naming and is preserved in project names, namespaces, and paths (see `../DECISIONS.md` section 1.1).

### 2.1 PS.MiniEcommerce.Domain

Contains the core business model and business invariants.

Responsibilities:

- Domain entities and value objects where justified.
- Order and cart status definitions.
- Business rules that are independent of HTTP, EF Core, and infrastructure.
- Domain-specific types and exceptions where they provide clear value.

The Domain project must not depend on Application, Infrastructure, or API.

It must not contain:

- EF Core `DbContext` or persistence configurations.
- HTTP controllers or request DTOs.
- MediatR handlers.
- SQL queries.
- External service integrations.

Keep the domain model pragmatic. Do not introduce a domain event system, aggregate framework, or elaborate domain services without a demonstrated requirement.

### 2.2 PS.MiniEcommerce.Application

Contains use cases and application-level orchestration.

Responsibilities:

- MediatR commands and queries.
- Command and query handlers.
- Application request and response DTOs where appropriate.
- FluentValidation validators.
- Pipeline behaviors.
- Interfaces required by application use cases.
- Current-user abstraction.
- Orchestration of transactional business operations through appropriate interfaces.

Examples of use cases:

- Get active products.
- Get product details.
- Get the current user's cart.
- Add or update a cart item.
- Remove a cart item.
- Checkout.
- Get order history and order details.
- Cancel an order.

Application depends on Domain but must not depend on Infrastructure or API.

MediatR is used at the application boundary to dispatch commands and queries. Do not use it as a general-purpose event bus.

### 2.3 PS.MiniEcommerce.Infrastructure

Implements persistence and infrastructure-specific behavior.

Responsibilities:

- EF Core `DbContext`.
- Entity configurations and database mappings.
- EF Core migrations.
- Repository or persistence abstractions only where justified.
- SQL Server-specific locking and conditional stock updates.
- Implementations of interfaces defined by Application.
- Database initialization and Development seed data.
- Infrastructure-specific transaction handling.

Infrastructure depends on Application and Domain.

SQL Server-specific correctness requirements must be implemented explicitly. EF Core LINQ alone must not be assumed to generate the required lock hints.

Avoid duplicating application business workflows in Infrastructure. Infrastructure should implement persistence operations and the database mechanisms needed to preserve the agreed invariants.

### 2.4 PS.MiniEcommerce.API

The API project is the HTTP delivery layer.

Responsibilities:

- ASP.NET Core Controllers.
- HTTP request and response contracts where appropriate.
- Authentication and authorization configuration.
- Development-only test authentication.
- HTTP status code mapping.
- `ProblemDetails` error responses.
- Dependency injection composition.
- Middleware and application startup configuration.

Controllers should remain thin.

A controller should:

1. Receive an HTTP request.
2. Rely on framework-level binding and request validation where appropriate.
3. Dispatch an application command or query through MediatR.
4. Map the application result to the HTTP response.

Controllers must not:

- Access `DbContext` directly.
- Execute SQL queries.
- Implement checkout transactions.
- Modify inventory directly.
- Contain cart or order business workflows.

API depends on Application and Infrastructure for composition and runtime registration. It should not become a location for domain business rules.

## 3. Dependency Direction

The core dependency relationships are:

```text
PS.MiniEcommerce.Domain
        ↑
PS.MiniEcommerce.Application
        ↑
PS.MiniEcommerce.Infrastructure

PS.MiniEcommerce.API
        ├── PS.MiniEcommerce.Application
        └── PS.MiniEcommerce.Infrastructure
```

More precisely:

- Domain has no project dependency on the other application projects.
- Application references Domain.
- Infrastructure references Application and Domain.
- API references Application and Infrastructure.
- Unit tests may reference the projects whose behavior they test.
- Integration tests exercise the API and infrastructure against SQL Server.

The dependency direction must keep business rules independent of the database and HTTP framework.

Do not add project references that create circular dependencies.

## 4. Application Request Flow

A typical request follows this path:

```text
HTTP Request
    ↓
ASP.NET Core Controller
    ↓
MediatR Command or Query
    ↓
Validation Pipeline Behavior
    ↓
Application Handler
    ↓
Application Interface
    ↓
Infrastructure Implementation
    ↓
SQL Server
```

The result travels back through the handler and controller and is converted into an HTTP response.

The exact pipeline order and exception mapping must be configured consistently with the API contract.

Not every query requires an explicit repository abstraction. Keep persistence access straightforward where a separate abstraction would add no meaningful value.

## 5. Commands and Queries

Use a command/query separation within the Application project.

- **Commands** represent operations that change application state.
- **Queries** retrieve data without changing business state.

Examples of commands:

- `AddCartItemCommand`
- `UpdateCartItemQuantityCommand`
- `RemoveCartItemCommand`
- `CheckoutCommand`
- `CancelOrderCommand`

Examples of queries:

- `GetProductsQuery`
- `GetProductByIdQuery`
- `GetCartQuery`
- `GetOrdersQuery`
- `GetOrderByIdQuery`

These names are illustrative. Final names and request/response contracts may be adjusted to match the finalized API design.

Do not introduce separate read and write databases. CQRS here is an application code organization pattern, not a distributed architecture.

## 6. Application Organization

Organize application features by use case rather than placing all handlers into one large folder.

A possible structure is:

```text
src/Backend/PS.MiniEcommerce/PS.MiniEcommerce.Application/
├── Products/
│   ├── Queries/
│   └── DTOs/
├── Cart/
│   ├── Commands/
│   ├── Queries/
│   └── DTOs/
├── Orders/
│   ├── Commands/
│   ├── Queries/
│   └── DTOs/
├── Abstractions/
│   └── CurrentUser/
└── Behaviors/
```

The structure may be refined as features are implemented.

Do not create empty folders or abstractions for hypothetical future features.

## 7. Validation

Use FluentValidation for application request validation.

A centralized MediatR pipeline behavior should execute applicable validators before the handler.

Validation should distinguish between:

- Request-shape and input constraints.
- Business-rule validation.
- Database-enforced concurrency and integrity conditions.

Examples of input validation:

- Quantity must be a positive integer.
- Required request values must be present.
- An idempotency key must match the format defined in `../DECISIONS.md`.
- A required `If-Match` header must be present and must contain a single concrete entity-tag.
- Pagination parameters must be within the documented bounds.

Examples of business-rule checks:

- A product is active.
- The cart is not empty at checkout.
- A requested quantity is permitted by current stock.
- An order is eligible for cancellation.

Checks that depend on mutable database state must be performed safely within the relevant transaction and concurrency strategy. A FluentValidation rule alone cannot guarantee stock consistency.

The final mapping from validation and business failures to HTTP status codes must follow `architecture/api.md`.

## 8. Current User and Ownership

Application use cases must obtain the current user through an application abstraction such as `ICurrentUser`.

The API authentication context provides the authenticated identity. Infrastructure persistence operations and application handlers must not trust a user ID supplied in a request body to determine ownership.

Requirements:

- Cart operations apply only to the current user's cart.
- Order history contains only the current user's orders.
- Order details and cancellation enforce ownership.
- Requests for another user's order follow the approved not-found behavior.
- Catalog endpoints and `GET /health` are public and do not require authentication.
- Every other endpoint requires authentication and rejects anonymous requests.
- The Development-only `X-Test-User` mechanism must not be available in Production.

The current-user abstraction belongs to Application. Its runtime implementation and authentication configuration are wired through API composition.

## 9. Persistence and Transactions

EF Core is the default persistence technology. SQL Server-specific operations may use explicit SQL when required for correctness.

### 9.1 Cart concurrency

Cart mutations and checkout must follow the approved locking strategy described in `adr/ADR-001-cart-concurrency.md`.

The implementation must:

- Acquire the required cart lock within the transaction and keep it until the transaction finishes.
- Validate the client-supplied `If-Match` value against the current `rowversion` and expose the `rowversion` as the cart `ETag`.
- Avoid assuming that ordinary EF Core queries automatically acquire `UPDLOCK`.
- Update the cart row whenever cart contents change, including during checkout, so that a stale request cannot restore obsolete cart contents.

### 9.2 Stock consistency

Checkout must use atomic conditional stock deductions and verify affected row counts, processing product rows in a stable order by product identifier.

Order-item snapshots of product name and unit price must be read while the product rows are still locked by those updates.

All stock deductions for a checkout must participate in the same transaction as order creation, cart cleanup, and the cart-row version change.

If any required deduction fails, the checkout must not leave a partial order or partial stock changes. The insufficient-stock response is built from a separate read after the failed transaction has rolled back.

Cancellation must restore the exact ordered quantities and update the order status atomically, using a conditional status update so that only one concurrent request wins and restores stock.

### 9.3 Transaction ownership

Each use case must have a clearly defined transaction boundary.

Checkout orchestration is owned by the Application layer: the checkout handler defines the order of business validations and outcomes. The transaction itself is opened, committed, and rolled back by a narrow, checkout-specific interface defined in Application and implemented in Infrastructure, for example `ICheckoutTransactionExecutor`. This abstraction exists because EF Core transactions, explicit SQL locking, and conditional updates cannot live in Application, while the API and Infrastructure must not own the business workflow. This is a documented, purpose-specific abstraction and not a generic Unit of Work.

The arrangement must satisfy the following:

- The Application layer remains independent of EF Core.
- Infrastructure-specific locking and transaction behavior remains explicit.
- The use case cannot accidentally commit only part of a required business operation.
- Transaction boundaries are covered by SQL Server integration tests.

Do not add a generic Unit of Work abstraction or a generic repository merely to wrap `SaveChangesAsync`.

Transactions run at the isolation level defined in `../DECISIONS.md`. Deadlocks are not retried in-process for the MVP; the request fails and the client retries with the same idempotency key or refetches the cart.

The checkout idempotency reservation, bounded wait, and on-demand recovery strategy must follow `adr/ADR-002-checkout-idempotency.md`.

## 10. Error Handling

Use a consistent error model across the application.

Expected failures should be represented in a way that allows API to return the agreed `ProblemDetails` response.

Examples include:

- Invalid request values.
- Missing products or orders.
- Insufficient stock.
- Stale cart updates.
- Invalid checkout state.
- Reuse of an idempotency key with different content.
- Repeated cancellation of an already cancelled order.

Unexpected exceptions must be logged appropriately and mapped to a generic server error without exposing internal implementation details.

Do not return database exception messages or stack traces to clients.

Stable error codes and the `ProblemDetails` extension field are defined by `api.md`. The `type` URI convention may be finalized during implementation, but it must not invent a format that competes with the documented contract.

## 11. Dependency Injection and Configuration

API composition is responsible for registering the application's runtime dependencies.

- Register MediatR handlers and pipeline behaviors.
- Register FluentValidation validators.
- Register Application interfaces with their Infrastructure implementations.
- Configure EF Core with the selected SQL Server connection.
- Register authentication and authorization services.
- Register the Development-only test authentication scheme only in Development.
- Register the health check used by `GET /health`.

Connection strings and secrets must be supplied through appropriate configuration mechanisms and must not be committed to source control.

Do not introduce a separate dependency injection framework.

## 12. Testing Boundaries

### Unit tests

Use unit tests to verify isolated application and domain behavior, including:

- Input validation.
- Domain invariants.
- Status transitions.
- Order-total calculations.
- Expected business-rule outcomes.
- Handler behavior that does not require real database concurrency.

Use NSubstitute where a test double is useful. Avoid mocking EF Core query providers or relying on mocks to prove SQL Server behavior.

### Integration tests

Use integration tests with SQL Server to verify:

- EF Core mappings and migrations.
- Database constraints.
- Transactions and rollback.
- Cart locking, `If-Match` validation, and stale-update handling.
- Lazy cart creation under concurrent first requests.
- Atomic stock deductions.
- Checkout idempotency, including bounded wait and on-demand recovery.
- Concurrent cancellation.
- User isolation through the API.

An in-memory database is not a substitute for SQL Server when a test depends on SQL Server locking, rowversion, isolation, or affected-row behavior.

## 13. Architectural Constraints

The following rules are mandatory:

1. Domain does not depend on Infrastructure or API.
2. Application does not depend on Infrastructure or API.
3. Controllers do not contain business workflows.
4. Infrastructure owns EF Core mappings and SQL Server-specific persistence behavior.
5. Mutable database state is revalidated within the appropriate concurrency and transaction boundaries.
6. Cart concurrency, stock consistency, and idempotency must not rely solely on client-side behavior.
7. No generic repository, generic Unit of Work, domain event system, or additional project is introduced without an explicit need.
8. No payment, delivery, coupon, microservice, or message-broker functionality is added to the MVP.

## 14. Related Documents

- `../PROJECT.md`
- `../SPEC.md`
- `../DOMAIN.md`
- `../DECISIONS.md`
- `../ROADMAP.md`
- `data-model.md`
- `api.md`
- `../adr/ADR-001-cart-concurrency.md`
- `../adr/ADR-002-checkout-idempotency.md`
- `../../AGENTS.md`