import {createClient} from 'npm:@supabase/supabase-js@2.119.2';
import {createFriendHandler} from '../_shared/friend-service.mjs';
import {handleNoteAction} from '../_shared/note-service.mjs';

const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: {persistSession: false, autoRefreshToken: false},
});
const checked = (result: any) => { if (result.error) throw result.error; return result.data; };
const rpc = async (name: string, args: object) => checked(await client.rpc(name, args));
const singleRpc = async (name: string, args: object) => {
  const result = await rpc(name, args);
  return Array.isArray(result) ? result[0] : result;
};

function noteStore(token: string | null) {
  const reader = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: token ? {Authorization: `Bearer ${token}`} : {}},
  });
  return {
    async list({category, offset, limit, archived}: any) {
      let query = reader.from('blog_notes')
        .select('id,title,summary,category,visibility,published_at,updated_at,revision,archived_at')
        .order('published_at', {ascending: false}).order('id', {ascending: false});
      query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
      if (category !== 'all') query = query.eq('category', category);
      return checked(await query.range(offset, offset + limit - 1));
    },
    async read(id: string) { return checked(await reader.from('blog_notes').select('*').eq('id', id).maybeSingle()); },
    async save(actor: string, note: any) {
      return singleRpc('blog_save_note', {p_actor: actor, p_id: note.id || null, p_title: note.title,
        p_summary: note.summary, p_content: note.content, p_category: note.category,
        p_visibility: note.visibility, p_revision: note.revision || 0});
    },
    async archive(actor: string, id: string, revision: number, archived: boolean) {
      return singleRpc('blog_archive_note', {p_actor: actor, p_id: id, p_revision: revision, p_archived: archived});
    },
  };
}

const store = {
  async ensureOwner(id: string) { checked(await client.from('blog_admins').upsert({user_id: id}, {onConflict: 'user_id'})); },
  async isAdmin(id: string) { return Boolean(checked(await client.from('blog_admins').select('user_id').eq('user_id', id).maybeSingle())); },
  async isFriend(id: string) { return Boolean(checked(await client.from('blog_friends').select('user_id').eq('user_id', id).maybeSingle())); },
  async requestForUser(id: string) { return checked(await client.from('blog_friend_requests').select('id').eq('user_id', id).maybeSingle()); },
  async apply(profile: any) { return rpc('blog_apply_friend', {p_user: profile.user_id, p_github_id: profile.github_id,
    p_login: profile.github_login, p_name: profile.github_name, p_email: profile.email}); },
  async listRequests() {
    return checked(await client.from('blog_friend_requests')
      .select('id,github_id,github_login,github_name,email,status,created_at,reviewed_at,blog_approval_emails(sent_at,last_error)')
      .order('created_at', {ascending: false}).limit(200));
  },
  async review(actor: string, request: string, decision: string) {
    const result = await rpc('blog_review_friend', {p_actor: actor, p_request: request, p_decision: decision});
    return Array.isArray(result) ? result[0] : result;
  },
  async claimEmail(id: string) { return (await rpc('blog_claim_approval_email', {p_request: id}))[0] || null; },
  async finishEmail(job: any, providerId: string | null, error: string | null) {
    return rpc('blog_finish_approval_email', {p_id: job.id, p_token: job.lease_token, p_provider_id: providerId, p_error: error});
  },
};

async function gmailTransport() {
  const user = Deno.env.get('BLOG_SMTP_USER');
  const password = Deno.env.get('BLOG_SMTP_PASSWORD');
  if (!user || !password) throw new Error('Gmail SMTP is not configured');
  const {default: nodemailer} = await import('npm:nodemailer@10.6.1');
  return {user, transport: nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: {user, pass: password.replace(/\s/g, '')},
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  })};
}

const handler = createFriendHandler({
  store,
  async notes(input: any, context: any) {
    return handleNoteAction(input, {...context, store: noteStore(context.token)});
  },
  publicConfig: {supabaseUrl: Deno.env.get('SUPABASE_URL'), supabasePublicKey: Deno.env.get('SUPABASE_ANON_KEY')},
  siteUrl: Deno.env.get('BLOG_SITE_URL') || 'https://hzmsailor.github.io',
  async authenticate(token: string) {
    const {data, error} = await client.auth.getUser(token);
    return error ? null : data.user;
  },
  async verifyEmail() {
    const {transport} = await gmailTransport();
    await transport.verify();
  },
  async sendEmail(message: {id: string; to: string; subject: string; text: string}) {
    const {user, transport} = await gmailTransport();
    const result = await transport.sendMail({
      from: {name: 'Zimu Han', address: user}, to: message.to,
      subject: message.subject, text: message.text,
      messageId: `<friend-approved.${message.id.split('/').pop()}@hzmsailor.github.io>`,
    });
    if (!result.accepted?.length) throw new Error('Email was not accepted');
    return result.messageId;
  },
});
export default {fetch: handler};
