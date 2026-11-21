import {HttpError} from './friend-service.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = ['academic', 'daily'];
const visibility = ['public', 'friends', 'private'];

export async function handleNoteAction(input, {user, admin, store}) {
  const category = input.category || 'all';
  if (!['all', ...categories].includes(category)) throw new HttpError(400, '笔记分类不正确。');
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, '分页参数不正确。');
  }
  if (input.action === 'notes_list' || input.action === 'notes_manage') {
    const manage = input.action === 'notes_manage';
    if (manage && !admin) throw new HttpError(403, '只有管理员可以管理笔记。');
    // This store uses the caller's JWT (or anon role), so PostgreSQL RLS filters
    // both metadata and content. The service-role client is never used for reads.
    const items = await store.list({category, offset, limit: limit + 1, archived: manage && input.archived === true});
    return {notes: items.slice(0, limit), has_more: items.length > limit};
  }
  if (input.action === 'notes_read') {
    if (!uuid.test(input.id || '')) throw new HttpError(400, '笔记编号不正确。');
    const note = await store.read(input.id);
    if (!note) throw new HttpError(404, '笔记不存在或你暂无访问权限。');
    return {note};
  }
  if (!user || !admin) throw new HttpError(403, '只有管理员可以管理笔记。');
  try {
    if (input.action === 'notes_save') {
      const note = input.note;
      if (!note || typeof note !== 'object' || Array.isArray(note) ||
          typeof note.title !== 'string' || !note.title.trim() || note.title.trim().length > 200 ||
          typeof note.summary !== 'string' || note.summary.length > 600 ||
          typeof note.content !== 'string' || note.content.length > 200000 ||
          !categories.includes(note.category) || !visibility.includes(note.visibility) ||
          (note.id != null && (!uuid.test(note.id) || !Number.isInteger(note.revision) || note.revision < 1))) {
        throw new HttpError(400, '请检查标题、正文、分类和可见性，标题最多 200 字，摘要最多 600 字。');
      }
      return {note: await store.save(user.id, {...note, title: note.title.trim(), summary: note.summary.trim()})};
    }
    if (['notes_archive', 'notes_restore'].includes(input.action)) {
      if (!uuid.test(input.id || '') || !Number.isInteger(input.revision) || input.revision < 1) {
        throw new HttpError(400, '笔记编号或版本不正确。');
      }
      return {note: await store.archive(user.id, input.id, input.revision, input.action === 'notes_archive')};
    }
  } catch (error) {
    if (error.code === '40001') throw new HttpError(409, '笔记已在其他页面更新，请重新载入后再保存。');
    if (error.code === '42501') throw new HttpError(403, '只有管理员可以管理笔记。');
    if (error.code === 'P0002') throw new HttpError(404, '笔记不存在。');
    throw error;
  }
  throw new HttpError(400, '不支持的笔记操作。');
}
