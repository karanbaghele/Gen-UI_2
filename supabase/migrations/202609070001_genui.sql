create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text not null, avatar_url text,
  preferences jsonb not null default '{"appearance":"light"}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check(role in ('admin','analyst','viewer')),
  created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index memberships_user on public.memberships(user_id);

create function public.bootstrap_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare workspace uuid;
begin
  insert into public.profiles(id,email,name,avatar_url) values (
    new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1),'Member'),new.raw_user_meta_data->>'avatar_url');
  insert into public.workspaces(name,owner_id) values ('My workspace',new.id) returning id into workspace;
  insert into public.memberships(workspace_id,user_id,role) values(workspace,new.id,'admin');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.bootstrap_user();
revoke all on function public.bootstrap_user() from public;

-- Security definer avoids recursive membership RLS. Tenant scope is checked in SQL before rows leave PostgreSQL.
create function public.workspace_role(target uuid) returns text language sql stable security definer set search_path = '' as $$
  select role from public.memberships where workspace_id=target and user_id=(select auth.uid())
    and (nullif(current_setting('app.workspace_id',true),'') is null or target::text=current_setting('app.workspace_id',true))
$$;
revoke all on function public.workspace_role(uuid) from public;
grant execute on function public.workspace_role(uuid) to authenticated;

create table public.data_sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check(kind in ('csv','sample','google_sheets','postgresql')), name text not null,
  config jsonb not null default '{}', encrypted_credentials text,
  status text not null default 'ready' check(status in ('ready','syncing','stale','error','disconnected')),
  refresh_interval_seconds integer not null default 60 check(refresh_interval_seconds>=5),
  last_synced_at timestamptz, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id)
);
create table public.datasets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null, name text not null, source_kind text not null,
  fields jsonb not null, profile jsonb not null default '{}', rows jsonb not null default '[]', warnings jsonb not null default '[]',
  row_count integer not null check(row_count between 0 and 100000), version integer not null default 1,
  indexing_status text not null default 'queued' check(indexing_status in ('queued','processing','ready','failed','stale')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(source_id,workspace_id) references public.data_sources(id,workspace_id) on delete cascade
);
create table public.dataset_fields (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_id uuid not null, name text not null, definition jsonb not null,
  created_at timestamptz not null default now(), unique(dataset_id,name),
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete cascade
);
create table public.dashboards (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null, spec jsonb not null, version integer not null default 1 check(version>0), pinned boolean not null default false,
  disconnected boolean not null default false, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id)
);
create table public.dashboard_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dashboard_id uuid not null, version integer not null, spec jsonb not null, reason text not null default 'save',
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(dashboard_id,version), foreign key(dashboard_id,workspace_id) references public.dashboards(id,workspace_id) on delete cascade
);
create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_id uuid, source_id uuid, kind text not null, title text not null, content text not null, checksum text not null,
  metadata jsonb not null default '{}', status text not null default 'stale',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id),
  unique(workspace_id,dataset_id,kind,title),
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete cascade,
  foreign key(source_id,workspace_id) references public.data_sources(id,workspace_id) on delete cascade
);
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null, dataset_id uuid, content text not null, embedding extensions.vector(768) not null,
  embedding_model text not null, checksum text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(document_id,checksum,embedding_model),
  foreign key(document_id,workspace_id) references public.knowledge_documents(id,workspace_id) on delete cascade,
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete cascade
);
create index knowledge_chunks_scope on public.knowledge_chunks(workspace_id,dataset_id);
create index knowledge_chunks_vector on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_chunks_lexical on public.knowledge_chunks using gin(to_tsvector('english',content));

