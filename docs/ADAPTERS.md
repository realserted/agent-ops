# Swapping in real adapters

The agent and the tools depend on two ports, never on a concrete adapter:

- `InboxSource` — `list(limit)` and `get(id)`
- `OperationsStore` — `createRecord`, `saveDraft`, `flagForReview`

Moving from the fixture inbox and in-memory store to Gmail and Supabase is a change in the composition root ([`apps/cli/src/index.ts`](../apps/cli/src/index.ts)) and nowhere else. No tool, guardrail or agent code changes.

## Gmail

`GmailInbox` reads a real mailbox through the Gmail REST API. It is read-only by construction: `InboxSource` has no write operations and the scope it needs cannot send or delete mail.

```ts
import { GmailInbox } from "@agent-ops/tools";

const inbox = new GmailInbox({
  accessToken: async () => getFreshAccessToken(), // called per request
  query: "in:inbox -category:promotions",
});
```

`accessToken` is a function rather than a string because Google's access tokens expire after an hour — a long-lived agent holding a token captured at construction would start failing mid-run. Refresh is the caller's concern.

**What you need to provide**

1. A Google Cloud project with the Gmail API enabled.
2. An OAuth 2.0 client and a consent screen.
3. The `https://www.googleapis.com/auth/gmail.readonly` scope. Do not grant a broader one: the adapter cannot use it, and a narrower token is a smaller loss if it leaks.
4. A refresh-token flow that yields access tokens for `accessToken`.

Gmail's plain-text part is preferred over the HTML alternative. That is a security choice as much as a parsing one — the HTML version carries markup that reads as structure to a model, and hidden text is one of the patterns `detectInjection` looks for. Less attacker-controlled formatting reaches the prompt this way.

## Supabase

`SupabaseOperationsStore` writes records, drafts and flags over PostgREST.

```ts
import { SupabaseOperationsStore } from "@agent-ops/tools";

const store = new SupabaseOperationsStore({
  url: process.env.SUPABASE_URL!,
  apiKey: process.env.SUPABASE_ANON_KEY!,
});
```

### Schema

```sql
create table operations_records (
  id uuid primary key default gen_random_uuid(),
  email_id text not null,
  kind text not null check (kind in ('lead', 'invoice', 'support_ticket')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  email_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table review_flags (
  id uuid primary key default gen_random_uuid(),
  email_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index on operations_records (email_id);
create index on drafts (email_id);
create index on review_flags (email_id);
```

`id` and `created_at` are Postgres defaults rather than values the adapter generates, so two processes writing concurrently cannot collide on an id or disagree about ordering.

### Row-level security

Enable RLS and use the **anon key**, not the service role key. The service role key bypasses RLS entirely, which means a prompt injection that reached the store would face no database-level limit at all. With RLS on, the policy is a second control underneath the approval gate:

```sql
alter table operations_records enable row level security;
alter table drafts enable row level security;
alter table review_flags enable row level security;

-- The agent may insert, and may not read back, update or delete.
create policy agent_insert on operations_records for insert to anon with check (true);
create policy agent_insert on drafts            for insert to anon with check (true);
create policy agent_insert on review_flags      for insert to anon with check (true);
```

Insert-only matters: nothing in `OperationsStore` reads, so an injected instruction cannot use the store as a channel to pull other customers' records back into the model's context.

## Wiring both

```ts
const agent = new Agent({
  llm: createProvider(),
  tools: new ToolRegistry(createOperationsTools({ inbox, store })),
  systemPrompt: SYSTEM_PROMPT,
  approve: createTerminalApprover(rl),
});
```

Identical to the fixture wiring — that is the point of the ports.

## What is not covered

Both adapters are tested against stubbed HTTP, not against live services. The request shapes, auth headers, error handling and field mapping are verified; whether Google and Supabase behave as documented is not. Run against a real project before trusting either in production, and expect to discover at least one thing about pagination or rate limits that the docs did not mention.
