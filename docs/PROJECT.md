# Project Overview

## 1. Project Name

**Mini E-commerce**

## 2. Project Purpose

Mini E-commerce is an educational full-stack application that simulates the core workflow of a small online store.

The project is intended to practice backend engineering with .NET and relational databases, with particular attention to transaction management, concurrent operations, data consistency, and reliable business workflows.

The application will include a backend API and a frontend client. Development will begin with the backend. The frontend will be implemented after the backend's core functionality and contracts are established.

The project is designed as a modular monolithic application. Microservices and distributed infrastructure are outside the scope of the MVP.

## 3. Learning Objectives

The project should provide practical experience with the following topics.

### Backend Architecture

- Applying Clean Architecture without unnecessary abstractions.
- Separating domain logic, application use cases, infrastructure, and HTTP presentation.
- Organizing application functionality around features.
- Implementing commands and queries with MediatR.
- Centralizing request validation with FluentValidation and a MediatR pipeline behavior.

### Data Persistence

- Designing a relational data model.
- Using Microsoft SQL Server and Entity Framework Core.
- Managing schema changes through database migrations.
- Maintaining data integrity through database constraints and transactions.

### Concurrency and Consistency

- Preventing conflicting updates to a user's cart.
- Handling concurrent purchases of limited stock.
- Performing stock deductions atomically.
- Ensuring checkout either completes fully or leaves no partial business changes.
- Preventing duplicate orders when checkout requests are repeated.
- Ensuring concurrent cancellation requests cannot restore stock more than once.

### Testing

- Writing unit tests for business rules and application behavior.
- Writing integration tests against a real SQL Server database.
- Testing transaction boundaries, concurrency, idempotency, and user-data isolation.
- Verifying that important failure scenarios do not leave inconsistent data.

### Frontend

- Building a Vue 3 application with TypeScript and Vite.
- Managing client-side state with Pinia.
- Integrating the frontend with the backend API.
- Handling validation errors, business conflicts, and loading states.

## 4. Target Application

The application represents a small online store with a simple purchasing workflow:

1. A user views the active product catalog.
2. The user adds products to a personal cart.
3. The user changes quantities or removes cart items.
4. The user submits the cart to create an order.
5. The system validates product availability and deducts stock.
6. The user views their order history.
7. The user can cancel an eligible order.
8. The system restores the stock associated with a successfully cancelled order.

The application must preserve data consistency when operations fail or execute concurrently.

## 5. MVP Scope

### Included

- Development-only test authentication.
- Two seeded test users for isolation and concurrency scenarios.
- Read-only product catalog.
- Product activation and deactivation represented in the domain and database.
- User-specific shopping carts.
- Cart item creation, quantity updates, and removal.
- Stock availability validation.
- Order creation and order item snapshots.
- Order history and order details.
- Order cancellation and stock restoration.
- Transactional checkout.
- Protection against concurrent cart modifications.
- Atomic stock deductions.
- Checkout idempotency through `Idempotency-Key`.
- Consistent HTTP error responses using `ProblemDetails`.
- Unit tests and SQL Server integration tests.
- A Vue 3 frontend after the backend is established.

### Explicitly Excluded

The MVP does not include:

- Online payments or payment provider integrations.
- Shipping, delivery tracking, or fulfillment workflows.
- Coupons, discounts, or promotional campaigns.
- Product administration endpoints or an administrative interface.
- Customer registration, password recovery, OAuth, or social login.
- Complex role-based authorization.
- Microservices or distributed application infrastructure.
- Message brokers or event streaming.
- Taxes, shipping charges, or currency conversion.
- A production-ready identity management system.

## 6. Technology Stack

### Backend

- .NET 10
- ASP.NET Core Web API with Controllers
- Clean Architecture
- MediatR
- Entity Framework Core
- Microsoft SQL Server
- FluentValidation
- xUnit
- NSubstitute

### Frontend

- Vue 3
- TypeScript
- Vite
- Pinia

### Development Environment

- Local SQL Server installation.
- Database migrations managed through Entity Framework Core.
- Separate database configuration for integration tests.
- Configuration and secrets kept outside committed source code.

Specific package versions, project settings, and operational commands will be documented during implementation planning.

## 7. Architectural Direction

The backend will be organized into four projects:

- `MiniEcommerce.Domain`
- `MiniEcommerce.Application`
- `MiniEcommerce.Infrastructure`
- `MiniEcommerce.API`

These projects will reside under `src/Backend/`.

The frontend will reside under `src/Frontend/`.

Unit and integration tests will reside under `tests/`.

The Domain layer must not depend on infrastructure or presentation frameworks. Application use cases will depend on abstractions where appropriate, while Infrastructure will provide implementations for persistence and other technical concerns.

The project will avoid generic repositories, unnecessary shared projects, speculative abstractions, and premature architectural complexity.

Detailed layer responsibilities and dependency rules are defined in `architecture/architecture.md`.

## 8. Core Engineering Challenges

The project's main engineering challenges are not the number of endpoints, but the correctness of state transitions and database operations.

### Cart Concurrency

Concurrent cart updates and checkout must not silently overwrite newer state or resurrect cart items after checkout.

### Stock Consistency

Stock must never be deducted beyond the available quantity. A failed checkout must not create an order, partially deduct stock, or clear the cart.

### Transactional Cancellation

Order cancellation and restoration of stock must be atomic. Concurrent cancellation attempts must not restore the same stock more than once.

### Checkout Idempotency

Repeated requests with the same idempotency key must not create duplicate orders. Reusing a key with a different request payload must be rejected.

### User Isolation

Users must only access their own carts and orders. The API must derive user identity from the authenticated request context rather than trusting a user ID supplied by the client.

These behaviors will be specified in detail in `SPEC.md`, `DOMAIN.md`, and the relevant Architecture Decision Records.

## 9. Success Criteria

The project will be considered successful when:

- The solution follows the approved project structure and architecture.
- The backend can be configured and run against SQL Server.
- Database migrations can be applied successfully.
- The development test-authentication mechanism is unavailable in Production.
- The seeded test users can be used to verify data isolation.
- Catalog, cart, checkout, order history, and cancellation workflows function according to the specification.
- Concurrent operations preserve the required invariants.
- Repeated checkout requests do not produce duplicate orders.
- Failed business operations do not leave partial changes.
- Automated unit and integration tests cover critical scenarios.
- The frontend can use the documented API to complete the main purchasing workflow.
- Setup, configuration, and testing instructions are documented.

## 10. Development Strategy

The project will be developed incrementally.

The initial work is documentation and specification. No application implementation should begin until the documentation has been prepared and reviewed.

After documentation approval, development will proceed through the agreed roadmap, beginning with the backend foundation and continuing through the core purchasing workflow, testing, and frontend integration.

Each stage must have explicit scope and acceptance criteria. Future stages must not be implemented prematurely.

## 11. Project Constraints

The project prioritizes correctness, clarity, and educational value over feature count.

Implementation choices should be understandable, testable, and appropriate for a small application.

Production-grade distributed infrastructure is not a goal. However, database transactions, concurrency handling, idempotency, error handling, and automated testing must be treated as real engineering requirements.

Any material change to the agreed scope or architecture must be discussed and approved before implementation.