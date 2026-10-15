# Instructions for AI Agents

## 1. Purpose

These instructions define how AI agents must work with the Mini E-commerce repository.

The goal is to implement the project incrementally according to the approved requirements, architecture, domain rules, and technical decisions.

The agent must not independently expand the project scope or replace approved decisions with alternative designs.

## 2. Mandatory Documentation

Before implementing or modifying code, read the relevant project documentation.

Start with:

1. `README.md`
2. `docs/PROJECT.md`
3. `docs/SPEC.md`
4. `docs/DOMAIN.md`
5. `docs/DECISIONS.md`
6. `docs/ROADMAP.md`
7. `docs/architecture/architecture.md`
8. `docs/architecture/data-model.md`
9. `docs/architecture/api.md`
10. `docs/FRONTEND.md`, when working on the frontend
11. Relevant documents in `docs/adr/`

Some files may not exist during the initial documentation phase. Do not assume missing documents are approved specifications. Create or modify them only as part of the agreed documentation workflow.

## 3. Source of Truth

Use the documents according to their responsibilities:

- `docs/PROJECT.md` defines the project's purpose, scope, and goals.
- `docs/SPEC.md` defines functional requirements and acceptance criteria.
- `docs/DOMAIN.md` defines domain concepts, business rules, and invariants.
- `docs/DECISIONS.md` indexes approved technical and architectural decisions.
- `docs/architecture/architecture.md` defines application architecture and layer boundaries.
- `docs/architecture/data-model.md` defines the database model and persistence constraints.
- `docs/architecture/api.md` defines HTTP endpoints and API contracts.
- `docs/FRONTEND.md` defines frontend requirements and implementation conventions.
- `docs/ROADMAP.md` defines the implementation sequence and stage boundaries.
- `docs/adr/` contains detailed Architecture Decision Records.
- `README.md` provides an overview and navigation.
- `AGENTS.md` defines working rules for AI agents.

If documents conflict, do not silently choose one interpretation. Identify the conflict and ask for clarification before implementing the affected behavior.

Do not duplicate detailed specifications unnecessarily across multiple files. Update the document responsible for the relevant information and add references where appropriate.

## 4. Scope Control

Implement only functionality included in the approved MVP and the current roadmap stage.

Do not introduce the following unless explicitly approved:

- Payment processing.
- Delivery management.
- Coupons or discounts.
- Microservices.
- Message brokers.
- Complex authentication or authorization systems.
- Additional infrastructure or abstractions without a concrete requirement.
- Features that are not part of the agreed scope.

Do not add speculative abstractions, empty feature directories, or placeholder implementations without a clear purpose.

## 5. Architecture Rules

The backend follows Clean Architecture.

The backend projects are located under `src/Backend/PS.MiniEcommerce/`:

- `PS.MiniEcommerce.Domain`
- `PS.MiniEcommerce.Application`
- `PS.MiniEcommerce.Infrastructure`
- `PS.MiniEcommerce.API`

The solution is `src/Backend/PS.MiniEcommerce/PS.MiniEcommerce.slnx`. It uses the `.slnx` format and stays nested under the backend directory. The `PS.` prefix is deliberate and must be preserved in project names, namespaces, and paths. Do not rename projects or drop the prefix.

The test projects are `tests/PS.MiniEcommerce.UnitTests` and `tests/PS.MiniEcommerce.IntegrationTests`.

The frontend is located under `src/Frontend/`.

Keep responsibilities separated:

- **Domain:** domain entities, value objects, and business invariants. It must not depend on EF Core, ASP.NET Core, or MediatR.
- **Application:** use cases, commands, queries, DTOs, validation, application abstractions, and MediatR pipeline behaviors.
- **Infrastructure:** EF Core, SQL Server integration, persistence configuration, migrations, and implementations of application abstractions.
- **API:** controllers, dependency injection composition, authentication configuration, HTTP error handling, and health checks.

Dependencies must point inward toward Domain and Application. Domain must remain independent of infrastructure and presentation concerns.

A separate `Common` project is not part of the MVP. `PS.MiniEcommerce.Common` is not an agreed project: it is scheduled for removal in Phase 1 and must not be referenced, extended, or recreated. Do not create a `Common` project or folder; shared types belong to the layer that owns them.

Use feature-based organization in Application. Create feature folders when implementing actual functionality, not as empty scaffolding.

Use MediatR for application commands and queries.

Use FluentValidation through a centralized MediatR validation pipeline behavior.

Do not introduce a generic repository or Unit of Work abstraction without a specific, documented reason.

## 6. Technology Constraints

Use the approved stack:

