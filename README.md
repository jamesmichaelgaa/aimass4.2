# aimass4.2

AI-assisted personal budgeting application for Filipino employees and young professionals with regular monthly or biweekly income.

## Problem
People can struggle to monitor daily expenses, remember recurring bills, and make their money last until payday. aimass4.2 combines manual expense tracking, budgets, recurring bill reminders, payday forecasting, and AI-assisted spending insights.

## MVP highlights
- Manual income and expense tracking.
- Monthly budgets and category spending limits.
- Recurring bill tracking and in-app reminders.
- Payday/cash-flow forecast using user-entered information.
- AI spending insights and budget/savings recommendations.
- No bank or e-wallet integrations in the MVP.

## Planned technology
- **Frontend and hosting:** Bolt, React, TypeScript, Vite.
- **Backend and database:** Supabase PostgreSQL, Auth, Row Level Security, Edge Functions.
- **AI:** OpenAI API called from a server-side Edge Function.
- **Source control:** GitHub.
- **AI-assisted development:** Codex.
- **CI:** GitHub Actions.

## Documentation
- [Product specification](spec.md)
- [Agent instructions](AGENTS.md)
- [Architecture notes](docs/architecture.md)
- [Proposed database schema](docs/database-schema.md)
- [Security policy](docs/security.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Development tasks](tasks.md)

## Security
Never commit real credentials. Commit placeholder names only in `.env.example`. Keep OpenAI API keys, Supabase service-role keys, database passwords, and other private credentials in the appropriate secret manager. Never expose private secrets through frontend environment variables. Review [docs/security.md](docs/security.md).

## Development status
**Documentation and planning.** The application scaffold, database migrations, automated tests, and live deployment have not yet been created.

## Getting started
Local setup instructions will be added after the initial Bolt scaffold is created and its actual package scripts and dependencies are known.

## Product and pricing decisions
Default currency is PHP and default timezone is Asia/Manila. A possible free/premium model and proposed ₱149/month premium price are discovery ideas only; pricing and feature gating are not committed.

## License
Not yet selected.
