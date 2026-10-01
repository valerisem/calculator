-- P80 approval threshold and campaign counts on rate rows; delivery review on packages.
alter table public.pc_rate_archetypes
  add column if not exists cost_p80 numeric,
  add column if not exists n_campaigns int;
comment on column public.pc_rate_archetypes.cost_p80 is 'GBP per video at P80: creator fees above this need approval / re-optimising.';
comment on column public.pc_rate_archetypes.n_campaigns is 'Distinct past campaigns behind this rate row.';
alter table public.pc_packages
  add column if not exists delivery_status text not null default 'not_reviewed' check (delivery_status in ('not_reviewed', 'cm_reviewed', 'confirmed')),
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;
comment on column public.pc_packages.delivery_status is 'Has the campaign team (e.g. Levi) checked this package can be delivered at these rates?';
