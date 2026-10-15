create table if not exists articulo (
  ley text not null,
  id text not null,
  orden int not null,
  ubicacion text[] not null,
  texto text not null,
  reformas text[] not null,
  tsv tsvector generated always as (to_tsvector('spanish', texto)) stored,
  primary key (ley, id)
);
create index if not exists articulo_tsv on articulo using gin (tsv);

create table if not exists cita (
  de_ley text not null,
  de_id text not null,
  a_ley text not null,
  a_id text not null,
  primary key (de_ley, de_id, a_ley, a_id),
  foreign key (de_ley, de_id) references articulo,
  foreign key (a_ley, a_id) references articulo
);
create index if not exists cita_a on cita (a_ley, a_id);

create table if not exists criterio (
  n int primary key,
  id text,
  materia text not null,
  tema text not null,
  texto text not null,
  citas jsonb not null
);