- .NET 10.
- ASP.NET Core Controllers.
- MediatR.
- Entity Framework Core.
- Microsoft SQL Server.
- FluentValidation.
- xUnit.
- NSubstitute.
- Microsoft.AspNetCore.Mvc.Testing for API integration tests.
- Vue 3.
- TypeScript.
- Vite.
- Pinia.

Do not replace these technologies or introduce major alternatives without approval.

Use `decimal` for monetary values and preserve the specified SQL precision.

Keep configuration and connection strings outside source code. Never commit secrets. Development uses .NET user secrets; integration tests read `appsettings.Test.json` with a dedicated test database.

## 7. Business-Critical Correctness

Treat the following areas as correctness requirements, not optional optimizations:

- User data isolation.
- Cart ownership.
- Cart concurrency and stale updates.
- Atomic stock deduction.
- Transactional checkout.
- Preservation of the cart when checkout fails.
- Order item price and name snapshots.
- Transactional order cancellation and stock restoration.
- Checkout idempotency.
- Consistent handling of concurrent requests.

Follow the approved domain rules and ADRs when implementing these behaviors.

Do not replace database-level concurrency controls with application-only checks where the specification requires atomic SQL operations or transaction locking.

Do not claim that a transaction definitely failed or that an order was not created when the commit outcome is unknown. Follow the approved idempotency and recovery rules.

If the approved documentation does not define a necessary recovery or concurrency behavior, document the unresolved question and request approval before choosing a solution.

## 8. Authentication and Environment Safety

The initial development authentication mechanism uses the `X-Test-User` header with the approved test identities.

This mechanism must be registered only in the Development environment and must not be available in Production.

Unknown test-user values must not authenticate a request.

Never trust a client-supplied user ID to determine cart or order ownership.

Seed data must be safe to apply repeatedly and must not create duplicate users.

Integration tests must use a dedicated test database and must not accidentally modify a development or production database.

## 9. API and Error Handling

Use ASP.NET Core `ProblemDetails` for API errors.

Use FluentValidation for request and command validation where appropriate.

Follow the documented HTTP status codes and error contracts.

Do not introduce a custom API error format unless explicitly approved.

Do not expose stack traces, secrets, connection strings, or sensitive implementation details in API responses.

## 10. Testing Requirements

Write tests for implemented functionality.

Use:

- xUnit for unit and integration tests.
- NSubstitute for appropriate test doubles.
- Microsoft.AspNetCore.Mvc.Testing for tests that exercise the API host.
- A real SQL Server test database for integration tests that depend on SQL Server behavior.

Prioritize tests for business invariants, transaction boundaries, concurrency, authorization boundaries, and idempotency.

Do not treat in-memory database tests as a replacement for SQL Server integration tests when behavior depends on SQL Server locking, transactions, constraints, or `rowversion`.

Never run destructive test setup against a non-test database.

## 11. Implementation Workflow

Follow `docs/ROADMAP.md` in order.

For each stage:

1. Read the relevant requirements and decisions.
2. Confirm the stage's scope and acceptance criteria.
3. Implement only the agreed scope.
4. Add or update tests.
5. Run the relevant tests and build.
6. Fix regressions introduced by the changes.
7. Update documentation when an approved change affects it.
8. Report what changed, which checks passed, and what remains incomplete.

Do not silently skip failed tests or claim that commands succeeded when they were not executed successfully.

Do not implement future stages early merely because doing so seems convenient.

## 12. Documentation Changes

Documentation is part of the deliverable.

When an approved requirement or architectural decision changes:

- Update the document responsible for that information.
- Update `docs/DECISIONS.md` when the decision register is affected.
- Create or update an ADR when a significant architectural decision is introduced or changed.
- Update acceptance criteria and the roadmap when necessary.
- Keep links and references between documents consistent.

Do not change approved requirements or ADRs merely to match an implementation that deviates from them. Identify the deviation and request approval.

## 13. Communication and Uncertainty

When a requirement is ambiguous, incomplete, or contradictory:

1. Explain the ambiguity briefly.
2. Identify the affected behavior or design.
3. Offer a recommendation when useful.
4. Ask for a decision before implementing a behavior that materially affects the system.

Do not invent business rules.

Do not claim that a design is approved unless it has been explicitly agreed upon.

Keep implementation reports concise and specific.

## 14. Completion Criteria

A task is complete only when:

- The implementation matches the approved scope.
- Relevant tests have been added or updated.
- Available required checks have been run and their results reported.
- No known regression introduced by the change remains unresolved.
- Relevant documentation is consistent with the implementation.

If any criterion cannot be met, state the limitation explicitly.