create table public.jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid, dataset_id uuid, type text not null, payload jsonb not null default '{}',
  status text not null default 'queued' check(status in ('queued','processing','ready','failed','stale')),
  attempts integer not null default 0, max_attempts integer not null default 4, run_after timestamptz not null default now(),
  lease_until timestamptz, lease_owner text, idempotency_key text not null, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,idempotency_key),
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete cascade,
  foreign key(source_id,workspace_id) references public.data_sources(id,workspace_id) on delete cascade
);
create index jobs_due on public.jobs(status,run_after,lease_until);
create table public.generation_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id), dashboard_id uuid, dataset_id uuid,
  provider text not null, model text not null, status text not null default 'processing', prompt_hash text not null,
  prompt text, retrieval jsonb not null default '{}', usage jsonb not null default '{}', validation jsonb not null default '{}',
  duration_ms integer, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(dashboard_id,workspace_id) references public.dashboards(id,workspace_id) on delete set null (dashboard_id),
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete set null (dataset_id)
);
create table public.query_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_id uuid, dashboard_id uuid, generation_run_id uuid, query jsonb not null,
  results_count integer not null default 0, duration_ms integer not null default 0, status text not null default 'ready', error text,
  created_at timestamptz not null default now(),
  foreign key(dataset_id,workspace_id) references public.datasets(id,workspace_id) on delete set null (dataset_id),
  foreign key(dashboard_id,workspace_id) references public.dashboards(id,workspace_id) on delete set null (dashboard_id),
  foreign key(generation_run_id,workspace_id) references public.generation_runs(id,workspace_id) on delete set null (generation_run_id)
);
create table public.source_syncs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid, status text not null default 'processing', rows_count integer, schema_changed boolean not null default false,
  error text, started_at timestamptz not null default now(), completed_at timestamptz,
  foreign key(source_id,workspace_id) references public.data_sources(id,workspace_id) on delete set null (source_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null, action text not null, resource_type text not null,
  resource_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dashboard_id uuid, created_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(dashboard_id,workspace_id) references public.dashboards(id,workspace_id) on delete cascade
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null, role text not null check(role in ('user','assistant')), content text not null,
  created_at timestamptz not null default now(),
  foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id) on delete cascade
);
create table public.resource_permissions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id), dashboard_id uuid not null, permission text not null check(permission in ('view','edit')),
  created_at timestamptz not null default now(),
  foreign key(dashboard_id,workspace_id) references public.dashboards(id,workspace_id) on delete cascade
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id), generation_run_id uuid not null, helpful boolean not null,
  created_at timestamptz not null default now(),
  foreign key(generation_run_id,workspace_id) references public.generation_runs(id,workspace_id) on delete cascade
);

alter table public.profiles enable row level security;
create policy profile_self_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profile_self_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
alter table public.workspaces enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.workspace_role(id) is not null);
create policy workspace_admin_update on public.workspaces for update to authenticated using(public.workspace_role(id)='admin') with check(public.workspace_role(id)='admin');
alter table public.memberships enable row level security;
create policy membership_self_read on public.memberships for select to authenticated using(user_id=(select auth.uid()));

-- All workspace entities enforce both membership and role. Composite FKs forbid cross-tenant references.
do $$ declare entity text; begin
  foreach entity in array array['data_sources','datasets','dataset_fields','dashboards','dashboard_versions','knowledge_documents','knowledge_chunks','jobs','generation_runs','query_runs','source_syncs','audit_logs','conversations','messages','resource_permissions','feedback'] loop
    execute format('alter table public.%I enable row level security',entity);
    execute format('create index on public.%I(workspace_id)',entity);
    execute format('create policy tenant_read on public.%I for select to authenticated using(public.workspace_role(workspace_id) is not null)',entity);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check(public.workspace_role(workspace_id) in (''admin'',''analyst''))',entity);
    if entity not in ('audit_logs','dashboard_versions') then
      execute format('create policy tenant_update on public.%I for update to authenticated using(public.workspace_role(workspace_id) in (''admin'',''analyst'')) with check(public.workspace_role(workspace_id) in (''admin'',''analyst''))',entity);
      execute format('create policy tenant_delete on public.%I for delete to authenticated using(public.workspace_role(workspace_id) in (''admin'',''analyst''))',entity);
    end if;
  end loop;
end $$;
-- Credentials are never reachable through the public Data API, even with a browser token.
revoke all on all tables in schema public from anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
revoke select on public.data_sources from authenticated;
grant select(id,workspace_id,kind,name,config,status,refresh_interval_seconds,last_synced_at,error,created_at,updated_at) on public.data_sources to authenticated;
-- App's server-only connection can explicitly assume this role to read credentials, still subject to RLS.
create role genui_credentials nologin;
grant authenticated to genui_credentials;
grant select(encrypted_credentials) on public.data_sources to genui_credentials;
grant update(encrypted_credentials,updated_at) on public.data_sources to genui_credentials;
grant genui_credentials to postgres;
