drop table if exists respuesta;
drop table if exists relacion;
drop table if exists fts;
drop table if exists fragmento;
drop table if exists criterio_cita;
drop table if exists criterio;
drop table if exists enlace;
drop table if exists articulo;

create table articulo (
  ley text not null,
  id text not null,
  orden integer not null,
  ubicacion text not null,
  texto text not null,
  reformas text not null,
  actualizaciones text not null,
  titulo text,
  primary key (ley, id)
);

create table enlace (
  de_ley text not null,
  de_id text not null,
  inicio integer not null,
  fin integer not null,
  a_ley text not null,
  a_id text not null,
  primary key (de_ley, de_id, inicio)
);
create index enlace_a on enlace (a_ley, a_id);

create table criterio (
  n integer primary key,
  anexo integer not null,
  id text,
  materia text not null,
  tema text not null,
  texto text not null
);

create table criterio_cita (
  n integer not null,
  ley text not null,
  id text not null,
  primary key (n, ley, id)
);
create index criterio_cita_articulo on criterio_cita (ley, id);

create table fragmento (
  rowid integer primary key,
  huella text not null unique,
  ley text not null,
  id text not null,
  n integer not null,
  texto text not null
);
create index fragmento_articulo on fragmento (ley, id);

create virtual table fts using fts5(terminos, content='', tokenize='unicode61 remove_diacritics 2');

create table respuesta (
  clave text primary key,
  pregunta text not null,
  texto text not null,
  fuentes text not null,
  modelo text not null,
  creado text not null default (datetime('now'))
);

create table if not exists uso (
  dia text primary key,
  n integer not null
);

create table relacion (
  ley text not null,
  id text not null,
  a_ley text not null,
  a_id text not null,
  score real not null,
  primary key (ley, id, a_ley, a_id)
);

create table if not exists faq (
  slug text primary key,
  pregunta text not null,
  respuesta text not null,
  fuentes text not null,
  modelo text not null,
  verificada integer not null,
  fecha text not null
);

create table if not exists reescritura (
  q text primary key,
  terminos text not null,
  modelo text not null,
  creado text not null default (datetime('now'))
);
