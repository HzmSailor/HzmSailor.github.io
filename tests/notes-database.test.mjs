import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const owner = '00000000-0000-4000-8000-000000000001';
const friend = '00000000-0000-4000-8000-000000000002';
const visitor = '00000000-0000-4000-8000-000000000003';

test('PostgreSQL enforces all three note visibility levels and reversible management', async t => {
  const db = new PGlite();
  async function as(role, uid, sql, params = []) {
    await db.exec(`set role ${role}`);
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
      return (await db.query(sql, params)).rows;
    } finally { await db.exec('reset role'); }
  }
  const save = async (value, actor = owner) => (await as('service_role', null,
    'select * from public.blog_save_note($1,$2,$3,$4,$5,$6,$7,$8)',
    [actor, value.id || null, value.title || 'Test', 'Summary', 'Body', value.category || 'daily', value.visibility, value.revision || 0]))[0];
  const archive = async (value, archived) => (await as('service_role', null,
    'select * from public.blog_archive_note($1,$2,$3,$4)', [owner, value.id, value.revision, archived]))[0];
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.identities(user_id uuid, provider text, provider_id text);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      insert into auth.users values ('${owner}'), ('${friend}'), ('${visitor}');
      insert into auth.identities values ('${owner}', 'github', '173534334');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202611210001_friend_access.sql', import.meta.url), 'utf8'));
    await db.exec("insert into public.blog_private_posts(slug,title,content) values ('legacy','Legacy secret','Legacy body')");
    await db.exec(await readFile(new URL('../supabase/migrations/202611210002_note_management.sql', import.meta.url), 'utf8'));
    await db.query('insert into public.blog_friends(user_id,approved_by) values ($1,$2)', [friend, owner]);
    const notes = {};
    for (const visibility of ['public', 'friends', 'private']) notes[visibility] = await save({visibility});
    await t.test('migration preserves legacy Friend-only content and removes the old table path', async () => {
      const legacy = (await db.query("select * from public.blog_notes where slug='legacy'")).rows[0];
      assert.equal(legacy.visibility, 'friends'); assert.equal(legacy.content, 'Legacy body');
      assert.equal((await db.query("select to_regclass('public.blog_private_posts') as old")).rows[0].old, null);
      assert.equal((await as('anon', null, "select * from public.blog_notes where slug='legacy'")).length, 0);
    });
    for (const [role, uid, allowed] of [['anon', null, ['public']], ['authenticated', visitor, ['public']],
      ['authenticated', friend, ['public', 'friends']], ['authenticated', owner, ['public', 'friends', 'private']]]) {
      await t.test(`${uid || role}: metadata and body share the same visibility boundary`, async () => {
        for (const [visibility, note] of Object.entries(notes)) {
          const rows = await as(role, uid, 'select id,title,summary,content from public.blog_notes where id=$1', [note.id]);
          assert.equal(rows.length, allowed.includes(visibility) ? 1 : 0);
          if (rows.length) assert.equal(rows[0].content, 'Body');
        }
      });
    }
    await t.test('both categories accept the three levels; invalid values are rejected', async () => {
      for (const visibility of ['public', 'friends', 'private']) await save({visibility, category: 'academic'});
      await assert.rejects(save({visibility: 'bad'}), /Invalid note/);
      await assert.rejects(save({visibility: 'private', category: 'bad'}), /Invalid note/);
    });
    await t.test('browser roles cannot write directly or invoke service-only RPCs, even when admin', async () => {
      for (const [role, uid] of [['anon', null], ['authenticated', visitor], ['authenticated', friend], ['authenticated', owner]]) {
        await assert.rejects(as(role, uid, "update public.blog_notes set visibility='public'"), /permission denied/);
        await assert.rejects(as(role, uid, 'select * from public.blog_archive_note($1,$2,$3,true)',
          [owner, notes.private.id, 1]), /permission denied/);
        await assert.rejects(as(role, uid, "select * from public.blog_save_note($1,null,'x','','','daily','public',0)", [owner]), /permission denied/);
      }
      await assert.rejects(save({visibility: 'public'}, visitor), /Administrator required/);
    });
    await t.test('changing public to private blocks subsequent guest and Friend reads; stale saves fail', async () => {
      const original = notes.public;
      notes.public = await save({...original, visibility: 'private'});
      assert.equal(notes.public.revision, original.revision + 1);
      for (const [role, uid] of [['anon', null], ['authenticated', visitor], ['authenticated', friend]]) {
        assert.equal((await as(role, uid, 'select * from public.blog_notes where id=$1', [original.id])).length, 0);
      }
      await assert.rejects(save({...original, visibility: 'public'}), /revision conflict/);
      assert.equal((await as('authenticated', owner, 'select * from public.blog_notes where id=$1', [original.id])).length, 1);
    });
    await t.test('archive hides public notes from readers, retains them for admin, and restores without data loss', async () => {
      const original = await save({visibility: 'public'});
      const archived = await archive(original, true);
      assert.ok(archived.archived_at);
      assert.equal((await as('anon', null, 'select * from public.blog_notes where id=$1', [original.id])).length, 0);
      assert.equal((await as('authenticated', owner, 'select * from public.blog_notes where id=$1', [original.id])).length, 1);
      await assert.rejects(save(archived), /Restore the note/);
      await assert.rejects(archive(original, false), /revision conflict/);
      const restored = await archive(archived, false);
      assert.equal(restored.archived_at, null); assert.equal(restored.content, original.content);
      assert.equal((await as('anon', null, 'select * from public.blog_notes where id=$1', [original.id])).length, 1);
    });
    await t.test('revoking Friend access blocks the next read of Friend-only notes', async () => {
      await db.query('delete from public.blog_friends where user_id=$1', [friend]);
      assert.equal((await as('authenticated', friend, 'select * from public.blog_notes where id=$1', [notes.friends.id])).length, 0);
    });
  } finally { await db.close(); }
});
