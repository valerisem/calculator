-- Reliability needs distinct campaigns behind costs and views, and the
-- simulation samples the cleaned views-per-video observations themselves.
alter table pc_rate_archetypes
  add column if not exists n_cost_campaigns integer,
  add column if not exists n_views_campaigns integer,
  add column if not exists views_sample jsonb;
