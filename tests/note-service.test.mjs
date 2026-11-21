import test from 'node:test';
import assert from 'node:assert/strict';
import {createFriendHandler} from '../supabase/functions/_shared/friend-service.mjs';
import {handleNoteAction} from '../supabase/functions/_shared/note-service.mjs';

const id = '00000000-0000-4000-8000-000000000009';
const note = {id, revision: 1, title: 'Example', summary: '', content: '# Text', category: 'daily', visibility: 'private'};
function setup(overrides = {}) {
  const calls = [];
  const noteStore = {
    list: async options => { calls.push(['list', options]); return []; },
    read: async () => null,
    save: async (actor, value) => { calls.push(['save', actor, value]); return {...value, id, revision: 1}; },
    archive: async (...args) => { calls.push(['archive', ...args]); return note; }, ...overrides,
  };
  const handler = createFriendHandler({
    siteUrl: 'https://example.com', publicConfig: {},
    authenticate: async token => ['admin', 'reader'].includes(token) ? {id: token,
      identities: [{provider: 'github', identity_data: {sub: '123', user_name: 'reader'}}]} : null,
    store: {isAdmin: async actor => actor === 'admin'},
    notes: async (input, context) => {
      calls.push(['context', context]);
      return handleNoteAction(input, {...context, store: noteStore});
    },
  });
  async function call(body, token = null) {
    return handler(new Request('https://api.example.com', {method: 'POST',
      headers: {'Content-Type': 'application/json', ...(token == null ? {} : {Authorization: `Bearer ${token}`})},
      body: JSON.stringify(body)}));
  }
  return {call, calls};
}

test('public reads work without a login and preserve caller identity when signed in', async () => {
  const {call, calls} = setup();
  assert.equal((await call({action: 'notes_list'})).status, 200);
  assert.equal(calls[0][1].token, null);
  assert.equal((await call({action: 'notes_list'}, 'reader')).status, 200);
  assert.equal(calls[2][1].token, 'reader');
  assert.equal(calls[2][1].user.id, 'reader');
  assert.equal((await call({action: 'notes_read', id})).status, 404);
});
test('a supplied invalid credential is rejected instead of silently falling back to guest', async () => {
  const {call, calls} = setup();
  assert.equal((await call({action: 'notes_list'}, 'forged')).status, 401);
  assert.equal(calls.length, 0);
});
test('ordinary visitors cannot manage, write, archive, or restore by forging roles', async () => {
  const {call, calls} = setup();
  for (const action of ['notes_manage', 'notes_save', 'notes_archive', 'notes_restore']) {
    assert.equal((await call({action, id, note, revision: 1, admin: true, user: {id: 'admin'}}, 'reader')).status, 403);
    assert.equal((await call({action, id, note, revision: 1})).status, 401);
  }
  assert.equal(calls.some(x => ['save', 'archive', 'list'].includes(x[0])), false);
});
test('save and archive bind the verified actor and validate visibility, revision, and lengths', async () => {
  const {call, calls} = setup();
  assert.equal((await call({action: 'notes_save', note, actor: 'attacker'}, 'admin')).status, 200);
  assert.equal(calls.find(x => x[0] === 'save')[1], 'admin');
  for (const change of [{visibility: 'everyone'}, {revision: 0}, {id: 'bad'}, {title: ''},
    {title: 'a'.repeat(201)}, {content: 'a'.repeat(200001)}, {category: 'bad'}, {summary: 'a'.repeat(601)}]) {
    assert.equal((await call({action: 'notes_save', note: {...note, ...change}}, 'admin')).status, 400);
  }
  for (const action of ['notes_archive', 'notes_restore']) {
    assert.equal((await call({action, id, revision: 1}, 'admin')).status, 200);
    assert.equal(calls.filter(x => x[0] === 'archive').at(-1)[1], 'admin');
    assert.equal(calls.filter(x => x[0] === 'archive').at(-1)[4], action === 'notes_archive');
  }
});
test('pagination is bounded and does not return an extra row', async () => {
  const {call} = setup({list: async () => [note, note, note]});
  const result = await (await call({action: 'notes_list', limit: 2})).json();
  assert.equal(result.notes.length, 2); assert.equal(result.has_more, true);
  for (const values of [{limit: 1000}, {offset: -1}, {offset: 1.5}, {category: 'bad'}]) {
    assert.equal((await call({action: 'notes_list', ...values})).status, 400);
  }
});
test('database conflicts preserve a useful status and do not expose SQL internals', async () => {
  for (const [code, expected] of [['40001', 409], ['42501', 403], ['P0002', 404]]) {
    const {call} = setup({save: async () => { throw Object.assign(Error('internal SQL text'), {code}); }});
    const response = await call({action: 'notes_save', note}, 'admin');
    assert.equal(response.status, expected);
    assert.doesNotMatch(JSON.stringify(await response.json()), /internal SQL/);
  }
});
