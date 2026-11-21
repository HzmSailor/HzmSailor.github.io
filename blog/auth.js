import {authEndpoint} from './auth-config.js';

const blogRoot = new URL('./', import.meta.url);
const loginButton = document.getElementById('blog-login');
const logoutButton = document.getElementById('blog-logout');
const friendButton = document.getElementById('blog-friend-apply');
const greeting = document.getElementById('blog-greeting');
const accountNote = document.getElementById('blog-account-note');
const message = document.getElementById('blog-auth-message');
const avatar = document.getElementById('blog-account-avatar');
const adminLink = document.getElementById('blog-admin-link');
const requestNote = document.getElementById('blog-request-note');
const adminList = document.getElementById('blog-admin-list');
const adminNote = document.getElementById('blog-admin-note');
const checkEmailButton = document.getElementById('blog-check-email');
let client;
let session;
let status;
let busy = false;
let requestsSequence = 0;
let authContext = {ready: false, user_id: null, is_admin: false, is_friend: false};

export function getBlogAuth() { return {...authContext}; }
function announceAuth(next) {
  if (JSON.stringify(next) === JSON.stringify(authContext)) return;
  authContext = next;
  window.dispatchEvent(new CustomEvent('blog-auth-change', {detail: getBlogAuth()}));
}

function notify(text, error = false) {
  message.textContent = text;
  message.classList.toggle('is-error', error);
}

