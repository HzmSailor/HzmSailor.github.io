begin;

-- Keep existing Friend-only notes and their contents in place; do not copy them
-- into a public file or leave an old read path with weaker visibility rules.
alter table public.blog_private_posts rename to blog_notes;
alter table public.blog_notes
  add column id uuid not null unique default gen_random_uuid(),
  add column category text not null default 'daily' check (category in ('academic', 'daily')),
  add column visibility text not null default 'friends' check (visibility in ('public', 'friends', 'private')),
  add column updated_at timestamptz not null default now(),
  add column revision integer not null default 1,
  add column archived_at timestamptz;

drop policy friends_read_private_posts on public.blog_notes;
grant select on public.blog_notes to anon, authenticated;
create policy public_read_notes on public.blog_notes for select to anon
  using (visibility = 'public' and archived_at is null);
create policy member_read_notes on public.blog_notes for select to authenticated
  using (
    public.blog_is_admin() or (
      archived_at is null and (
        visibility = 'public' or (visibility = 'friends' and public.blog_is_friend())
      )
    )
  );
create index blog_notes_listing on public.blog_notes(category, published_at desc, id desc)
  where archived_at is null;

create function public.blog_save_note(
  p_actor uuid, p_id uuid, p_title text, p_summary text, p_content text,
  p_category text, p_visibility text, p_revision integer
) returns public.blog_notes language plpgsql set search_path = '' as $$
declare result public.blog_notes;
declare new_id uuid;
begin
  if not exists(select 1 from public.blog_admins where user_id = p_actor) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' or char_length(p_title) > 200 or
     char_length(coalesce(p_summary, '')) > 600 or char_length(coalesce(p_content, '')) > 200000 or
     p_category is null or p_category not in ('academic', 'daily') or
     p_visibility is null or p_visibility not in ('public', 'friends', 'private') then
    raise exception 'Invalid note' using errcode = '22023';
  end if;
  if p_id is null then
    new_id := gen_random_uuid();
    insert into public.blog_notes(id, slug, title, summary, content, category, visibility)
    values (new_id, 'note-' || new_id::text, btrim(p_title), coalesce(p_summary, ''),
      coalesce(p_content, ''), p_category, p_visibility) returning * into result;
  else
    select * into strict result from public.blog_notes where id = p_id for update;
    if p_revision is null or result.revision <> p_revision then
      raise exception 'Note revision conflict' using errcode = '40001';
    end if;
    if result.archived_at is not null then
      raise exception 'Restore the note before editing' using errcode = '22023';
    end if;
    update public.blog_notes set title = btrim(p_title), summary = coalesce(p_summary, ''),
      content = coalesce(p_content, ''), category = p_category, visibility = p_visibility,
      updated_at = now(), revision = revision + 1 where id = p_id returning * into result;
  end if;
  return result;
end;
$$;

create function public.blog_archive_note(p_actor uuid, p_id uuid, p_revision integer, p_archived boolean)
returns public.blog_notes language plpgsql set search_path = '' as $$
declare result public.blog_notes;
begin
  if not exists(select 1 from public.blog_admins where user_id = p_actor) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into strict result from public.blog_notes where id = p_id for update;
  if p_revision is null or result.revision <> p_revision then
    raise exception 'Note revision conflict' using errcode = '40001';
  end if;
  update public.blog_notes set archived_at = case when p_archived then now() else null end,
    updated_at = now(), revision = revision + 1 where id = p_id returning * into result;
  return result;
end;
$$;

revoke all on function public.blog_save_note(uuid,uuid,text,text,text,text,text,integer),
  public.blog_archive_note(uuid,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.blog_save_note(uuid,uuid,text,text,text,text,text,integer),
  public.blog_archive_note(uuid,uuid,integer,boolean) to service_role;

-- The two already-public Example articles are seeded below. All future note
-- bodies live in this table rather than the public Git repository.

insert into public.blog_notes(id,slug,title,summary,content,category,visibility,published_at)
values ('10000000-0000-4000-8000-000000000001', 'example-academic-20261121', '如何整理一篇机器人学习论文', '从研究问题、方法假设到实验验证，一份可以反复使用的阅读笔记框架。', '> **Example 示例文章**：用于展示排版，不代表真实研究成果或生活经历。

读完一篇论文后，最有用的笔记往往不是对每一节的复述，而是能够回答几个问题：它想解决什么，为什么这样做，以及证据支持到了哪里。

## 先写下研究问题

试着在不使用方法名称的情况下，用两三句话描述问题。现有方案在哪种条件下遇到困难？作者希望改变的是数据需求、执行效果、训练成本，还是适用范围？如果问题还说不清楚，可以先回到引言和任务设定。

## 把方法拆成输入、过程和输出

在机器人学习的阅读笔记里，可以先画一条简单的数据流，再补充各部分的假设：

- **输入：**模型能看到哪些观测、历史信息和任务描述？
- **过程：**哪些部分经过学习，哪些部分由规则或已有模块提供？
- **输出：**预测结果如何变成机器人实际执行的动作？

这张草图不必精致。它的作用是帮助读者看清信息在哪里进入系统，哪些条件在实验之外可能发生变化。

## 让结论和实验一一对应

为每一条主要结论找出直接支持它的实验，同时记下实验条件。比较方法是否使用了相同的数据？任务、训练预算和评价指标是否一致？哪些现象有消融支持，哪些仍然只是合理解释？

> 把“作者报告了什么”和“我据此推测什么”分开写。

## 以一个可以验证的问题结尾

最后留下一个具体问题，比留下“很有启发”更方便继续研究。例如：如果减少某一类观测，方法是否仍然成立？先写清楚要改变的条件和要观察的指标，下一次阅读或实验就有了起点。', 'academic', 'public', '2026-11-21T00:00:00+08:00') on conflict (id) do nothing;

insert into public.blog_notes(id,slug,title,summary,content,category,visibility,published_at)
values ('10000000-0000-4000-8000-000000000002', 'example-daily-20261121', '给日常留一点空白', '关于散步、随手记录，以及不必急着得到答案的小问题。', '> **Example 示例文章**：用于展示排版，不代表真实研究成果或生活经历。

日程表很容易写满，日记却常常空着。也许是因为总觉得，只有发生了值得总结的事情，才需要留下记录。

其实，一段普通的日子也有自己的纹理：天气转凉时的风，走过很多次却刚刚注意到的街角，还有一个暂时没有答案的问题。

## 散步时，不必给自己安排任务

可以选一条熟悉的路，把手机放进口袋，不急着听完一期节目，也不急着想出一个好点子。注意力偶尔离开屏幕，眼前的东西就有机会重新变得具体。

> 有些片刻不需要带来成果，只需要被看见。

## 用三句话留住一天

如果不知道从哪里开始，可以只写三句话：

- 今天注意到的一件小事。
- 一个还想继续思考的问题。
- 明天想留给自己的一点时间。

不必每天写，也不必努力把它写成一篇完整的文章。记录的意义，可以只是让之后的自己有机会想起：原来那时候，曾经这样看待普通的一天。

## 允许笔记没有结尾

学术笔记通常需要把问题说清楚，生活里的记录却可以停在一半。一个感受、一句话、一小段空白，都可以先放在那里，等以后再来看。', 'daily', 'public', '2026-11-21T00:00:00+08:00') on conflict (id) do nothing;

commit;
