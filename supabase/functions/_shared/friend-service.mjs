export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function githubProfile(user) {
  const identity = user.identities?.find(item => item.provider === 'github');
  const data = identity?.identity_data || {};
  const id = String(data.provider_id || data.sub || identity?.id || '');
  const login = String(data.user_name || data.preferred_username || '');
  // Use provider identity data, never the editable user_metadata for authorization.
  if (!/^\d+$/.test(id) || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
    throw new HttpError(403, '请使用 GitHub 账号登录。');
  }
  return {id, login, name: String(data.full_name || data.name || login).slice(0, 200),
    avatar: `https://avatars.githubusercontent.com/u/${id}?s=80`};
}

export async function deliverApproval(store, sendEmail, requestId, siteUrl) {
  const job = await store.claimEmail(requestId);
  if (!job) return 'sent_or_sending';
  try {
    const providerId = await sendEmail({
      id: `friend-approved/${job.id}`, to: job.recipient,
      subject: '你的 Friend 权限申请已通过',
      text: `欢迎我的朋友！\n\n你的 Friend 权限申请已通过。现在可以使用原来的 GitHub 账号登录 Blog，阅读全部 Daily 文章。\n\n${siteUrl}/blog/\n\nZimu Han`,
    });
    await store.finishEmail(job, providerId, null);
    return 'sent';
  } catch {
    // Persist the unsent job. Admins see a retry action; rejection never creates a job.
    await store.finishEmail(job, null, '通知发送失败，请重试。');
    return 'failed';
  }
}

export function createFriendHandler({authenticate, store, sendEmail, verifyEmail, siteUrl, publicConfig, ownerGithubId = '173534334'}) {
  const origin = new URL(siteUrl).origin;
  return async request => {
    const cors = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store'};
    const json = (body, status = 200) => Response.json(body, {status, headers: cors});
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) {
      return json({error: '不允许的请求来源。'}, 403);
    }
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    // Only the browser-safe publishable/anon key is returned here. This keeps
    // credentials out of the source repository; service keys never leave the server.
    if (request.method === 'GET') return json(publicConfig);
    if (request.method !== 'POST') return json({error: '只支持 POST。'}, 405);
    try {
      const bearer = request.headers.get('authorization') || '';
      if (!bearer.startsWith('Bearer ')) throw new HttpError(401, '请先登录。');
      const user = await authenticate(bearer.slice(7));
      if (!user) throw new HttpError(401, '登录已过期，请重新登录。');
      const profile = githubProfile(user);
      if (profile.id === ownerGithubId) await store.ensureOwner(user.id);
      let input;
      try { input = await request.json(); } catch { throw new HttpError(400, '请求格式不正确。'); }
      const admin = await store.isAdmin(user.id);
      if (input.action === 'status') {
        return json({profile, is_admin: admin, is_friend: admin || await store.isFriend(user.id),
          request_sent: Boolean(await store.requestForUser(user.id))});
      }
      if (input.action === 'apply') {
        if (admin || await store.isFriend(user.id)) return json({request_sent: false, is_friend: true});
        if (!user.email_confirmed_at || !user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
          throw new HttpError(422, '未能读取已验证的 GitHub 邮箱，请确认账号绑定了可用邮箱后重新登录。');
        }
        await store.apply({user_id: user.id, github_id: profile.id, github_login: profile.login,
          github_name: profile.name, email: user.email});
        return json({request_sent: true});
      }
      if (!admin) throw new HttpError(403, '只有管理员可以审批申请。');
      if (input.action === 'list') return json({requests: await store.listRequests()});
      if (input.action === 'check_email') {
        try { await verifyEmail(); return json({email_ready: true}); }
        catch (error) {
          const code = String(error?.code || error?.name || 'UNKNOWN');
          console.error('SMTP verification failed:', code, String(error?.message || '').slice(0, 250));
          throw new HttpError(503, `通知邮件连接失败（${code}），请稍后重试或检查 Gmail 应用专用密码。`);
        }
      }
      if (!/^[0-9a-f-]{36}$/i.test(input.request_id || '')) throw new HttpError(400, '申请编号不正确。');
      if (input.action === 'review') {
        if (!['approved', 'rejected'].includes(input.decision)) throw new HttpError(400, '审批结果不正确。');
        const result = await store.review(user.id, input.request_id, input.decision);
        const email = result.status === 'approved'
          ? await deliverApproval(store, sendEmail, result.id, siteUrl) : 'not_sent';
        return json({status: result.status, email});
      }
      if (input.action === 'retry_email') {
        return json({email: await deliverApproval(store, sendEmail, input.request_id, siteUrl)});
      }
      throw new HttpError(400, '不支持的操作。');
    } catch (error) {
      return json({error: error instanceof HttpError ? error.message : '操作失败，请稍后重试。'},
        error instanceof HttpError ? error.status : 500);
    }
  };
}
