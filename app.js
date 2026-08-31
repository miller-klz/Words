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
    if (name === 'today') { dayOffset = 0; renderToday(); }
    if (name === 'list') { populateAuthorFilter().then(() => renderList()); }
    if (name === 'settings') renderSettings();
    if (name === 'add') {
      if (editingId === null) resetForm();
      resetAddMode();
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

  let dayOffset = 0; // 0 = today, negative = that many recorded days back

  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Speech isn\'t supported on this device'); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  }

  function formatHistoryDate(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const todayKey = wjTodayKey();
    const yesterdayKey = wjTodayKey(new Date(Date.now() - 86400000));
    if (dateKey === todayKey) return 'Today';
    if (dateKey === yesterdayKey) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  async function renderToday() {
    const container = document.getElementById('today-content');
    const navLabel = document.getElementById('day-nav-label');
    const prevBtn = document.getElementById('day-prev-btn');
    const nextBtn = document.getElementById('day-next-btn');
    const { word, entry, atOldest, atNewest } = await wjGetWordAtOffset(dayOffset);

    if (!entry) {
      navLabel.textContent = '';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      container.innerHTML = `
        <div class="empty-state">
          <span class="big-emoji">📖</span>
          <p>You haven't saved any words yet.<br>Add your first favorite word to see it here.</p>
          <button class="btn-primary" id="empty-add-btn">Add a word</button>
        </div>`;
      document.getElementById('empty-add-btn').addEventListener('click', () => showView('add'));
      return;
    }

    navLabel.textContent = formatHistoryDate(entry.date);
    prevBtn.disabled = atOldest;
    nextBtn.disabled = atNewest;

    if (!word) {
      container.innerHTML = `<div class="empty-state"><p>The word shown that day was later deleted.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="card">
        <div class="today-word-row">
          <h2 class="today-word">${escapeHtml(word.word)}</h2>
          <button type="button" class="speak-btn" id="today-speak-btn" aria-label="Hear this word">🔊</button>
        </div>
        <div class="today-meta">${escapeHtml(word.pos || '')}${word.phonetic ? ' · ' + escapeHtml(word.phonetic) : ''}</div>
        <p class="today-definition">${word.definition ? escapeHtml(word.definition) : '<em>No definition yet — go add one from My Words.</em>'}</p>
        ${word.quote ? `
          <blockquote class="today-quote">
            “${escapeHtml(word.quote)}”
            ${(word.author || word.book) ? `<cite>— ${escapeHtml(word.author || '')}${word.book ? ', ' + escapeHtml(word.book) : ''}</cite>` : ''}
          </blockquote>` : ''}
        ${word.etymology ? `
          <div class="etymology-block">
            <span class="label">Etymology</span>
            ${escapeHtml(word.etymology)}
          </div>` : ''}
      </div>
    `;
    document.getElementById('today-speak-btn').addEventListener('click', () => speak(word.word));
  }

  document.getElementById('day-prev-btn').addEventListener('click', () => { dayOffset -= 1; renderToday(); });
  document.getElementById('day-next-btn').addEventListener('click', () => { dayOffset = Math.min(0, dayOffset + 1); renderToday(); });

  (function setupSwipe() {
    const area = document.getElementById('today-swipe-area');
    let startX = 0, startY = 0, tracking = false;

    area.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    area.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) {
        dayOffset -= 1; // swipe left -> go back to an earlier day
      } else {
        dayOffset = Math.min(0, dayOffset + 1); // swipe right -> toward today
      }
      renderToday();
    }, { passive: true });
  })();

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
        <h3>${escapeHtml(w.word)} <span class="pos">${escapeHtml(w.pos || '')}</span> <button type="button" class="speak-btn" data-action="speak" data-word="${escapeHtml(w.word)}" aria-label="Hear this word">🔊</button></h3>
        <p class="def">${w.definition ? escapeHtml(w.definition) : '<em>No definition yet — tap Edit to add one.</em>'}</p>
        ${w.quote ? `<blockquote>“${escapeHtml(w.quote)}”${(w.author || w.book) ? ` — ${escapeHtml(w.author || '')}${w.book ? ', ' + escapeHtml(w.book) : ''}` : ''}</blockquote>` : ''}
        ${w.etymology ? `<div class="etymology-block"><span class="label">Etymology</span>${escapeHtml(w.etymology)}</div>` : ''}
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
    if (btn.dataset.action === 'speak') {
      speak(btn.dataset.word);
    } else if (btn.dataset.action === 'delete') {
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
    etymology: document.getElementById('input-etymology'),
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
    fields.etymology.value = w.etymology || '';
    fields.quote.value = w.quote || '';
    fields.author.value = w.author || '';
    fields.book.value = w.book || '';
    document.getElementById('save-btn').textContent = 'Update word';
    document.getElementById('lookup-status').textContent = '';
    showView('add');
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent.replace(/\s+/g, ' ').trim();
  }

  // Words copied from a book often carry a capital letter (start of a
  // sentence) or curly quotes/dashes that dictionary sites won't match.
  function normalizeWordForLookup(word) {
    return word
      .trim()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/^["'.,;:!?()\[\]]+|["'.,;:!?()\[\]]+$/g, '');
  }

  async function fetchWithTimeout(url, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function lookupFromDictionaryApi(word) {
    const res = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data[0];
    if (!entry) return null;
    const phonetic = entry.phonetic || (entry.phonetics || []).map((p) => p.text).filter(Boolean)[0] || '';
    const meaning = (entry.meanings || [])[0];
    const definition = meaning && meaning.definitions && meaning.definitions[0] ? meaning.definitions[0].definition : '';
    const pos = meaning ? meaning.partOfSpeech : '';
    return { phonetic, pos, definition };
  }

  // Wiktionary has broader coverage than dictionaryapi.dev, especially for
  // more literary/archaic words, so it's used as a fallback when the first
  // source comes up empty.
  async function lookupFromWiktionary(word) {
    const res = await fetchWithTimeout(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entries = data.en || Object.values(data)[0] || [];
    const first = entries[0];
    if (!first) return null;
    const def0 = (first.definitions || [])[0];
    const definition = def0 && def0.definition ? stripHtml(def0.definition) : '';
    return { phonetic: '', pos: first.partOfSpeech || '', definition };
  }

  async function lookupEtymology(word) {
    try {
      const secRes = await fetchWithTimeout(`https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=sections&format=json&origin=*`);
      if (!secRes.ok) return '';
      const secData = await secRes.json();
      if (secData.error) return '';
      const sections = (secData.parse && secData.parse.sections) || [];
      const etySection = sections.find((s) => /^etymology/i.test(s.line));
      if (!etySection) return '';
      const textRes = await fetchWithTimeout(`https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=text&section=${etySection.index}&format=json&origin=*`);
      if (!textRes.ok) return '';
      const textData = await textRes.json();
      const html = textData.parse && textData.parse.text && textData.parse.text['*'];
      if (!html) return '';
      return stripHtml(html).replace(/\[\d+\]/g, '').trim();
    } catch (err) {
      return '';
    }
  }

  async function lookupOnce(word) {
    let result = await lookupFromDictionaryApi(word).catch((err) => { console.warn('dictionaryapi.dev lookup failed', err); return null; });
    if (!result || !result.definition) {
      const fallback = await lookupFromWiktionary(word).catch((err) => { console.warn('Wiktionary lookup failed', err); return null; });
      if (fallback && fallback.definition) {
        result = { phonetic: result ? result.phonetic : '', pos: result && result.pos ? result.pos : fallback.pos, definition: fallback.definition };
      }
    }
    return result;
  }

  // Tries the word as typed, then falls back to an all-lowercase version —
  // most dictionary/Wiktionary pages are titled lowercase, so a capitalized
  // word (e.g. copied from the start of a sentence) would otherwise 404.
  async function lookupWordInfo(word, { withEtymology } = {}) {
    const cleaned = normalizeWordForLookup(word);
    let result = await lookupOnce(cleaned);
    let matchedWord = cleaned;
    if ((!result || !result.definition) && cleaned.toLowerCase() !== cleaned) {
      const lower = cleaned.toLowerCase();
      const lowerResult = await lookupOnce(lower);
      if (lowerResult && lowerResult.definition) {
        result = lowerResult;
        matchedWord = lower;
      }
    }
    result = result || { phonetic: '', pos: '', definition: '' };
    result.etymology = withEtymology ? await lookupEtymology(matchedWord) : '';
    return result;
  }

  document.getElementById('lookup-btn').addEventListener('click', async () => {
    const word = fields.word.value.trim();
    if (!word) { toast('Type a word first'); return; }
    const statusEl = document.getElementById('lookup-status');
    const lookupBtn = document.getElementById('lookup-btn');
    lookupBtn.disabled = true;
    statusEl.textContent = 'Looking up…';
    try {
      const { phonetic, pos, definition, etymology } = await lookupWordInfo(word, { withEtymology: true });
      if (phonetic) fields.phonetic.value = phonetic;
      if (pos) fields.pos.value = pos;
      if (definition) fields.definition.value = definition;
      if (etymology) fields.etymology.value = etymology;

      if (!definition) {
        statusEl.textContent = 'Could not find that word online — you can type the meaning yourself.';
      } else {
        const missing = [];
        if (!pos) missing.push('part of speech');
        if (!phonetic) missing.push('pronunciation');
        if (!etymology) missing.push('etymology');
        statusEl.textContent = missing.length
          ? `Definition found (no ${missing.join(' or ')} available online) — feel free to fill it in.`
          : 'Definition found — feel free to edit it.';
      }
    } finally {
      lookupBtn.disabled = false;
    }
  });

  // ---------- Bulk add ----------

  const addModeToggle = document.getElementById('add-mode-toggle');
  const bulkPanel = document.getElementById('bulk-add-panel');

  function resetAddMode() {
    addModeToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'single'));
    bulkPanel.hidden = true;
    form.hidden = false;
    document.getElementById('bulk-words-input').value = '';
    document.getElementById('bulk-add-status').textContent = '';
  }

  addModeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode;
    addModeToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    bulkPanel.hidden = mode !== 'bulk';
    form.hidden = mode === 'bulk';
  });

  document.getElementById('bulk-add-btn').addEventListener('click', async () => {
    const textarea = document.getElementById('bulk-words-input');
    const statusEl = document.getElementById('bulk-add-status');
    const wordsToAdd = textarea.value
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean);

    if (!wordsToAdd.length) { toast('Type at least one word'); return; }

    const bulkBtn = document.getElementById('bulk-add-btn');
    bulkBtn.disabled = true;
    let missingDefinition = 0;

    for (let i = 0; i < wordsToAdd.length; i++) {
      const word = wordsToAdd[i];
      statusEl.textContent = `Looking up ${i + 1} of ${wordsToAdd.length}: ${word}…`;
      const looked = await lookupWordInfo(word, { withEtymology: true });
      if (!looked.definition) missingDefinition++;
      await wjAddWord({
        word,
        pos: looked.pos || '',
        phonetic: looked.phonetic || '',
        definition: looked.definition || '',
        etymology: looked.etymology || '',
        quote: '',
        author: '',
        book: '',
        dateAdded: Date.now(),
      });
    }

    bulkBtn.disabled = false;
    textarea.value = '';
    statusEl.textContent = '';
    toast(`Added ${wordsToAdd.length} word${wordsToAdd.length === 1 ? '' : 's'}` +
      (missingDefinition ? ` — ${missingDefinition} need a definition added` : ''));
    showView('list');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = {
      word: fields.word.value.trim(),
      pos: fields.pos.value.trim(),
      phonetic: fields.phonetic.value.trim(),
      definition: fields.definition.value.trim(),
      etymology: fields.etymology.value.trim(),
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

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Wikidata's search covers a huge range of real people; filtering to
  // descriptions that sound like writers keeps the suggestion list relevant.
  async function searchAuthorsOnline(query) {
    if (!query || query.length < 2) return [];
    try {
      const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&type=item&limit=15&format=json&origin=*`);
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.search || [];
      const authorKeywords = /writer|author|novelist|poet|playwright|essayist|screenwriter|journalist/i;
      const filtered = items.filter((i) => i.description && authorKeywords.test(i.description));
      const names = (filtered.length ? filtered : items).map((i) => i.label).filter(Boolean);
      return Array.from(new Set(names));
    } catch (err) {
      return [];
    }
  }

  async function updateAuthorSuggestions(query, datalistEl) {
    const favorites = await wjGetAllAuthors();
    const q = query.toLowerCase();
    const favNames = favorites.map((a) => a.name).filter((n) => !q || n.toLowerCase().includes(q));
    const online = await searchAuthorsOnline(query);
    const merged = Array.from(new Set([...favNames, ...online]));
    datalistEl.innerHTML = merged.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  const debouncedAuthorSearch = debounce(updateAuthorSuggestions, 300);

  fields.author.addEventListener('input', () => {
    debouncedAuthorSearch(fields.author.value.trim(), document.getElementById('authors-datalist'));
  });

  document.getElementById('new-author-input').addEventListener('input', () => {
    debouncedAuthorSearch(document.getElementById('new-author-input').value.trim(), document.getElementById('new-author-datalist'));
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

      // Match by word (case-insensitive) against what's already saved: fill
      // in/overwrite only the fields the import actually provides, so a
      // second import (e.g. adding quotes/authors after a first pass that
      // only had definitions) enriches existing entries instead of
      // creating duplicates.
      const existing = await wjGetAllWords();
      const byName = new Map(existing.map((w) => [w.word.toLowerCase(), w]));
      let added = 0;
      let updated = 0;

      for (const item of items) {
        if (!item.word) continue;
        const key = item.word.toLowerCase();
        const match = byName.get(key);

        if (match) {
          const merged = {
            ...match,
            pos: item.pos || match.pos,
            phonetic: item.phonetic || match.phonetic,
            definition: item.definition || match.definition,
            etymology: item.etymology || match.etymology,
            quote: item.quote || match.quote,
            author: item.author || match.author,
            book: item.book || match.book,
          };
          await wjUpdateWord(merged);
          byName.set(key, merged);
          updated++;
        } else if (item.definition) {
          const entry = {
            word: item.word, pos: item.pos || '', phonetic: item.phonetic || '',
            definition: item.definition, etymology: item.etymology || '', quote: item.quote || '',
            author: item.author || '', book: item.book || '', dateAdded: item.dateAdded || Date.now(),
          };
          const id = await wjAddWord(entry);
          entry.id = id;
          byName.set(key, entry);
          added++;
        }

        if (item.author) await wjEnsureAuthor(item.author);
      }

      toast(`Added ${added}, updated ${updated}`);
      renderSettings();
    } catch (err) {
      toast('Could not read that file');
    }
    e.target.value = '';
  });

  document.getElementById('delete-all-btn').addEventListener('click', async () => {
    const words = await wjGetAllWords();
    if (!words.length) { toast('No words to delete'); return; }
    const sure = confirm(`Delete all ${words.length} saved words? This can't be undone — export a backup first if you want one.`);
    if (!sure) return;
    await wjDeleteAllWords();
    toast('All words deleted');
    renderSettings();
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
