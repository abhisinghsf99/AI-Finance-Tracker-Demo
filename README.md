# FinTrack — AI-Powered Finance Dashboard (Sandbox Demo)

A personal finance dashboard built with Next.js, Plaid, Supabase, and Claude AI. This version uses Plaid's **Sandbox** environment so you can explore the full experience with test data — no real bank accounts needed.

## Features

- **Plaid Link Integration** — Connect sandbox bank accounts using Plaid's test credentials
- **Transaction Syncing** — Automatic sync of transactions using Plaid's `/transactions/sync` endpoint
- **Spending Dashboard** — 30-day spending summary with category breakdowns and charts
- **Account Overview** — View balances across checking, savings, and credit accounts
- **Recurring Detection** — Automatically identifies recurring charges and subscriptions
- **Payoff Planner** — Credit card payoff calculator with APR-aware projections
- **AI Chat** — Ask questions about your finances using Claude (powered by Anthropic)
- **Dark Mode** — Clean, modern dark UI built with Tailwind CSS and shadcn/ui

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui, Recharts |
| State | Zustand |
| Database | Supabase (PostgreSQL) |
| Banking API | Plaid (Sandbox) |
| AI | Anthropic Claude (via AI SDK) |
| Deployment | Vercel |

## Getting Started

### Prerequisites

You'll need free accounts on these platforms:

- [Plaid](https://dashboard.plaid.com/signup) — for the banking API (sandbox is free)
- [Supabase](https://supabase.com) — for the database
- [Anthropic](https://console.anthropic.com) — for AI chat (optional)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd 100xengineers-project-1
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration file:

```
supabase/migrations/001_initial_schema.sql
```

3. Copy your project URL, anon key, and service role key from **Settings > API**

### 3. Set Up Plaid

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com)
2. Your Client ID and Sandbox Secret are on the **Keys** page
3. Make sure you're using the **Sandbox** secret (not Development or Production)

### 4. Configure Environment Variables

```bash
cp .env.example .env.local
```

Then fill in your keys in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_sandbox_secret
ANTHROPIC_API_KEY=your_anthropic_key
```

### 5. Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### 6. Seed Sandbox Data

Seeding is a server-side operation — there is no Link modal. Set `CRON_SECRET`
in `.env.local` first, then:

```bash
curl -X POST http://localhost:3000/api/plaid/seed \
  -H "Authorization: Bearer $CRON_SECRET"
```

This **wipes the database** and rebuilds it from fresh Plaid sandbox Items.

## Keeping Data Fresh

Plaid's sandbox anchors an Item's transaction history to the moment that Item is
created and never generates more, so a one-time seed goes stale. Two mechanisms
keep the dashboard current:

1. **Daily refresh cron** (`GET /api/cron/refresh`, scheduled in `vercel.json`).
   Calls `/transactions/refresh` on each Item, then syncs the new transactions
   into Supabase. Purely additive — no table is ever cleared. Requires the Item
   to have been created as `user_transactions_dynamic`.
2. **Stale-window fallback** (`src/lib/spend-window.ts`). If the cron fails and
   the newest transaction ages past 30 days, the spending window anchors to that
   transaction instead of to today, so the summary is never blank. The UI labels
   it "Last 30 Days of Activity — through `<date>`".

Vercel Cron only runs on Production deployments, and only fires GET requests.

## Sandbox Test Users

The seed builds one Item per user and merges the accounts:

| Username | Password | Provides |
|----------|----------|----------|
| `user_transactions_dynamic` | any | Checking + credit card, with transactions that grow on `/transactions/refresh` |
| `user_good` | `pass_good` | Savings, student loan, mortgage — **balances only**, its Item is released immediately after |

`user_good` transactions are deliberately never pulled: they are static and
cannot be refreshed, so they would permanently pollute the transactions table.

For more test scenarios, see [Plaid's Sandbox docs](https://plaid.com/docs/sandbox/).

## Project Structure

```
src/
├── app/
│   ├── (app)/              # Protected dashboard routes
│   ├── api/
│   │   ├── chat/           # AI chat endpoint
│   │   ├── dashboard/      # Dashboard data aggregation
│   │   └── plaid/          # Plaid integration endpoints
│   │       ├── accounts/       # List connected accounts
│   │       ├── create-link-token/  # Generate Plaid Link token
│   │       ├── exchange-token/     # Exchange public token
│   │       └── sync/              # Trigger transaction sync
├── components/
│   ├── chat/               # AI chat components
│   ├── dashboard/          # Dashboard widgets
│   ├── layout/             # Nav components
│   ├── plaid/              # Plaid Link components
│   └── ui/                 # shadcn/ui base components
└── lib/
    ├── plaid/              # Plaid client & sync logic
    ├── queries/            # Supabase query functions
    ├── store/              # Zustand state management
    └── supabase/           # Supabase client factory
```

## Deployment

Deploy to Vercel:

1. Push to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Add all environment variables in project settings
4. Deploy

## License

MIT
