-- Creator Package Calculator (monday board view "Package Calculator" in the Master app).
-- All tables are prefixed pc_ and only read/written by the Railway server with the
-- service role key. RLS is on with no policies, so anon/authenticated keys see nothing.

create table if not exists public.pc_settings (
  id text primary key default 'default',
  values jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.pc_settings is 'Calculator settings and defaults (spec section 6). One row, id=default; missing keys fall back to the defaults in code.';

-- One row per rebuild of the rate table from creator_bookings + campaigns.
create table if not exists public.pc_rate_builds (
  id bigserial primary key,
  built_at timestamptz not null default now(),
  built_by text,
  params jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  multi_video_factors jsonb not null default '{}'::jsonb
);
comment on table public.pc_rate_builds is 'Each rebuild of the rate table. The latest build is what the calculator uses; packages keep the build id they were priced on.';

-- Archetype = market x platform x niche x size, at every fallback level (1 = most specific, 6 = size only).
create table if not exists public.pc_rate_archetypes (
  id bigserial primary key,
  build_id bigint not null references public.pc_rate_builds(id) on delete cascade,
  level smallint not null check (level between 1 and 6),
  market text,
  platform text,
  niche text,
  size_band text not null,
  n_cost int not null,
  n_views int not null,
  confidence text not null check (confidence in ('High', 'Medium', 'Low')),
  cost_p50 numeric,  -- GBP per video (typical)
  cost_p65 numeric,  -- GBP per video (planning)
  views_p25 numeric,
  views_p50 numeric,
  views_p75 numeric
);
create index if not exists pc_rate_archetypes_build_idx on public.pc_rate_archetypes (build_id, size_band, level);
comment on table public.pc_rate_archetypes is 'Rate table rows (spec section 3). Costs in GBP per video.';

create table if not exists public.pc_rate_flags (
  id bigserial primary key,
  build_id bigint not null references public.pc_rate_builds(id) on delete cascade,
  booking_id bigint not null,
  reason text not null,
  views bigint,
  followers bigint
);
comment on table public.pc_rate_flags is 'Bookings excluded as outliers (views above 5x followers or above 10M), to be checked by hand.';

-- One proposal per Pipedrive deal.
create table if not exists public.pc_proposals (
  id uuid primary key default gen_random_uuid(),
  pd_deal_id bigint not null unique,
  deal_title text,
  pd_org_id bigint,
  org_name text,
  currency text not null default 'GBP',
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'won', 'lost')),
  approved_package_id uuid,
  monday_account_id bigint,
  monday_board_id bigint,
  created_by_monday_id bigint,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.pc_proposals is 'A Pipedrive deal being priced. Holds its packages; approved_package_id is the one agreed with the client.';

create table if not exists public.pc_packages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.pc_proposals(id) on delete cascade,
  name text not null,
  mode text not null check (mode in ('budget', 'package')),
  inputs jsonb not null,
  result jsonb not null,
  rate_build_id bigint references public.pc_rate_builds(id) on delete set null,
  currency text not null,
  client_price numeric not null,
  views_promised bigint,
  reach_promised bigint,
  cpm numeric,
  total_creators int,
  total_videos int,
  gifted_creators int,
  boosted_views bigint,
  views_expected bigint,
  creator_money numeric,
  creator_money_allocated numeric,
  expected_margin numeric,
  agreed_price numeric,
  real_margin numeric,
  is_approved boolean not null default false,
  approved_at timestamptz,
  approved_by text,
  version int not null default 1,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pc_packages_proposal_idx on public.pc_packages (proposal_id, created_at);
create unique index if not exists pc_packages_one_approved on public.pc_packages (proposal_id) where is_approved;
comment on table public.pc_packages is 'A priced package option. inputs = form values, result = full calculator output (client + internal). Key figures are copied to columns for reporting.';

alter table public.pc_proposals
  drop constraint if exists pc_proposals_approved_package_fk,
  add constraint pc_proposals_approved_package_fk foreign key (approved_package_id) references public.pc_packages(id) on delete set null;

-- Creators by size in each package, for reporting across deals.
create table if not exists public.pc_package_lines (
  id bigserial primary key,
  package_id uuid not null references public.pc_packages(id) on delete cascade,
  size_band text not null,
  creators int not null,
  videos_each int not null,
  package_cost numeric,       -- per creator, client currency
  first_offer_per_video numeric,
  max_fee_per_video numeric,
  target_views_per_video bigint,
  confidence text,
  fallback_level text
);
create index if not exists pc_package_lines_pkg_idx on public.pc_package_lines (package_id);

create table if not exists public.pc_slides (
  id bigserial primary key,
  package_id uuid not null references public.pc_packages(id) on delete cascade,
  file_name text not null,
  created_by text,
  created_at timestamptz not null default now()
);
comment on table public.pc_slides is 'Every client slide generated, and by whom.';

create table if not exists public.pc_events (
  id bigserial primary key,
  proposal_id uuid references public.pc_proposals(id) on delete cascade,
  package_id uuid references public.pc_packages(id) on delete set null,
  action text not null,
  actor text,
  payload jsonb,
  at timestamptz not null default now()
);
create index if not exists pc_events_proposal_idx on public.pc_events (proposal_id, at);
comment on table public.pc_events is 'Audit trail: created, recalculated, approved, synced to Pipedrive, slide generated, settings changed.';

alter table public.pc_settings enable row level security;
alter table public.pc_rate_builds enable row level security;
alter table public.pc_rate_archetypes enable row level security;
alter table public.pc_rate_flags enable row level security;
alter table public.pc_proposals enable row level security;
alter table public.pc_packages enable row level security;
alter table public.pc_package_lines enable row level security;
alter table public.pc_slides enable row level security;
alter table public.pc_events enable row level security;

insert into public.pc_settings (id, values) values ('default', '{}'::jsonb) on conflict (id) do nothing;
