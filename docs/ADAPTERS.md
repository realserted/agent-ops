# Swapping in real adapters

The agent and the tools depend on two ports, never on a concrete adapter:

- `InboxSource` — `list(limit)` and `get(id)`
- `OperationsStore` — `createRecord`, `saveDraft`, `flagForReview`

Moving from the fixture inbox and in-memory store to Gmail and Supabase is a change in the composition root ([`apps/cli/src/index.ts`](../apps/cli/src/index.ts)) and nowhere else. No tool, guardrail or agent code changes.

## Gmail: two adapters, and why

There are two ways to read Gmail here, and the choice is about Google's OAuth policy rather than about code.

| | `ImapInbox` | `GmailInbox` |
| --- | --- | --- |
| Transport | IMAP | Gmail REST API |
| Auth | App Password | OAuth 2.0 |
| Scope | none — no OAuth involved | `gmail.readonly`, a **restricted** scope |
| To run it for real | enable 2FA, create an App Password | OAuth verification **plus an annual paid security assessment** (CASA) |
| Cost | none | four figures per year |

`gmail.readonly` is in Google's strictest tier. Publishing an app that uses it requires verification *and* a recurring third-party security assessment. Most of the Gmail scope family is restricted too — `gmail.modify`, `gmail.compose`, `gmail.metadata`, `https://mail.google.com/` — so narrowing the scope does not escape it, and `gmail.metadata` would not return bodies anyway.

There is an escape hatch: an app left in **Testing** publishing status skips verification entirely. It is capped at 100 test users and its refresh tokens expire after 7 days, so a long-lived agent would start failing weekly until someone re-consents. Workable for a demo you run deliberately; not for anything left running.

**`ImapInbox` is the default recommendation for personal use.** IMAP is a protocol the account already speaks, so no scope is requested, nothing needs verifying, and nothing is assessed. `GmailInbox` remains the right choice if you are building something with real third-party users, where you would be going through verification regardless.

Google moves these policies; confirm the current CASA tier and token-expiry rules before budgeting anything.

### ImapInbox

```ts
import { ImapInbox } from "@agent-ops/tools";

const inbox = new ImapInbox({
  user: process.env.GMAIL_IMAP_USER!,
  appPassword: process.env.GMAIL_IMAP_APP_PASSWORD!,
  mailbox: "INBOX", // or "[Gmail]/All Mail"
});
```

**What you need to provide**

1. 2-Step Verification enabled on the account — App Passwords are unavailable without it.
2. An App Password generated under Google Account → Security → App passwords. This is not your account password, and it can be revoked independently.
3. IMAP enabled in Gmail settings → Forwarding and POP/IMAP.

The adapter opens a connection per call rather than holding one. An agent run makes a handful of calls minutes apart, and a held IMAP connection idles out mid-run — failing in a way that looks like an empty inbox rather than an error.

Message UIDs become email ids. That matters because `email_id` is schema-hardened to `^[a-zA-Z0-9_-]{1,64}$`; a UID is digits, so it passes, and `get` refuses anything non-numeric before it reaches an IMAP command.

One caveat: Google has been retiring password-based access, and the timeline differed between Workspace and personal accounts. Check that App Passwords still appear in your account's security settings before relying on this.

### GmailInbox

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

All three adapters are tested against stubs rather than live services - stubbed HTTP for Gmail and Supabase, a fake IMAP client for ImapInbox. Request shapes, auth headers, protocol sequencing, error handling and field mapping are verified; whether Google and Supabase behave as documented is not. Run against a real project before trusting either in production, and expect to discover at least one thing about pagination or rate limits that the docs did not mention.

## Running against your own mailbox

Both the CLI and the dashboard pick their inbox from the environment, so no code changes:

```bash
# .env
GMAIL_IMAP_USER=you@gmail.com
GMAIL_IMAP_APP_PASSWORD=abcd efgh ijkl mnop   # App Password, not your account password
GMAIL_IMAP_MAILBOX=INBOX                       # optional
```

```bash
pnpm agent                 # prints "Inbox: Gmail over IMAP (...)  *** LIVE MAIL ***"
pnpm dashboard             # same inbox, with the approval queue
```

Leave both variables unset and you get the fixture inbox. Setting only one is an error rather than a silent fall back — a run that quietly triaged five fake emails when you meant your own inbox looks like it worked.

### Before you point it at real mail

- **Start with a label, not the whole inbox.** Set `GMAIL_IMAP_MAILBOX` to a folder you filter a few messages into. The agent is read-only, but the first real run is where you find out how your actual mail parses.
- **Every run costs tokens.** A five-email fixture run is about $0.02 on Haiku. A hundred-message mailbox is proportionally more, and `list_emails` fetches bodies for everything it lists.
- **Real mail means real content in traces.** `InMemoryTraceStore` keeps full tool output — including email bodies — in memory for the life of the process. That is fine locally; persisting traces to MongoDB would put that content at rest, so treat the trace store as holding the same sensitivity as the mailbox itself.
- **The guardrails now matter for real.** Everything in `SECURITY.md` was written for this case: your actual correspondents are the untrusted input.
