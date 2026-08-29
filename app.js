(function () {
  'use strict';

  let swRegistration = null;
  let editingId = null;

  // ---------- Navigation ----------

  const views = {
    today: document.getElementById('view-today'),
    list: document.getElementById('view-list'),
    add: document.getElementById('view-add'),
    settings: document.getElementById('view-settings'),
  };
  const tabButtons = document.querySelectorAll('nav.tabbar button');

  function showView(name) {
    Object.keys(views).forEach((k) => views[k].classList.toggle('active', k === name));
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'today') renderToday();
    if (name === 'list') { populateAuthorFilter().then(() => renderList()); }
    if (name === 'settings') renderSettings();
    if (name === 'add') {
      if (editingId === null) resetForm();
      populateAuthorsDatalist();
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  // ---------- Today ----------

  async function renderToday() {
    const container = document.getElementById('today-content');
    const { word } = await wjPickWordOfDay();

    if (!word) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="big-emoji">📖</span>
          <p>You haven't saved any words yet.<br>Add your first favorite word to see it here.</p>
          <button class="btn-primary" id="empty-add-btn">Add a word</button>
        </div>`;
      document.getElementById('empty-add-btn').addEventListener('click', () => showView('add'));
      return;
    }

    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    container.innerHTML = `
      <p class="hint" style="margin-bottom:10px">${escapeHtml(dateStr)}</p>
      <div class="card">
        <h2 class="today-word">${escapeHtml(word.word)}</h2>
        <div class="today-meta">${escapeHtml(word.pos || '')}${word.phonetic ? ' · ' + escapeHtml(word.phonetic) : ''}</div>
        <p class="today-definition">${escapeHtml(word.definition)}</p>
        ${word.quote ? `
          <blockquote class="today-quote">
            “${escapeHtml(word.quote)}”
            ${(word.author || word.book) ? `<cite>— ${escapeHtml(word.author || '')}${word.book ? ', ' + escapeHtml(word.book) : ''}</cite>` : ''}
          </blockquote>` : ''}
      </div>
    `;
  }

  // ---------- List ----------

  async function populateAuthorFilter() {
    const select = document.getElementById('author-filter');
    const authors = await wjGetAllAuthors();
    const current = select.value;
    select.innerHTML = '<option value="">All authors</option>' +
      authors.map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
    if (authors.some((a) => a.name === current)) select.value = current;
  }

  async function renderList(filterText) {
    const listEl = document.getElementById('word-list');
    const authorFilter = document.getElementById('author-filter').value;
    let words = await wjGetAllWords();
    words.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

    if (filterText === undefined) filterText = document.getElementById('search-input').value;

    if (filterText) {
      const f = filterText.toLowerCase();
      words = words.filter((w) => w.word.toLowerCase().includes(f));
    }
    if (authorFilter) {
      words = words.filter((w) => w.author === authorFilter);
    }

    if (!words.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="big-emoji">🔎</span><p>${(filterText || authorFilter) ? 'No words match.' : 'No words saved yet.'}</p></div>`;
      return;
    }

    listEl.innerHTML = words.map((w) => `
      <div class="card word-card" data-id="${w.id}">
        <h3>${escapeHtml(w.word)} <span class="pos">${escapeHtml(w.pos || '')}</span></h3>
        <p class="def">${escapeHtml(w.definition)}</p>
        ${w.quote ? `<blockquote>“${escapeHtml(w.quote)}”${(w.author || w.book) ? ` — ${escapeHtml(w.author || '')}${w.book ? ', ' + escapeHtml(w.book) : ''}` : ''}</blockquote>` : ''}
        <div class="actions">
          <button class="btn-secondary small-btn" data-action="edit" data-id="${w.id}">Edit</button>
          <button class="btn-danger small-btn" data-action="delete" data-id="${w.id}">Delete</button>
        </div>
      </div>
    `).join('');
  }

  document.getElementById('search-input').addEventListener('input', (e) => renderList(e.target.value));
  document.getElementById('author-filter').addEventListener('change', () => renderList());

  document.getElementById('word-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'delete') {
      if (confirm('Delete this word?')) {
        await wjDeleteWord(id);
        toast('Word deleted');
        renderList(document.getElementById('search-input').value);
      }
    } else if (btn.dataset.action === 'edit') {
      const words = await wjGetAllWords();
      const w = words.find((x) => x.id === id);
      if (w) startEdit(w);
    }
  });

  // ---------- Add / Edit form ----------

  const form = document.getElementById('word-form');
  const fields = {
    word: document.getElementById('input-word'),
    pos: document.getElementById('input-pos'),
    phonetic: document.getElementById('input-phonetic'),
    definition: document.getElementById('input-definition'),
    quote: document.getElementById('input-quote'),
    author: document.getElementById('input-author'),
    book: document.getElementById('input-book'),
  };

  function resetForm() {
    editingId = null;
    form.reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('save-btn').textContent = 'Save word';
    document.getElementById('lookup-status').textContent = '';
  }

  function startEdit(w) {
    editingId = w.id;
    document.getElementById('edit-id').value = w.id;
    fields.word.value = w.word || '';
    fields.pos.value = w.pos || '';
    fields.phonetic.value = w.phonetic || '';
    fields.definition.value = w.definition || '';
    fields.quote.value = w.quote || '';
    fields.author.value = w.author || '';
    fields.book.value = w.book || '';
    document.getElementById('save-btn').textContent = 'Update word';
    document.getElementById('lookup-status').textContent = '';
    showView('add');
  }

  document.getElementById('lookup-btn').addEventListener('click', async () => {
    const word = fields.word.value.trim();
    if (!word) { toast('Type a word first'); return; }
    const statusEl = document.getElementById('lookup-status');
    statusEl.textContent = 'Looking up…';
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const entry = data[0];
      const phonetic = entry.phonetic || (entry.phonetics || []).map((p) => p.text).filter(Boolean)[0] || '';
      const meaning = (entry.meanings || [])[0];
      const definition = meaning && meaning.definitions && meaning.definitions[0] ? meaning.definitions[0].definition : '';
      const pos = meaning ? meaning.partOfSpeech : '';

      if (phonetic) fields.phonetic.value = phonetic;
      if (pos) fields.pos.value = pos;
      if (definition) fields.definition.value = definition;
      statusEl.textContent = definition ? 'Definition found — feel free to edit it.' : 'Found the word, but no definition text. Add your own.';
    } catch (err) {
      statusEl.textContent = 'Could not find that word online — you can type the meaning yourself.';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = {
      word: fields.word.value.trim(),
      pos: fields.pos.value.trim(),
      phonetic: fields.phonetic.value.trim(),
      definition: fields.definition.value.trim(),
      quote: fields.quote.value.trim(),
      author: fields.author.value.trim(),
      book: fields.book.value.trim(),
      dateAdded: Date.now(),
    };
    if (!entry.word || !entry.definition) return;

    if (editingId !== null) {
      entry.id = editingId;
      await wjUpdateWord(entry);
      toast('Word updated');
    } else {
      await wjAddWord(entry);
      toast('Word saved');
    }
    if (entry.author) await wjEnsureAuthor(entry.author);
    resetForm();
    showView('list');
  });

  // ---------- Authors ----------

  async function populateAuthorsDatalist() {
    const authors = await wjGetAllAuthors();
    document.getElementById('authors-datalist').innerHTML =
      authors.map((a) => `<option value="${escapeHtml(a.name)}"></option>`).join('');
  }

  async function renderAuthorChips() {
    const authors = await wjGetAllAuthors();
    const el = document.getElementById('author-chip-list');
    el.innerHTML = authors.length
      ? authors.map((a) => `<span class="author-chip">${escapeHtml(a.name)}<button type="button" data-id="${a.id}" aria-label="Remove ${escapeHtml(a.name)}">&times;</button></span>`).join('')
      : `<p class="hint">No favorite authors yet — add one above, or it'll be added automatically the next time you save a word with an author.</p>`;
  }

  document.getElementById('add-author-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-author-input');
    const name = input.value.trim();
    if (!name) return;
    await wjEnsureAuthor(name);
    input.value = '';
    renderAuthorChips();
  });

  document.getElementById('new-author-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-author-btn').click(); }
  });

  document.getElementById('author-chip-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    await wjDeleteAuthor(Number(btn.dataset.id));
    renderAuthorChips();
  });

  // ---------- Settings ----------

  async function renderSettings() {
    const words = await wjGetAllWords();
    document.getElementById('word-count').textContent = `${words.length} word${words.length === 1 ? '' : 's'} saved.`;
    renderAuthorChips();

    const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
    const statusEl = document.getElementById('notif-status');
    const enableBtn = document.getElementById('enable-notif-btn');
    const hintEl = document.getElementById('notif-hint');

    if (permission === 'granted') {
      statusEl.textContent = 'On';
      statusEl.classList.add('on');
      enableBtn.textContent = 'Send today’s word now';
      enableBtn.disabled = false;
    } else if (permission === 'unsupported') {
      statusEl.textContent = 'Unsupported';
      enableBtn.disabled = true;
    } else {
      statusEl.textContent = permission === 'denied' ? 'Blocked' : 'Off';
      statusEl.classList.remove('on');
      enableBtn.textContent = 'Enable daily notification';
      enableBtn.disabled = permission === 'denied';
    }

    const periodicSupported = swRegistration && 'periodicSync' in swRegistration;
    let periodicNote = '';
    if (permission === 'granted') {
      periodicNote = periodicSupported
        ? 'Background daily notifications are set up on this device.'
        : 'This browser can’t schedule notifications in the background, so Word Journal will show today’s word as soon as you open the app each day (works great if you check it in the morning). For a guaranteed background notification on iPhone, add this app to your Home Screen first, then enable notifications.';
    } else if (permission === 'denied') {
      periodicNote = 'Notifications are blocked for this app in your browser/phone settings. Enable them there to use this feature.';
    } else {
      periodicNote = 'Add Word Journal to your Home Screen for the best notification support, then tap Enable.';
    }
    hintEl.textContent = periodicNote;
  }

  document.getElementById('enable-notif-btn').addEventListener('click', async () => {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      // Already on: use this tap to show today's word right now.
      if (swRegistration) swRegistration.active && swRegistration.active.postMessage({ type: 'SHOW_WORD_OF_DAY' });
      toast('Sent!');
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await registerServiceWorker();
      await tryEnablePeriodicSync();
      markNotifiedToday(); // avoid double-firing immediately after opt-in
      toast('Daily notifications enabled');
    } else {
      toast('Notifications not enabled');
    }
    renderSettings();
  });

  // ---------- Export / Import ----------

  document.getElementById('export-btn').addEventListener('click', async () => {
    const words = await wjGetAllWords();
    const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `word-journal-backup-${wjTodayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const items = JSON.parse(text);
      if (!Array.isArray(items)) throw new Error('bad format');
      let count = 0;
      for (const item of items) {
        if (!item.word || !item.definition) continue;
        const entry = {
          word: item.word, pos: item.pos || '', phonetic: item.phonetic || '',
          definition: item.definition, quote: item.quote || '', author: item.author || '',
          book: item.book || '', dateAdded: item.dateAdded || Date.now(),
        };
        await wjAddWord(entry);
        count++;
      }
      toast(`Imported ${count} word${count === 1 ? '' : 's'}`);
      renderSettings();
    } catch (err) {
      toast('Could not read that file');
    }
    e.target.value = '';
  });

  // ---------- Notifications: service worker + daily check ----------

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      await navigator.serviceWorker.register('sw.js');
      swRegistration = await navigator.serviceWorker.ready;
      return swRegistration;
    } catch (err) {
      return null;
    }
  }

  async function tryEnablePeriodicSync() {
    if (!swRegistration || !('periodicSync' in swRegistration)) return false;
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state !== 'granted') return false;
      await swRegistration.periodicSync.register('daily-word', { minInterval: 20 * 60 * 60 * 1000 });
      return true;
    } catch (err) {
      return false;
    }
  }

  function lastNotifiedKey() { return 'wj-last-notified'; }
  function markNotifiedToday() { localStorage.setItem(lastNotifiedKey(), wjTodayKey()); }

  async function maybeShowTodayNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (localStorage.getItem(lastNotifiedKey()) === wjTodayKey()) return;
    if (!swRegistration) await registerServiceWorker();
    if (!swRegistration || !swRegistration.active) return;
    const { word } = await wjPickWordOfDay();
    if (!word) return;
    swRegistration.active.postMessage({ type: 'SHOW_WORD_OF_DAY' });
    markNotifiedToday();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeShowTodayNotification();
  });

  // ---------- Init ----------

  (async function init() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('sw.js');
        swRegistration = await navigator.serviceWorker.ready;
      } catch (err) { /* offline-first stuff just won't work; app still runs */ }
    }
    renderToday();
    maybeShowTodayNotification();
  })();
})();
