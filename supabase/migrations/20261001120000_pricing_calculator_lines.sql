-- Calculator screen: mode now holds the package kind. Package lines record the
-- platform and market they were priced for; proposals keep the campaign name.
alter table public.pc_packages drop constraint if exists pc_packages_mode_check;
alter table public.pc_packages add constraint pc_packages_mode_check
  check (mode in ('budget', 'package', 'yours', 'performance', 'balanced', 'content', 'custom'));
comment on column public.pc_packages.mode is 'yours = package the client asked for (package to budget); performance / balanced / content = recommended package for that objective (budget to package); custom = edited by hand.';

alter table public.pc_package_lines
  add column if not exists platform text,
  add column if not exists market text;

alter table public.pc_proposals add column if not exists campaign_name text;
