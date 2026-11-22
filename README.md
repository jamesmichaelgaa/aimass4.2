# aimass4.2

AI-assisted personal budgeting application for Filipino employees and young professionals with monthly or biweekly income.

## Problem
People can struggle to monitor daily expenses, remember recurring bills, and make their money last until payday. aimass4.2 combines manual expense tracking, monthly budgets, recurring bill reminders, payday cash-flow forecasting, and AI-assisted budgeting insights.

## Finalized MVP
- Manual income and expense tracking.
- Monthly overall and category budgets.
- Recurring bill tracking with in-app upcoming/overdue reminders.
- Monthly and biweekly salary schedules.
- User-entered cash position and deterministic forecast through next payday.
- AI spending insights.
- AI budget and savings recommendations.
- AI explanations of cash-flow forecasts.
- Conversational AI budgeting assistant.
- AI is read-only; no automatic changes to financial records.

## Deferred beyond MVP
- Subscription pricing, payments, and premium plans.
- PDF reports/export.
- Email and push reminders.
- Bank/e-wallet integrations and automatic transaction categorization.
- Weekend/holiday payday adjustment.

## Technology
- **Frontend and hosting:** Bolt, React, TypeScript, Vite.
- **Backend and database:** Supabase PostgreSQL, Auth, Row Level Security, Edge Functions.
- **AI:** OpenAI API called from a server-side Edge Function.
- **Source control:** GitHub.
- **AI-assisted engineering:** Codex.
- **CI:** GitHub Actions.

## Documentation
- [Product specification](spec.md)
- [Agent instructions](AGENTS.md)
- [Architecture notes](docs/architecture.md)
- [Proposed database schema](docs/database-schema.md)
- [Security policy](docs/security.md)
- [AI agent specification](docs/ai-agent-spec.md)
- [User flows](docs/user-flows.md)
- [Testing strategy](docs/testing-strategy.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Development tasks](tasks.md)

## Security
Never commit real credentials. Commit placeholder names only in `.env.example`. Keep OpenAI API keys, Supabase service-role keys, database passwords, and other private credentials in the appropriate secret manager. Never expose private secrets through frontend environment variables. Review [docs/security.md](docs/security.md).

## Development status
**Documentation finalized for MVP planning; implementation has not started.** The frontend scaffold, database migrations, automated tests, and live deployment have not yet been created.

## Getting started
Local setup instructions will be added after the initial application scaffold is created and its actual package scripts and dependencies are known.

## Product decisions
Default currency is PHP and default timezone is Asia/Manila. Salary schedules are monthly or biweekly. Bill reminders are in-app only. Subscription pricing and PDF reports are deferred until after MVP.

## License
Not yet selected.
