# ReleaseFlow

Music release management platform built with Next.js 14 App Router, Supabase, tRPC v11, and Inngest.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database & Auth | Supabase |
| API | tRPC v11 + React Query v5 |
| Background Jobs | Inngest |
| AI Agents | Custom agent modules (`/agents`) |

## Project Structure

```
releaseflow/
├── app/
│   ├── (auth)/              # Public auth pages (login, signup)
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/         # Protected dashboard pages
│   │   ├── layout.tsx       # Sidebar layout
│   │   ├── dashboard/
│   │   ├── artists/
│   │   ├── releases/
│   │   ├── content/
│   │   ├── analytics/
│   │   └── settings/
│   ├── api/
│   │   ├── trpc/[trpc]/     # tRPC handler
│   │   └── inngest/         # Inngest handler
│   └── auth/callback/       # Supabase OAuth callback
├── agents/                  # AI agent modules
├── components/
│   ├── auth/                # Login / signup forms
│   ├── layout/              # Sidebar, header, user nav
│   ├── providers/           # tRPC & React Query provider
│   └── ui/                  # shadcn/ui components (57 components)
├── inngest/                 # Inngest client & functions
├── lib/
│   ├── supabase/            # Browser, server, and middleware clients
│   ├── trpc/                # Client, server helpers, QueryClient
│   └── utils.ts             # shadcn cn() helper
├── server/
│   ├── routers/             # tRPC routers (artists, releases, analytics)
│   ├── root.ts              # AppRouter
│   └── trpc.ts              # tRPC init, context, procedures
└── proxy.ts                 # Supabase session refresh + auth guard
```

## Getting Started

### 1. Clone & install dependencies

```bash
git clone <your-repo>
cd releaseflow
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in all required values (see comments in the file).

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Copy your **Project URL** and **anon key** into `.env.local`.
3. Run the following SQL in the Supabase SQL editor to create the base schema:

```sql
-- Artists
create table artists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  bio         text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- Releases
create table releases (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  artist_id    uuid references artists(id) on delete cascade,
  status       text not null default 'draft'
                 check (status in ('draft','scheduled','published','archived')),
  release_date date,
  created_by   uuid references auth.users(id),
  created_at   timestamptz default now()
);

-- Enable Row Level Security
alter table artists  enable row level security;
alter table releases enable row level security;

-- Policies (authenticated users can read/write their own data)
create policy "Users can manage their artists"
  on artists for all using (auth.uid() = created_by);

create policy "Users can manage their releases"
  on releases for all using (auth.uid() = created_by);
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login`.

### 5. (Optional) Start the Inngest dev server

In a second terminal:

```bash
npx inngest-cli@latest dev
```

This proxies background function calls locally so you can test workflows without deploying.

## Authentication

All routes are protected by Supabase Auth proxy ([proxy.ts](proxy.ts)).
Public paths: `/login`, `/signup`, `/auth/callback`.

The middleware refreshes the session cookie on every request and redirects unauthenticated users to `/login`.

## tRPC

- **Server context** — `server/trpc.ts` — injects the Supabase server client and current user.
- **Routers** — `server/routers/` — one file per domain (artists, releases, analytics).
- **App Router handler** — `app/api/trpc/[trpc]/route.ts`.
- **Client** — `lib/trpc/client.ts` — `createTRPCReact<AppRouter>()`.
- **Server component helper** — `lib/trpc/server.ts` — `createHydrationHelpers` for RSC prefetching.

### Example usage in a client component

```tsx
"use client";
import { trpc } from "@/lib/trpc/client";

export function ArtistList() {
  const { data } = trpc.artists.list.useQuery();
  return <ul>{data?.map(a => <li key={a.id}>{a.name}</li>)}</ul>;
}
```

## AI Agents

Stub implementations live in `/agents`. Each agent exposes a typed async function.
To activate, install your preferred LLM SDK and replace the stubs:

```bash
npm install ai openai          # Vercel AI SDK + OpenAI
# or
npm install @anthropic-ai/sdk  # Anthropic SDK
```

## Inngest Workflows

Background functions live in `/inngest/functions/`. Register new functions in `/app/api/inngest/route.ts`.

Fire an event from a tRPC mutation or API route:

```ts
import { inngest } from "@/inngest/client";

await inngest.send({
  name: "release/published",
  data: { releaseId, title, artistName },
});
```

## Deployment

### Vercel (recommended)

1. Push to GitHub and import the repo in Vercel.
2. Add all environment variables from `.env.example` in the Vercel dashboard.
3. Deploy.

### Environment variables required for production

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `INNGEST_EVENT_KEY` | Inngest → Settings → Keys |
| `INNGEST_SIGNING_KEY` | Inngest → Settings → Keys |
| `NEXT_PUBLIC_APP_URL` | Your production URL |
