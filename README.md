# aimass4.2

AI-assisted personal budgeting application.

## Purpose
aimass4.2 helps users record income and expenses, manage budgets and savings goals, and understand their spending with an AI budgeting assistant.

## Planned stack
- **Frontend:** React + TypeScript (generated and iterated with Bolt)
- **Backend and database:** Supabase (PostgreSQL, Auth, Row Level Security, Edge Functions)
- **AI:** OpenAI API called only from a trusted server-side function
- **Source control:** GitHub
- **AI-assisted engineering:** Codex

The exact dependency versions and application commands will be documented after the initial Bolt scaffold is created.

## Documentation
- [Product specification](spec.md)
- [Agent instructions](AGENTS.md)
- [Architecture](docs/architecture.md)
- [Database schema](docs/database-schema.md)
- [Security policy](docs/security.md)
- [Development tasks](tasks.md)

## Security
Never commit real credentials. Use `.env.example` for placeholder variable names only. Keep private keys, API keys, passwords, service-role keys, and production connection strings in the appropriate secret manager. See [Security](docs/security.md).

## Development status
**Planning / foundation.** The application scaffold, database migrations, tests, and deployment configuration are not yet implemented.

## Getting started
Setup instructions will be added after the frontend scaffold and Supabase project are established. Do not assume that a local environment is configured until the relevant steps have been completed and verified.

## License
Not yet selected.
