/* Shared IndexedDB helpers. Loaded via <script> in the page and
   importScripts() in the service worker, so it must stay plain
   ES5-ish script scope (no import/export) and use `self`, not `window`. */

var WJ_DB_NAME = 'word-journal';
var WJ_DB_VERSION = 2;

function wjOpenDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(WJ_DB_NAME, WJ_DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('words')) {
        var store = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        store.createIndex('word', 'word', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('authors')) {
        db.createObjectStore('authors', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function wjTx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wjGetAllWords() {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = wjTx(db, 'words', 'readonly').getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjAddWord(entry) {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var store = wjTx(db, 'words', 'readwrite');
      var req = store.add(entry);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjUpdateWord(entry) {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var store = wjTx(db, 'words', 'readwrite');
      var req = store.put(entry);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjDeleteWord(id) {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var store = wjTx(db, 'words', 'readwrite');
      var req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjGetMeta() {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = wjTx(db, 'meta', 'readonly').get('state');
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjSetMeta(state) {
  state.key = 'state';
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var store = wjTx(db, 'meta', 'readwrite');
      var req = store.put(state);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjGetAllAuthors() {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = wjTx(db, 'authors', 'readonly').getAll();
      req.onsuccess = function () {
        var authors = (req.result || []).sort(function (a, b) { return a.name.localeCompare(b.name); });
        resolve(authors);
      };
      req.onerror = function () { reject(req.error); };
    });
  });
}

/* Adds an author if a case-insensitive match isn't already saved.
   No-op for a blank name. Returns the (possibly pre-existing) author id. */
function wjEnsureAuthor(name) {
  name = (name || '').trim();
  if (!name) return Promise.resolve(null);
  return wjGetAllAuthors().then(function (authors) {
    var existing = authors.filter(function (a) { return a.name.toLowerCase() === name.toLowerCase(); })[0];
    if (existing) return existing.id;
    return wjOpenDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = wjTx(db, 'authors', 'readwrite').add({ name: name });
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  });
}

function wjDeleteAuthor(id) {
  return wjOpenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = wjTx(db, 'authors', 'readwrite').delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function wjTodayKey(d) {
  d = d || new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function wjShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* Deterministic-per-day word picker: cycles through all saved words in a
   shuffled order without repeats, reshuffling once a full cycle completes.
   Once a word is picked for "today" it stays the same for the rest of the day.
   Every day picked is appended to meta.history (date -> wordId) so past
   days can be revisited later. */
function wjPickWordOfDay() {
  var todayKey = wjTodayKey();
  return wjGetAllWords().then(function (words) {
    if (!words.length) return { word: null, words: words };
    var idSet = {};
    words.forEach(function (w) { idSet[w.id] = true; });

    return wjGetMeta().then(function (meta) {
      meta = meta || { lastDate: null, order: [], cursor: 0, currentWordId: null, history: [] };
      var history = meta.history || [];

      if (meta.lastDate === todayKey && idSet[meta.currentWordId]) {
        var existing = words.filter(function (w) { return w.id === meta.currentWordId; })[0];
        return { word: existing, words: words };
      }

      var order = (meta.order || []).filter(function (id) { return idSet[id]; });
      var missing = words
        .map(function (w) { return w.id; })
        .filter(function (id) { return order.indexOf(id) === -1; });
      order = order.concat(wjShuffle(missing));

      var cursor = meta.cursor || 0;
      if (cursor >= order.length) {
        order = wjShuffle(words.map(function (w) { return w.id; }));
        cursor = 0;
      }

      var currentWordId = order[cursor];
      cursor += 1;

      if (!history.length || history[history.length - 1].date !== todayKey) {
        history = history.concat([{ date: todayKey, wordId: currentWordId }]);
        if (history.length > 365) history = history.slice(history.length - 365);
      }

      return wjSetMeta({
        lastDate: todayKey,
        order: order,
        cursor: cursor,
        currentWordId: currentWordId,
        history: history,
      }).then(function () {
        var picked = words.filter(function (w) { return w.id === currentWordId; })[0];
        return { word: picked, words: words };
      });
    });
  });
}

/* Returns the chronological (oldest-first) list of {date, wordId} entries
   recorded by wjPickWordOfDay. */
function wjGetHistory() {
  return wjGetMeta().then(function (meta) {
    return (meta && meta.history) || [];
  });
}

/* offset 0 = today (computing/persisting today's pick if not already done),
   negative = that many days back in the recorded history.
   Resolves to { entry: {date, wordId} | null, word: word|null, atOldest, atNewest }. */
function wjGetWordAtOffset(offset) {
  return wjPickWordOfDay().then(function () {
    return wjGetHistory().then(function (history) {
      if (!history.length) return { entry: null, word: null, atOldest: true, atNewest: true };
      var index = history.length - 1 + offset;
      var clamped = Math.max(0, Math.min(history.length - 1, index));
      var entry = history[clamped];
      return wjGetAllWords().then(function (words) {
        var word = words.filter(function (w) { return w.id === entry.wordId; })[0] || null;
        return {
          entry: entry,
          word: word,
          atOldest: clamped === 0,
          atNewest: clamped === history.length - 1,
        };
      });
    });
  });
}
