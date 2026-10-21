# Documentation (English) — source of truth

This folder is the source of truth for all project documentation. The Russian companion under `docs/ru/` is a translation and must never override the English text.

## Bilingual rules

- `docs/en/` is the source of truth for all project documentation.
- `docs/ru/` is a companion translation. When EN and RU disagree, EN wins.
- The RU translation status is tracked inside each RU file via a header note (see `docs/ru/` stubs) or, for `DECISIONS.md` and ADRs, must be kept in sync strictly.
- Root-level [`README.md`](../../README.md) and [`AGENTS.md`](../../AGENTS.md) are outside the bilingual policy: the root README stays Russian as the human-facing entry point; [`AGENTS.md`](../../AGENTS.md) is now in Russian as of this iteration.

## Non-translatable tokens

- Code identifiers.
- Error codes.
- HTTP headers.
- SQL tokens.
- Entity names.
- ADR statuses.
- Config and environment keys.
- .NET type names.
- Frontend storage keys.
- API routes.
- ProblemDetails field names.

## Translation status

- RU stubs exist under `docs/ru/`.
- For `DECISIONS.md` and ADR files, RU must be kept strictly in sync when the EN file changes.
- For all other documents, an RU file may carry a `⚠ translation outdated (commit <sha>)` note if the EN changed and RU was not updated.

## Translation order

1. `PROJECT.md`
2. `DOMAIN.md`
3. `DECISIONS.md`
4. `adr/ADR-001-cart-concurrency.md`
5. `adr/ADR-002-checkout-idempotency.md`
6. `architecture/architecture.md`
7. `architecture/data-model.md`
8. `architecture/api.md`
9. `SPEC.md`
10. `FRONTEND.md`
11. `ROADMAP.md`

## Navigation

- [PROJECT.md](PROJECT.md)
- [SPEC.md](SPEC.md)
- [DOMAIN.md](DOMAIN.md)
- [DECISIONS.md](DECISIONS.md)
- [ROADMAP.md](ROADMAP.md)
- [FRONTEND.md](FRONTEND.md)
- [architecture/architecture.md](architecture/architecture.md)
- [architecture/data-model.md](architecture/data-model.md)
- [architecture/api.md](architecture/api.md)
- [adr/ADR-001-cart-concurrency.md](adr/ADR-001-cart-concurrency.md)
- [adr/ADR-002-checkout-idempotency.md](adr/ADR-002-checkout-idempotency.md)