export async function api(action, values = {}, {anonymous = false} = {}) {
  const {data, error} = client ? await client.auth.getSession() : {data: {session: null}, error: null};
  if (error || (!data.session && !anonymous)) throw new Error('请先使用 GitHub 账号登录。');
  const headers = {'Content-Type': 'application/json'};
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  const response = await fetch(authEndpoint, {
    method: 'POST', headers, cache: 'no-store',
    body: JSON.stringify({action, ...values}), signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。');
  return result;
}

function signedOut(ready = true) {
  requestsSequence++;
  status = null;
  loginButton.hidden = false;
  logoutButton.hidden = true;
  friendButton.hidden = true;
  requestNote.hidden = true;
  adminLink.hidden = true;
  avatar.hidden = true;
  greeting.textContent = '欢迎来到我的 Blog';
  accountNote.textContent = '公开笔记无需登录；Friend 可以阅读“需要权限”的笔记。';
  if (adminList) adminList.replaceChildren();
  if (checkEmailButton) checkEmailButton.hidden = true;
  if (adminNote) adminNote.textContent = '请先登录管理员账号。';
  announceAuth({ready, user_id: null, is_admin: false, is_friend: false});
}

function renderStatus(value) {
  status = value;
  loginButton.hidden = true;
  logoutButton.hidden = false;
  greeting.textContent = value.is_friend ? '欢迎我的朋友！' : '欢迎您！';
  accountNote.textContent = `@${value.profile.login}${value.is_friend ? ' · Friend' : ''}`;
  avatar.src = value.profile.avatar;
  avatar.hidden = false;
  friendButton.hidden = value.is_friend;
  requestNote.hidden = value.is_friend || value.request_sent;
  friendButton.textContent = value.request_sent ? '已发送申请' : '申请 Friend 权限';
  friendButton.disabled = value.request_sent;
  adminLink.hidden = !value.is_admin;
  if (checkEmailButton) checkEmailButton.hidden = !value.is_admin;
  announceAuth({ready: true, user_id: session?.user.id || null, is_admin: value.is_admin, is_friend: value.is_friend});
}

async function refresh() {
  if (!client || busy) return;
  busy = true;
  try {
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (!session) { signedOut(); return; }
    // Do not infer Friend/admin status from localStorage, UI state, or JWT metadata.
    const userId = session.user.id;
    const value = await api('status');
    const current = await client.auth.getSession();
    if (current.error || current.data.session?.user.id !== userId) { signedOut(); return; }
    session = current.data.session;
    renderStatus(value);
    if (adminList) {
      if (status.is_admin) {
        if (!document.getElementById('blog-friends-panel')?.hidden) await loadRequests();
      } else { adminList.replaceChildren(); adminNote.textContent = '此页面仅供管理员使用。'; }
    }
  } catch (error) {
    // Clear stale privileged UI after errors or revocation.
    signedOut();
    notify(error.message || '暂时无法读取登录状态，请稍后重试。', true);
  } finally { busy = false; }
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function review(request, decision, button) {
  button.disabled = true;
  try {
    const result = await api('review', {request_id: request.id, decision});
    notify(decision === 'rejected' ? '已拒绝申请，未发送邮件。'
      : result.email === 'failed' ? '已批准权限；通知邮件发送失败，请使用重试按钮。' : '已批准权限，通知邮件已发送或正在发送。');
    await loadRequests();
  } catch (error) { notify(error.message, true); button.disabled = false; }
}

async function loadRequests() {
  const sequence = ++requestsSequence;
  const user = authContext.user_id;
  const {requests} = await api('list');
  if (sequence !== requestsSequence || !authContext.is_admin || authContext.user_id !== user) return;
  const fragment = document.createDocumentFragment();
  for (const request of requests) {
    const card = document.createElement('article');
    card.className = 'blog-request-card';
    const heading = document.createElement('h2');
    const link = textElement('a', `@${request.github_login}`);
    link.href = `https://github.com/${encodeURIComponent(request.github_login)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    heading.append(link);
    card.append(heading, textElement('p', `${request.github_name || request.github_login} · GitHub ID ${request.github_id}`),
      textElement('p', request.email), textElement('p', new Date(request.created_at).toLocaleString('zh-CN')));
    const controls = document.createElement('div'); controls.className = 'blog-account-actions';
    if (request.status === 'pending') {
      for (const [decision, label] of [['approved', '批准'], ['rejected', '不批准']]) {
        const button = textElement('button', label, 'blog-button');
        button.type = 'button'; button.addEventListener('click', () => review(request, decision, button));
        controls.append(button);
      }
    } else {
      controls.append(textElement('span', request.status === 'approved' ? '已批准' : '未批准'));
      const mail = request.blog_approval_emails;
      const email = Array.isArray(mail) ? mail[0] : mail;
      if (request.status === 'approved' && email && !email.sent_at) {
        const retry = textElement('button', '重试通知邮件', 'blog-button'); retry.type = 'button';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try {
            const result = await api('retry_email', {request_id: request.id});
            notify(result.email === 'failed' ? '邮件仍未发送，请稍后重试。' : '通知邮件已发送或正在发送。');
            await loadRequests();
          } catch (error) { notify(error.message, true); retry.disabled = false; }
        });
        controls.append(retry);
      } else if (email?.sent_at) controls.append(textElement('span', '通知邮件已发送'));
    }
    card.append(controls); fragment.append(card);
  }
  adminList.replaceChildren(fragment);
  adminNote.textContent = requests.length ? `共 ${requests.length} 条申请（最多显示最近 200 条）` : '暂无 Friend 申请。';
}

loginButton.addEventListener('click', async () => {
  if (!client) { notify('GitHub 登录正在配置中，公开文章可直接阅读。'); return; }
  loginButton.disabled = true;
  try {
    sessionStorage.setItem('blog-return-path', location.pathname + location.search);
    const {error} = await client.auth.signInWithOAuth({provider: 'github', options: {
      scopes: 'read:user user:email', redirectTo: new URL('auth/callback/', blogRoot).href,
    }});
    if (error) throw error;
  } catch (error) { notify('GitHub 登录失败，请稍后重试。', true); loginButton.disabled = false; }
});

logoutButton.addEventListener('click', async () => {
  if (!window.dispatchEvent(new CustomEvent('blog-before-logout', {cancelable: true}))) return;
  logoutButton.disabled = true;
  try {
    const {error} = await client.auth.signOut({scope: 'local'});
    if (error) throw error;
    session = null; signedOut(); notify('已退出登录。');
  } catch { notify('退出失败，请重试。', true); }
  finally { logoutButton.disabled = false; }
});

friendButton.addEventListener('click', async () => {
  friendButton.disabled = true;
  friendButton.textContent = '正在发送…';
  try {
    const result = await api('apply');
    await refresh();
    notify(result.is_friend ? '你已经拥有 Friend 权限。' : '申请已发送，批准后会通知你的 GitHub 绑定邮箱。');
  } catch (error) {
    friendButton.textContent = '申请 Friend 权限'; friendButton.disabled = false;
    notify(error.message, true);
  }
});

checkEmailButton?.addEventListener('click', async () => {
  checkEmailButton.disabled = true;
  notify('正在检查通知邮件连接…');
  try { await api('check_email'); notify('通知邮件连接正常，可以发送批准通知。'); }
  catch (error) { notify(error.message, true); }
  finally { checkEmailButton.disabled = false; }
});

async function initialize() {
  signedOut(false);
  if (!authEndpoint) { notify('GitHub 登录正在配置中，公开文章可直接阅读。'); return; }
  loginButton.disabled = true;
  try {
    const response = await fetch(authEndpoint, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('登录服务暂时不可用。');
    const config = await response.json();
    const {createClient} = await import('https://esm.sh/@supabase/supabase-js@2.119.2');
    client = createClient(config.supabaseUrl, config.supabasePublicKey, {
      auth: {flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true},
    });
    if (location.pathname === new URL('auth/callback/', blogRoot).pathname) {
      const params = new URLSearchParams(location.search);
      if (params.get('error') || !params.get('code')) throw new Error('GitHub 登录未完成，请返回 Blog 重试。');
      const {error} = await client.auth.exchangeCodeForSession(params.get('code'));
      if (error) throw error;
      const returnPath = sessionStorage.getItem('blog-return-path') || blogRoot.pathname;
      sessionStorage.removeItem('blog-return-path');
      const target = new URL(returnPath, location.origin);
      location.replace(target.origin === location.origin && target.pathname.startsWith(blogRoot.pathname) ? target.href : blogRoot.href);
      return;
    }
    // Defer calls out of the auth callback to avoid the SDK's auth-lock deadlock.
    client.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    await refresh();
    window.addEventListener('focus', refresh);
    setInterval(() => { if (!document.hidden && session) refresh(); }, 60000);
  } catch (error) { notify(error.message || '登录服务暂时不可用，请稍后重试。', true); }
  finally { loginButton.disabled = false; }
}

window.addEventListener('blog-show-friends', () => {
  if (status?.is_admin && adminList) loadRequests().catch(error => notify(error.message, true));
});

initialize();
