-- Censo Mundial de Mascotas · se pega una sola vez en Supabase → SQL Editor → Run
create table if not exists censo (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  nombre text not null,
  especie text not null,
  raza text not null default '',
  pais text not null,
  edad text not null default '',
  email text,
  acepta boolean not null default false,
  ip_hash text,
  dispositivo text
);
alter table censo enable row level security;
create index if not exists censo_ip on censo (ip_hash, creado);
create index if not exists censo_disp on censo (dispositivo, creado);

-- Resúmenes para los rankings (solo números, sin datos personales)
create or replace view censo_resumen as
  select count(*)::int as total, count(distinct pais)::int as paises,
         count(*) filter (where creado > now() - interval '7 days')::int as semana
  from censo;
create or replace view censo_especies as
  select especie, count(*)::int as n,
         count(*) filter (where creado > now() - interval '7 days')::int as semana
  from censo group by especie order by n desc;
create or replace view censo_razas as
  select especie, initcap(lower(trim(raza))) as raza, count(*)::int as n
  from censo where trim(raza) <> '' group by 1, 2 order by n desc;
create or replace view censo_paises as
  select pais, count(*)::int as n from censo group by pais order by n desc;
create or replace view censo_nombres as
  select initcap(lower(trim(nombre))) as nombre, count(*)::int as n
  from censo group by 1 order by n desc;
