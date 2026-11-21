import test from 'node:test';
import assert from 'node:assert/strict';
import {createFriendHandler, githubProfile} from '../supabase/functions/_shared/friend-service.mjs';

const requestId = '00000000-0000-4000-8000-000000000002';
const user = {id: 'reader', email: 'reader@example.com', email_confirmed_at: '2026-11-21',
  identities: [{provider: 'github', id: '123', identity_data: {sub: '123', user_name: 'reader'}}]};
function setup({admin = false, friend = false, requestSent = false, mailError = false, currentUser = user} = {}) {
  const calls = {apply: [], reviews: [], emails: [], finished: [], owner: []};
  let job = {id: requestId, recipient: user.email, lease_token: 'lease'};
  const store = {
    ensureOwner: async id => { calls.owner.push(id); admin = true; },
    isAdmin: async () => admin, isFriend: async () => friend,
    requestForUser: async () => requestSent ? {id: requestId} : null,
    apply: async value => { calls.apply.push(value); requestSent = true; },
    listRequests: async () => [{id: requestId}],
    review: async (...args) => { calls.reviews.push(args); return {id: requestId, status: args[2]}; },
    claimEmail: async () => { const result = job; job = null; return result; },
    finishEmail: async (...args) => { calls.finished.push(args); },
  };
  const handler = createFriendHandler({store, siteUrl: 'https://example.com',
    publicConfig: {supabaseUrl: 'https://example.supabase.co', supabasePublicKey: 'public'},
    authenticate: async token => token === 'valid' ? currentUser : null,
    sendEmail: async value => { calls.emails.push(value); if (mailError) throw Error('failed'); return 'mail-id'; },
  });
  const call = async (body, token = 'valid', origin = 'https://example.com') => handler(new Request('https://api.example.com', {
    method: 'POST', headers: {Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }));
  return {call, calls, handler};
}

test('rejects forged sessions and unapproved cross-origin requests', async () => {
  const {call, calls} = setup();
  assert.equal((await call({action: 'apply'}, 'forged')).status, 401);
  assert.equal((await call({action: 'apply'}, 'valid', 'https://other.example')).status, 403);
  assert.equal(calls.apply.length, 0);
});
test('uses provider identity instead of editable profile metadata', () => {
  assert.equal(githubProfile({...user, user_metadata: {user_name: 'HzmSailor', sub: '173534334', role: 'admin'}}).login, 'reader');
  assert.throws(() => githubProfile({...user, identities: []}));
});
test('an ordinary login never implies Friend or admin status', async () => {
  const {call, calls} = setup(); const response = await (await call({action: 'status'})).json();
  assert.equal(response.is_friend, false); assert.equal(response.is_admin, false);
  assert.equal(calls.owner.length, 0);
});
test('only the trusted GitHub provider ID bootstraps the owner', async () => {
  const {call, calls} = setup({currentUser: {...user, identities: [{provider: 'github',
    identity_data: {sub: '173534334', user_name: 'HzmSailor'}}]}});
  const response = await (await call({action: 'status'})).json();
  assert.equal(response.is_admin, true); assert.equal(response.is_friend, true);
  assert.deepEqual(calls.owner, [user.id]);
});
test('applications without a verified email are not silently accepted', async () => {
  const {call, calls} = setup({currentUser: {...user, email_confirmed_at: null}});
  assert.equal((await call({action: 'apply'})).status, 422);
  assert.equal(calls.apply.length, 0);
});
test('successful application uses verified account email and persists submission', async () => {
  const {call, calls} = setup();
  const response = await (await call({action: 'apply', email: 'attacker@example.com', github_login: 'HzmSailor'})).json();
  assert.equal(response.request_sent, true);
  assert.equal(calls.apply[0].email, user.email); assert.equal(calls.apply[0].github_login, 'reader');
  assert.equal((await (await call({action: 'status'})).json()).request_sent, true);
  assert.equal(calls.emails.length, 0);
});
test('ordinary visitors cannot list applicants or approve/reject requests', async () => {
  const {call, calls} = setup();
  for (const action of ['list', 'review', 'retry_email']) {
    assert.equal((await call({action, request_id: requestId, decision: 'approved'})).status, 403);
  }
  assert.equal(calls.reviews.length, 0); assert.equal(calls.emails.length, 0);
});
test('rejection does not send an email', async () => {
  const {call, calls} = setup({admin: true});
  const response = await (await call({action: 'review', request_id: requestId, decision: 'rejected'})).json();
  assert.equal(response.email, 'not_sent'); assert.equal(calls.emails.length, 0);
});
test('approval sends notification to the stored recipient with an idempotency key', async () => {
  const {call, calls} = setup({admin: true});
  const response = await (await call({action: 'review', request_id: requestId, decision: 'approved'})).json();
  assert.equal(response.email, 'sent'); assert.equal(calls.emails[0].to, user.email);
  assert.equal(calls.emails[0].id, `friend-approved/${requestId}`);
  assert.match(calls.emails[0].text, /欢迎我的朋友！/);
  await call({action: 'retry_email', request_id: requestId});
  assert.equal(calls.emails.length, 1);
});
test('delivery failure is visible and persisted without undoing approved access', async () => {
  const {call, calls} = setup({admin: true, mailError: true});
  const response = await (await call({action: 'review', request_id: requestId, decision: 'approved'})).json();
  assert.equal(response.status, 'approved'); assert.equal(response.email, 'failed');
  assert.match(calls.finished[0][2], /发送失败/);
});
