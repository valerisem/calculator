-- Slide options a package was last downloaded with (theme, subtitle, badge, extra lines, estimated sales).
alter table public.pc_packages add column if not exists slide_options jsonb;
alter table public.pc_slides add column if not exists options jsonb;
