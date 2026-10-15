# Mini E-commerce

Учебный full-stack проект интернет-магазина, предназначенный для практического изучения backend-разработки на .NET, работы с реляционной базой данных, транзакций, конкурентного доступа и согласованности данных.

## Project Status

**Current phase:** Documentation approved, solution foundation (Phase 1).

Проектная документация согласована. Каркас backend-проектов и тестовых проектов создан в рабочем дереве; solution `PS.MiniEcommerce.slnx` пока пуст и наполняется проектами в рамках Phase 1 roadmap (`docs/ROADMAP.md`).

## Project Goals

Проект предназначен для практики следующих инженерных задач:

- Построение backend-приложения на ASP.NET Core с использованием Clean Architecture.
- Разделение бизнес-логики, прикладных сценариев и инфраструктуры.
- Использование MediatR для обработки команд и запросов.
- Работа с SQL Server и Entity Framework Core.
- Реализация транзакционных операций.
- Обработка конкурентного доступа к корзине и товарным остаткам.
- Обеспечение идемпотентности оформления заказа.
- Написание модульных и интеграционных тестов.
- Создание frontend-приложения с использованием Vue 3 и TypeScript.

## Technology Stack

### Backend

- .NET 10
- ASP.NET Core Web API — Controllers
- Clean Architecture
- MediatR
- Entity Framework Core
- Microsoft SQL Server
- FluentValidation
- xUnit
- NSubstitute
- Microsoft.AspNetCore.Mvc.Testing

### Frontend

- Vue 3
- TypeScript
- Vite
- Pinia

### Database

Microsoft SQL Server. Локальная разработка выполняется с использованием установленного SQL Server, без обязательного использования Docker.

## Project Structure

```text
MiniEcommerce/
├── AGENTS.md
├── README.md
├── docs/
│   ├── PROJECT.md
│   ├── SPEC.md
│   ├── DOMAIN.md
│   ├── DECISIONS.md
│   ├── FRONTEND.md
│   ├── ROADMAP.md
│   ├── architecture/
│   │   ├── architecture.md
│   │   ├── data-model.md
│   │   └── api.md
│   └── adr/
│       ├── ADR-001-cart-concurrency.md
│       └── ADR-002-checkout-idempotency.md
├── src/
│   ├── Backend/
│   │   └── PS.MiniEcommerce/
│   │       ├── PS.MiniEcommerce.slnx
│   │       ├── PS.MiniEcommerce.Domain/
│   │       ├── PS.MiniEcommerce.Application/
│   │       ├── PS.MiniEcommerce.Infrastructure/
│   │       └── PS.MiniEcommerce.API/
│   └── Frontend/
└── tests/
    ├── PS.MiniEcommerce.UnitTests/
    └── PS.MiniEcommerce.IntegrationTests/
```

Это фактическая структура репозитория. Solution остаётся вложенным в каталог backend-проекта (`src/Backend/PS.MiniEcommerce/PS.MiniEcommerce.slnx`, формат `.slnx`); префикс `PS.` намеренный и сохраняется во всех именах проектов, namespace и путях. Проект `Common` в MVP не вводится. Наполнение solution и остальные настройки выполняются по этапам roadmap.

## Documentation

Проектная документация хранится в каталоге `docs/`.

| Document | Purpose |
|---|---|
| `PROJECT.md` | Цели, границы и общая концепция проекта |
| `SPEC.md` | Функциональные требования и критерии приёмки |
| `DOMAIN.md` | Предметная область, бизнес-понятия и инварианты |
| `DECISIONS.md` | Реестр принятых технических и архитектурных решений |
| `FRONTEND.md` | Требования и принципы организации frontend |
| `ROADMAP.md` | Этапы и последовательность реализации |
| `architecture/architecture.md` | Архитектура backend и ответственность слоёв |
| `architecture/data-model.md` | Модель данных и ограничения базы |
| `architecture/api.md` | HTTP API и контракты взаимодействия |
| `adr/ADR-001-cart-concurrency.md` | Решения по конкурентному доступу к корзине |
| `adr/ADR-002-checkout-idempotency.md` | Решения по идемпотентности checkout |

`AGENTS.md` содержит инструкции для AI-агентов, работающих с репозиторием.

## MVP Scope

В минимальную версию входят:

- Просмотр каталога товаров.
- Работа с пользовательской корзиной.
- Оформление заказа.
- Просмотр истории заказов.
- Отмена заказа с восстановлением товарных остатков.

В проект не входят платежи, доставка, купоны, микросервисная архитектура, брокеры сообщений и сложная система авторизации.

## Development Principles

- Следовать согласованной архитектуре и спецификации.
- Не добавлять функции за пределами согласованного MVP без предварительного обсуждения.
- Не дублировать бизнес-правила между слоями.
- Проверять важные сценарии модульными и интеграционными тестами.
- Учитывать конкурентный доступ и целостность данных.
- Не хранить секреты и чувствительные настройки в исходном коде.
- Обновлять документацию при согласованном изменении требований.

## Getting Started

Порядок работ определяет `docs/ROADMAP.md`, начиная с Phase 1 (создание и проверка solution). Инструкции по установке, конфигурации базы данных, запуску приложения и выполнению тестов добавляются по мере прохождения соответствующих этапов.

## License

Лицензия проекта: MIT. Текст лицензии находится в файле `LICENSE`.
