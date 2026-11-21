import {api, getBlogAuth} from './auth.js?v=20261121-notes';
import {renderMarkdown} from './markdown.js';

const root = new URL('./', import.meta.url);
const labels = {public: '公开', friends: '需要权限', private: '私密'};
const byId = id => document.getElementById(id);
const publicList = byId('blog-notes-list');
const reader = byId('note-reader');
const manager = byId('blog-note-manager');
const form = byId('note-form');
let context = {ready: false, user_id: null, is_admin: false, is_friend: false};
let listSequence = 0;
let readSequence = 0;
let manageSequence = 0;
let listOffset = 0;
let manageOffset = 0;
let edit = null;
let dirty = false;
let draftSequence = 0;

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function noteUrl(id) { return new URL(`note/?id=${encodeURIComponent(id)}`, root).href; }
function timestamp(value) { return new Date(value).toLocaleDateString('zh-CN'); }
function status(id, content, error = false) {
  const node = byId(id);
  if (!node) return;
  node.textContent = content;
  node.classList.toggle('is-error', error);
}

function noteCard(note) {
  const item = document.createElement('li');
  const card = document.createElement('article'); card.className = 'blog-post-card';
  const meta = document.createElement('div'); meta.className = 'blog-post-meta';
  const badge = text('span', labels[note.visibility], `note-visibility note-visibility-${note.visibility}`);
  meta.append(text('span', note.category === 'academic' ? 'Academic' : 'Daily'), badge);
  const time = text('time', timestamp(note.published_at)); time.dateTime = note.published_at; meta.append(time);
  const heading = document.createElement('h3');
  const link = text('a', note.title); link.href = noteUrl(note.id); heading.append(link);
  card.append(meta, heading, text('p', note.summary)); item.append(card);
  return item;
}

async function loadList(append = false) {
  if (!publicList) return;
  const sequence = ++listSequence;
  if (!append) { publicList.replaceChildren(); listOffset = 0; }
  byId('notes-more').hidden = true;
  status('notes-status', '正在读取笔记…');
  try {
    const {notes, has_more} = await api('notes_list', {
      category: publicList.dataset.category || 'all', offset: listOffset,
      limit: publicList.dataset.category === 'all' ? 6 : 20,
    }, {anonymous: true});
    if (sequence !== listSequence) return;
    notes.forEach(note => publicList.append(noteCard(note)));
    listOffset += notes.length;
    byId('notes-more').hidden = !has_more;
    status('notes-status', listOffset ? '' : '暂无可阅读的笔记。');
  } catch (error) { if (sequence === listSequence) status('notes-status', error.message, true); }
}

async function loadReader() {
  if (!reader) return;
  const sequence = ++readSequence;
  byId('note-reader-title').textContent = '笔记';
  byId('note-reader-meta').replaceChildren();
  byId('note-reader-content').replaceChildren();
  byId('note-edit-link').hidden = true;
  document.title = '笔记 | Zimu Han';
  status('note-reader-status', '正在读取笔记…');
  try {
    const id = new URLSearchParams(location.search).get('id');
    const {note} = await api('notes_read', {id}, {anonymous: true});
    if (sequence !== readSequence) return;
    byId('note-reader-title').textContent = note.title;
    document.title = `${note.title} | Zimu Han`;
    byId('note-reader-meta').append(text('span', note.category === 'academic' ? 'Academic' : 'Daily'),
      text('span', labels[note.visibility], 'note-visibility'), text('time', timestamp(note.published_at)));
    if (note.archived_at) byId('note-reader-meta').append(text('span', '回收站'));
    renderMarkdown(byId('note-reader-content'), note.content);
    byId('note-edit-link').href = new URL(`admin/?note=${encodeURIComponent(note.id)}`, root).href;
    byId('note-edit-link').hidden = !context.is_admin;
    status('note-reader-status', '');
  } catch (error) { if (sequence === readSequence) status('note-reader-status', error.message, true); }
}

function canDiscard() { return !dirty || window.confirm('有尚未保存的笔记修改，确定放弃这些修改吗？'); }
function setDirty(value) {
  dirty = value;
  byId('note-dirty').textContent = value ? '有未保存的修改' : '';
}
function updatePreview() { renderMarkdown(byId('note-preview'), byId('note-content').value); }
function resetEditor(note = null) {
  edit = note;
  draftSequence++;
  byId('note-editor-heading').textContent = note ? '编辑笔记' : '新建笔记';
  byId('note-title').value = note?.title || '';
  byId('note-summary').value = note?.summary || '';
  byId('note-content').value = note?.content || '';
  byId('note-category').value = note?.category || 'daily';
  byId('note-visibility').value = note?.visibility || 'private';
  byId('note-open-link').hidden = !note;
  if (note) byId('note-open-link').href = noteUrl(note.id);
  byId('note-save').disabled = false;
  setDirty(false); updatePreview(); status('note-editor-status', '');
}

async function openEditor(id) {
  if (!canDiscard()) return;
  const sequence = ++draftSequence;
  const user = context.user_id;
  status('note-editor-status', '正在载入笔记…');
  try {
    const {note} = await api('notes_read', {id});
    if (sequence !== draftSequence || !context.is_admin || context.user_id !== user) return;
    if (note.archived_at) throw new Error('请先从回收站恢复笔记。');
    resetEditor(note);
    history.replaceState(null, '', `?note=${encodeURIComponent(note.id)}`);
    byId('note-title').focus();
  } catch (error) { if (sequence === draftSequence) status('note-editor-status', error.message, true); }
}

