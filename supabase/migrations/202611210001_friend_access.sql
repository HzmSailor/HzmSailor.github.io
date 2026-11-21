-- No visitor can write roles, review requests, or read another visitor's data.
create table public.blog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.blog_friends (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now()
);
create table public.blog_friend_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  github_id text not null,
  github_login text not null,
  github_name text,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create table public.blog_approval_emails (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.blog_friend_requests(id) on delete cascade,
  recipient text not null,
  sent_at timestamptz,
  provider_id text,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text
);

alter table public.blog_admins enable row level security;
alter table public.blog_friends enable row level security;
alter table public.blog_friend_requests enable row level security;
alter table public.blog_approval_emails enable row level security;
revoke all on public.blog_admins, public.blog_friends, public.blog_friend_requests,
  public.blog_approval_emails from anon, authenticated;
grant all on public.blog_admins, public.blog_friends, public.blog_friend_requests,
  public.blog_approval_emails to service_role;

create function public.blog_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.blog_admins where user_id = (select auth.uid()));
$$;
create function public.blog_is_friend() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.blog_is_admin() or exists(
    select 1 from public.blog_friends where user_id = (select auth.uid())
  );
$$;
revoke all on function public.blog_is_admin(), public.blog_is_friend() from public, anon;
grant execute on function public.blog_is_admin(), public.blog_is_friend() to authenticated, service_role;

-- Optional private posts: the policy checks current membership on each request.
-- Never commit their actual contents or private attachments to GitHub Pages.
create table public.blog_private_posts (
  slug text primary key,
  title text not null,
  summary text not null default '',
  content text not null,
  published_at timestamptz not null default now()
);
alter table public.blog_private_posts enable row level security;
revoke all on public.blog_private_posts from anon, authenticated;
grant select on public.blog_private_posts to authenticated;
grant all on public.blog_private_posts to service_role;
create policy friends_read_private_posts on public.blog_private_posts
  for select to authenticated using (public.blog_is_friend());

-- Only the verified Edge Function service may call mutation RPCs.
create function public.blog_apply_friend(
  p_user uuid, p_github_id text, p_login text, p_name text, p_email text
) returns public.blog_friend_requests
language plpgsql set search_path = '' as $$
declare result public.blog_friend_requests;
begin
  insert into public.blog_friend_requests(user_id, github_id, github_login, github_name, email)
  values (p_user, p_github_id, p_login, p_name, p_email)
  on conflict (user_id) do nothing;
  select * into strict result from public.blog_friend_requests where user_id = p_user;
  return result;
end;
$$;

create function public.blog_review_friend(p_actor uuid, p_request uuid, p_decision text)
returns public.blog_friend_requests language plpgsql set search_path = '' as $$
declare result public.blog_friend_requests;
begin
  if not exists(select 1 from public.blog_admins where user_id = p_actor) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') or p_decision is null then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into strict result from public.blog_friend_requests where id = p_request for update;
  if result.status <> 'pending' then
    if result.status <> p_decision then
      raise exception 'Request already reviewed' using errcode = '22023';
    end if;
    return result;
  end if;
  update public.blog_friend_requests set status = p_decision,
    reviewed_at = now(), reviewed_by = p_actor where id = p_request returning * into result;
  if p_decision = 'approved' then
    insert into public.blog_friends(user_id, approved_by) values (result.user_id, p_actor)
      on conflict (user_id) do nothing;
    insert into public.blog_approval_emails(request_id, recipient) values (result.id, result.email)
      on conflict (request_id) do nothing;
  end if;
  return result;
end;
$$;

create function public.blog_claim_approval_email(p_request uuid)
returns setof public.blog_approval_emails language sql set search_path = '' as $$
  update public.blog_approval_emails set lease_token = gen_random_uuid(),
    lease_until = now() + interval '2 minutes', attempts = attempts + 1
  where request_id = p_request and sent_at is null
    and (lease_until is null or lease_until < now())
  returning *;
$$;
create function public.blog_finish_approval_email(p_id uuid, p_token uuid, p_provider_id text, p_error text)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.blog_approval_emails set
    sent_at = case when p_error is null then now() else null end,
    provider_id = p_provider_id, last_error = p_error, lease_token = null, lease_until = null
  where id = p_id and lease_token = p_token;
  return found;
end;
$$;

revoke all on function public.blog_apply_friend(uuid,text,text,text,text),
  public.blog_review_friend(uuid,uuid,text), public.blog_claim_approval_email(uuid),
  public.blog_finish_approval_email(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.blog_apply_friend(uuid,text,text,text,text),
  public.blog_review_friend(uuid,uuid,text), public.blog_claim_approval_email(uuid),
  public.blog_finish_approval_email(uuid,uuid,text,text) to service_role;

-- Bootstrap the owner from an immutable provider ID after their first GitHub login.
-- Run this statement again if the owner has not logged in when the migration runs.
insert into public.blog_admins(user_id)
select user_id from auth.identities where provider = 'github' and provider_id = '173534334'
on conflict do nothing;
