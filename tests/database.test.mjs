import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Point PGLITE_MODULE at an isolated installation; the website has no build step.
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const reader = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
async function as(role, uid, query, params = []) {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
    return (await db.query(query, params)).rows;
  } finally { await db.exec('reset role'); }
}

test('PostgreSQL enforces Friend permissions, review transactions, and email leases', async t => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.identities(user_id uuid, provider text, provider_id text);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    insert into auth.users values ('${owner}'), ('${reader}'), ('${other}');
    insert into auth.identities values ('${owner}', 'github', '173534334');`);
  await db.exec(await readFile(new URL('../supabase/migrations/202611210001_friend_access.sql', import.meta.url), 'utf8'));
  await db.exec("insert into public.blog_private_posts(slug,title,content) values ('private','Private','Secret body')");
  let requestId;
  await t.test('bootstrap binds only the trusted GitHub provider ID', async () => {
    assert.deepEqual((await db.query('select user_id from public.blog_admins')).rows.map(x => x.user_id), [owner]);
  });
  await t.test('anonymous users and ordinary authenticated readers cannot access private posts or roles', async () => {
    await assert.rejects(as('anon', null, 'select * from public.blog_private_posts'), /permission denied/);
    assert.equal((await as('authenticated', reader, 'select * from public.blog_private_posts')).length, 0);
    await assert.rejects(as('authenticated', reader, 'select * from public.blog_friend_requests'), /permission denied/);
    await assert.rejects(as('authenticated', reader, `insert into public.blog_friends(user_id,approved_by) values ('${reader}','${reader}')`), /permission denied/);
    await assert.rejects(as('authenticated', reader, `select * from public.blog_apply_friend('${reader}','123','reader',null,'reader@example.com')`), /permission denied/);
  });
  await t.test('duplicate submissions produce one durable request', async () => {
    const first = await as('service_role', null, 'select * from public.blog_apply_friend($1,$2,$3,$4,$5)', [reader, '123', 'reader', 'Reader', 'reader@example.com']);
    requestId = first[0].id;
    const second = await as('service_role', null, 'select * from public.blog_apply_friend($1,$2,$3,$4,$5)', [reader, '123', 'reader', 'Reader', 'changed@example.com']);
    assert.equal(second[0].id, requestId); assert.equal(second[0].email, 'reader@example.com');
  });
  await t.test('RPCs check admin identity even when invoked via the service role', async () => {
    await assert.rejects(as('service_role', null, 'select * from public.blog_review_friend($1,$2,$3)', [reader, requestId, 'approved']), /Administrator required/);
  });
  await t.test('approval grants access atomically and creates only one notification', async () => {
    for (let attempt = 0; attempt < 2; attempt++) await as('service_role', null, 'select * from public.blog_review_friend($1,$2,$3)', [owner, requestId, 'approved']);
    assert.equal((await db.query('select * from public.blog_approval_emails')).rows.length, 1);
    assert.equal((await as('authenticated', reader, 'select * from public.blog_private_posts')).length, 1);
    assert.equal((await as('authenticated', other, 'select * from public.blog_private_posts')).length, 0);
  });
  await t.test('the same mail cannot be claimed by simultaneous deliveries or sent again after completion', async () => {
    const jobs = await as('service_role', null, 'select * from public.blog_claim_approval_email($1)', [requestId]);
    assert.equal(jobs.length, 1);
    assert.equal((await as('service_role', null, 'select * from public.blog_claim_approval_email($1)', [requestId])).length, 0);
    await as('service_role', null, 'select public.blog_finish_approval_email($1,$2,$3,$4)', [jobs[0].id, jobs[0].lease_token, 'mail-id', null]);
    assert.equal((await as('service_role', null, 'select * from public.blog_claim_approval_email($1)', [requestId])).length, 0);
  });
  await t.test('rejected requests create no email and cannot be silently changed to approval', async () => {
    const [request] = await as('service_role', null, 'select * from public.blog_apply_friend($1,$2,$3,$4,$5)', [other, '456', 'other', 'Other', 'other@example.com']);
    await as('service_role', null, 'select * from public.blog_review_friend($1,$2,$3)', [owner, request.id, 'rejected']);
    assert.equal((await as('service_role', null, 'select * from public.blog_claim_approval_email($1)', [request.id])).length, 0);
    await assert.rejects(as('service_role', null, 'select * from public.blog_review_friend($1,$2,$3)', [owner, request.id, 'approved']), /already reviewed/);
  });
  await t.test('revocation immediately blocks subsequent database reads', async () => {
    await db.query('delete from public.blog_friends where user_id=$1', [reader]);
    assert.equal((await as('authenticated', reader, 'select * from public.blog_private_posts')).length, 0);
  });
  await db.close();
});