async function archiveNote(note, archived, button) {
  if (edit?.id === note.id && !canDiscard()) return;
  button.disabled = true;
  const user = context.user_id;
  try {
    await api(archived ? 'notes_archive' : 'notes_restore', {id: note.id, revision: note.revision});
    if (!context.is_admin || context.user_id !== user) return;
    if (edit?.id === note.id) resetEditor();
    status('note-manage-status', archived ? '已移到回收站，可随时恢复。' : '笔记已恢复。');
    await loadManager();
  } catch (error) { status('note-manage-status', error.message, true); button.disabled = false; }
}

async function loadManager(append = false) {
  if (!manager || !context.is_admin) return;
  const sequence = ++manageSequence;
  if (!append) { byId('note-manage-list').replaceChildren(); manageOffset = 0; }
  byId('note-manage-more').hidden = true;
  status('note-manage-status', '正在读取笔记…');
  try {
    const archived = byId('note-show-trash').checked;
    const {notes, has_more} = await api('notes_manage', {archived, offset: manageOffset, limit: 20});
    if (sequence !== manageSequence || !context.is_admin) return;
    for (const note of notes) {
      const card = document.createElement('article'); card.className = 'note-manage-card';
      const title = text('h3', note.title);
      card.append(title, text('p', `${note.category === 'academic' ? 'Academic' : 'Daily'} · ${labels[note.visibility]}`));
      const actions = document.createElement('div'); actions.className = 'blog-account-actions';
      if (!archived) {
        const editButton = text('button', '编辑', 'blog-button'); editButton.type = 'button';
        editButton.addEventListener('click', () => openEditor(note.id)); actions.append(editButton);
      }
      const archiveButton = text('button', archived ? '恢复' : '移到回收站', 'blog-button'); archiveButton.type = 'button';
      archiveButton.addEventListener('click', () => archiveNote(note, !archived, archiveButton)); actions.append(archiveButton);
      card.append(actions); byId('note-manage-list').append(card);
    }
    manageOffset += notes.length;
    byId('note-manage-more').hidden = !has_more;
    status('note-manage-status', manageOffset ? '' : archived ? '回收站为空。' : '暂无笔记，先写下第一篇吧。');
  } catch (error) { if (sequence === manageSequence) status('note-manage-status', error.message, true); }
}

function switchMode(mode) {
  byId('blog-notes-panel').hidden = mode !== 'notes';
  byId('blog-friends-panel').hidden = mode !== 'friends';
  byId('mode-notes').setAttribute('aria-pressed', String(mode === 'notes'));
  byId('mode-friends').setAttribute('aria-pressed', String(mode === 'friends'));
  if (mode === 'friends') window.dispatchEvent(new Event('blog-show-friends'));
}

function authChanged() {
  const next = getBlogAuth();
  const changed = next.user_id !== context.user_id || next.is_admin !== context.is_admin || next.is_friend !== context.is_friend;
  context = next;
  if (manager) {
    byId('blog-admin-modes').hidden = !next.is_admin;
    manager.hidden = !next.is_admin;
    byId('blog-admin-gate').hidden = next.is_admin;
    if (!next.is_admin) {
      manageSequence++; draftSequence++;
      byId('note-manage-list').replaceChildren(); resetEditor();
      byId('blog-friends-panel').hidden = true;
    } else if (changed) {
      switchMode('notes'); loadManager();
      const id = new URLSearchParams(location.search).get('note');
      if (id) openEditor(id);
    }
  }
  loadList(); loadReader();
}

if (form) {
  resetEditor();
  form.addEventListener('input', () => { setDirty(true); updatePreview(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    for (const field of form.elements) field.disabled = true;
    const sequence = draftSequence;
    const user = context.user_id;
    const note = {id: edit?.id || null, revision: edit?.revision || 0, title: byId('note-title').value,
      summary: byId('note-summary').value, content: byId('note-content').value,
      category: byId('note-category').value, visibility: byId('note-visibility').value};
    status('note-editor-status', '正在保存…');
    try {
      const result = await api('notes_save', {note});
      if (sequence !== draftSequence || context.user_id !== user || !context.is_admin) return;
      resetEditor(result.note);
      history.replaceState(null, '', `?note=${encodeURIComponent(result.note.id)}`);
      status('note-editor-status', `已保存 · ${labels[result.note.visibility]}`);
      await loadManager();
    } catch (error) { if (sequence === draftSequence) status('note-editor-status', error.message, true); }
    finally { for (const field of form.elements) field.disabled = false; }
  });
  byId('note-new').addEventListener('click', () => {
    if (canDiscard()) { resetEditor(); history.replaceState(null, '', location.pathname); byId('note-title').focus(); }
  });
  byId('note-show-trash').addEventListener('change', () => loadManager());
  byId('note-manage-more').addEventListener('click', () => loadManager(true));
  byId('mode-notes').addEventListener('click', () => switchMode('notes'));
  byId('mode-friends').addEventListener('click', () => switchMode('friends'));
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('blog-before-logout', event => { if (!canDiscard()) event.preventDefault(); });
}
byId('notes-more')?.addEventListener('click', () => loadList(true));
byId('notes-refresh')?.addEventListener('click', () => loadList());
window.addEventListener('blog-auth-change', authChanged);
window.addEventListener('focus', () => { loadList(); loadReader(); });
authChanged();
