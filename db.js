// ============================================================
// DigiEDU – db.js v3.0  |  Cloud-First / IndexedDB cache
// Jeden unified store "main_kb" pre všetky záznamy
// ============================================================

let _db = null;

// ── IndexedDB init ────────────────────────────────────────────
async function dbOpen() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      const old = e.oldVersion;

      // Hlavný unified store
      if (!db.objectStoreNames.contains('main_kb')) {
        const s = db.createObjectStore('main_kb', { keyPath: 'record_id' });
        s.createIndex('category',   'category',   { unique: false });
        s.createIndex('status',     'status',     { unique: false });
        s.createIndex('synced',     'synced',     { unique: false });
        s.createIndex('updated_at', 'updated_at', { unique: false });
      }
      // Pending sync queue – záznamy čakajúce na odoslanie do cloudu
      if (!db.objectStoreNames.contains('pending_sync')) {
        db.createObjectStore('pending_sync', { keyPath: 'record_id' });
      }
      // Meta key-value store
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // Topic coverage index
      if (!db.objectStoreNames.contains('topic_coverage')) {
        db.createObjectStore('topic_coverage', { keyPath: 'entry_id' });
      }
      // System changelog
      if (!db.objectStoreNames.contains('system_changelog')) {
        db.createObjectStore('system_changelog', { keyPath: 'event_id' });
      }
    };

    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Generické CRUD ────────────────────────────────────────────
async function dbPut(store, record) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror    = e  => reject(e.target.error);
  });
}

async function dbGet(store, key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGetAll(store, indexName, value) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const os  = tx.objectStore(store);
    const req = (indexName && value !== undefined)
      ? os.index(indexName).getAll(value)
      : os.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbDelete(store, key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror    = e  => reject(e.target.error);
  });
}

// ── Meta helpers ──────────────────────────────────────────────
async function getMeta(key) {
  const r = await dbGet('meta', key);
  return r ? r.value : null;
}
async function setMeta(key, value) {
  await dbPut('meta', { key, value });
}

// ── Main KB helpers ───────────────────────────────────────────

// Všetky záznamy (voliteľne filtrované podľa category)
async function getAllEntries(category) {
  if (category) {
    return dbGetAll('main_kb', 'category', category);
  }
  return dbGetAll('main_kb');
}

// Jeden záznam podľa record_id
async function getEntry(recordId) {
  return dbGet('main_kb', recordId);
}

// Upsert záznamu (vytvor alebo aktualizuj podľa updated_at)
async function upsertEntry(record) {
  if (!record.record_id) return false;
  const existing = await getEntry(record.record_id);
  if (existing) {
    const existDt = new Date(existing.updated_at || 0);
    const newDt   = new Date(record.updated_at   || 0);
    if (newDt < existDt) return false; // existujúci je novší
  }
  await dbPut('main_kb', record);
  return true;
}

// ── CLOUD SYNC ────────────────────────────────────────────────

// Stiahni MAIN_KB z Drive a upsertni do lokálnej cache
async function syncWithCloud() {
  try {
    const response = await fetch(CONFIG.GAS_URL, {
      method: 'GET',
      cache:  'no-store'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data    = await response.json();
    const entries = data.entries || [];

    let synced = 0, skipped = 0;
    for (const record of entries) {
      // Normalizuj record_id
      if (!record.record_id && record.entry_id) record.record_id = record.entry_id;
      if (!record.entry_id  && record.record_id) record.entry_id = record.record_id;
      // Urči category ak chýba
      if (!record.category) record.category = CONFIG.getCategoryFromRecord(record);

      const wasUpdated = await upsertEntry({ ...record, synced: true });
      if (wasUpdated) synced++; else skipped++;
    }

    await setMeta('last_cloud_sync', new Date().toISOString());
    await setMeta('cloud_total',     entries.length);
    await setMeta('cloud_online',    true);

    return { ok: true, synced, skipped, total: entries.length };

  } catch (err) {
    await setMeta('cloud_online', false);
    console.warn('[DigiEDU] Cloud sync failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// Pošli jeden záznam na GAS (no-cors → opaque response)
async function pushToCloud(record) {
  try {
    await fetch(CONFIG.GAS_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(record)
    });
    // no-cors → nemôžeme prečítať odpoveď, predpokladáme úspech
    return true;
  } catch (err) {
    console.warn('[DigiEDU] Push to cloud failed:', err.message);
    return false;
  }
}

// ── PENDING SYNC QUEUE ────────────────────────────────────────

async function addToPendingQueue(record) {
  await dbPut('pending_sync', { ...record, pending_since: new Date().toISOString() });
}

async function getPendingRecords() {
  return dbGetAll('pending_sync');
}

async function removeFromPendingQueue(recordId) {
  await dbDelete('pending_sync', recordId);
}

async function getPendingCount() {
  const pending = await getPendingRecords();
  return pending.length;
}

// Pokús sa odoslať všetky pending záznamy
async function flushPendingQueue() {
  const pending = await getPendingRecords();
  if (!pending.length) return { flushed: 0 };

  let flushed = 0;
  for (const record of pending) {
    const ok = await pushToCloud(record);
    if (ok) {
      await removeFromPendingQueue(record.record_id);
      // Označ ako synced v main_kb
      const local = await getEntry(record.record_id);
      if (local) await dbPut('main_kb', { ...local, synced: true });
      flushed++;
    }
  }
  return { flushed, remaining: pending.length - flushed };
}

// ── COUNTERS ──────────────────────────────────────────────────

async function getCounters() {
  const all  = await getAllEntries();
  const result = {};

  for (const cat of CONFIG.CATEGORY_KEYS) {
    const entries = all.filter(e => e.category === cat);
    result[cat] = { total: entries.length, newSinceExport: 0 };
  }

  // WEB a EXTRA
  result.WEB   = { total: all.filter(e => e.category === 'WEB').length };
  result.EXTRA = { total: all.filter(e => e.category === 'EXTRA' || e.category === 'BRAIN').length };

  return result;
}

async function getTotalCasesCount() {
  const all = await getAllEntries();
  return all.filter(e => CONFIG.CATEGORY_KEYS.includes(e.category)).length;
}

// ── ID GENEROVANIE ────────────────────────────────────────────

async function generateNextId(cat) {
  const entries = await getAllEntries(cat);
  const prefix  = CONFIG.getRecordPrefix(cat);
  const num     = (entries.length + 1).toString().padStart(6, '0');
  return `${prefix}-${num}`;
}

// ── TAG DICTIONARY ────────────────────────────────────────────

async function getTagDict(cat) {
  return (await getMeta(`tag_dict_${cat}`)) || [];
}

async function mergeTagsToDict(cat, tags) {
  const current = await getTagDict(cat);
  const merged  = [...new Set([...current, ...(tags || [])])];
  await setMeta(`tag_dict_${cat}`, merged);
  return merged;
}

// ── VYHĽADÁVANIE ─────────────────────────────────────────────

async function searchKB(query, filters = {}) {
  const q       = (query || '').toLowerCase().trim();
  let   entries = await getAllEntries(filters.category || undefined);

  // Filtre
  if (filters.status) {
    entries = entries.filter(e => e.status === filters.status || e.case_status === filters.status);
  }
  if (!filters.includeWeb) {
    entries = entries.filter(e => e.category !== 'WEB');
  }
  if (!filters.includeExtra) {
    entries = entries.filter(e => e.category !== 'EXTRA' && e.category !== 'BRAIN');
  }

  if (!q) return entries;

  // Textové vyhľadávanie
  return entries.filter(e => {
    const searchable = [
      e.title, e.problem_summary, e.professional_article, e.layman_summary,
      e.original_problem_text, e.actual_fix, e.final_resolution, e.device_name,
      e.query, e.content, e.raw_summary,
      (e.tags      || []).join(' '),
      (e.keywords  || []).join(' '),
      (e.synonyms  || []).join(' '),
      (e.root_causes    || []).join(' '),
      (e.hotfixes       || []).join(' '),
      (e.what_helped    || []).join(' ')
    ].join(' ').toLowerCase();
    return searchable.includes(q);
  });
}

// ── KB KONTEXT PRE AI ─────────────────────────────────────────

async function getKBContextForAI(category, problemText, maxEntries = 5) {
  const entries = await getAllEntries(category);
  if (!entries.length) return '';

  const q      = (problemText || '').toLowerCase();
  const words  = q.split(/\s+/).filter(w => w.length > 3);
  const scored = entries.map(e => {
    const text = [e.original_problem_text, e.problem_summary,
                  (e.tags || []).join(' '), (e.keywords || []).join(' ')].join(' ').toLowerCase();
    let score  = 0;
    words.forEach(w => { if (text.includes(w)) score++; });
    return { e, score };
  }).sort((a, b) => b.score - a.score).slice(0, maxEntries);

  const relevant = scored.filter(s => s.score > 0 || entries.length <= 3).map(s => s.e);
  if (!relevant.length) return '';

  return relevant.map(e =>
    `[${e.record_id}] ${e.problem_summary || (e.original_problem_text || '').slice(0, 100)}\nRiešenie: ${e.actual_fix || e.final_resolution || 'N/A'}\nTagy: ${(e.tags || []).join(', ')}`
  ).join('\n---\n');
}

async function getExtraKBContext(problemText, maxEntries = 3) {
  const all    = await getAllEntries();
  const extras = all.filter(e => e.category === 'EXTRA' || e.category === 'BRAIN');
  if (!extras.length) return '';

  const q     = (problemText || '').toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 3);
  const scored = extras.map(e => {
    const text = [e.title, e.problem_summary, e.content,
                  (e.tags || []).join(' ')].join(' ').toLowerCase();
    let score  = 0;
    words.forEach(w => { if (text.includes(w)) score++; });
    return { e, score };
  }).sort((a, b) => b.score - a.score).slice(0, maxEntries);

  const relevant = scored.filter(s => s.score > 0);
  if (!relevant.length) return '';

  return relevant.map(e =>
    `[${e.record_id}] ${e.title || 'BRAIN'}: ${(e.problem_summary || e.content || '').slice(0, 300)}`
  ).join('\n---\n');
}

// ── WEB KB operácie ───────────────────────────────────────────

async function saveWebKBEntry(entry) {
  if (!entry.record_id) {
    entry.record_id = `WEB-RAW-${Date.now()}`;
    entry.entry_id  = entry.record_id;
  }
  entry.category = 'WEB';
  entry.synced   = false;
  await dbPut('main_kb', entry);
  return entry;
}

async function mergeWebEntry(existing, newContent, newSources, newTags) {
  const merged = { ...existing,
    content:    newContent || existing.content,
    raw_summary: newContent || existing.raw_summary,
    source_refs: [...new Set([...(existing.source_refs || []), ...newSources])],
    tags:        [...new Set([...(existing.tags || []), ...newTags])],
    updated_at:  new Date().toISOString()
  };
  await dbPut('main_kb', merged);
  return merged;
}

async function findSimilarWebEntry(queryText) {
  const all  = await getAllEntries('WEB');
  const q    = (queryText || '').toLowerCase();
  const qw   = q.split(/\s+/).filter(w => w.length > 4);
  if (!qw.length) return null;

  for (const e of all) {
    const ew    = ((e.query || e.raw_summary || e.content || '') + '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const overlap = qw.filter(w => ew.includes(w)).length;
    const ratio   = overlap / Math.max(qw.length, 1);
    if (ratio >= (CONFIG.WEB_DEDUP_THRESHOLD || 0.45)) return e;
  }
  return null;
}

async function searchWebKB(queryText, category) {
  const all  = await getAllEntries('WEB');
  const q    = (queryText || '').toLowerCase();
  const now  = Date.now();
  const maxAge = (CONFIG.WEB_KB_MAX_AGE_DAYS || 30) * 86400000;

  const words  = q.split(/\s+/).filter(w => w.length > 3);
  const scored = all
    .filter(e => !e.created_at || (now - new Date(e.created_at).getTime()) < maxAge)
    .map(e => {
      const text  = [e.query, e.content, e.raw_summary, e.device, (e.tags || []).join(' ')].join(' ').toLowerCase();
      let   score = 0;
      words.forEach(w => { if (text.includes(w)) score++; });
      return { e, score };
    })
    .filter(s => s.score >= (CONFIG.WEB_KB_MIN_SCORE || 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return null;

  return scored.map(s => {
    const e = s.e;
    return `[WEB – ${(e.created_at || '').slice(0, 10)}]\nDotaz: ${e.query || ''}\n${e.content || e.raw_summary || ''}`;
  }).join('\n\n---\n\n');
}

async function getWebKBCount() {
  return (await getAllEntries('WEB')).length;
}

async function getWebNewCount() {
  return (await getMeta('new_count_WEB')) || 0;
}
async function incrementWebNewCount() {
  const n = await getWebNewCount(); await setMeta('new_count_WEB', n + 1); return n + 1;
}
async function resetWebNewCount() {
  await setMeta('new_count_WEB', 0);
  await setMeta('last_export_WEB', new Date().toISOString());
}
async function getWebLastExport() { return getMeta('last_export_WEB'); }

// ── TOPIC COVERAGE ────────────────────────────────────────────

async function getKBWeight() {
  const total = await getTotalCasesCount();
  if (total < CONFIG.KB_REGIME_MID) return CONFIG.KB_WEIGHT_MIN;
  if (total < CONFIG.KB_REGIME_MAX) return CONFIG.KB_WEIGHT_MID;
  return CONFIG.KB_WEIGHT_MAX;
}

async function getKBRegimeLabel() {
  const total = await getTotalCasesCount();
  if (total < CONFIG.KB_REGIME_MID)
    return `Discovery (${total}/${CONFIG.KB_REGIME_MID}) – ${Math.round(CONFIG.KB_WEIGHT_MIN * 100)}% KB`;
  if (total < CONFIG.KB_REGIME_MAX)
    return `Stabilizing (${total}/${CONFIG.KB_REGIME_MAX}) – ${Math.round(CONFIG.KB_WEIGHT_MID * 100)}% KB`;
  return `Saturated (${total}) – ${Math.round(CONFIG.KB_WEIGHT_MAX * 100)}% KB`;
}

// ── SEED DEMO DÁTA ───────────────────────────────────────────

async function seedDemoKBIfEmpty() {
  const all = await getAllEntries();
  if (all.length > 0) return;

  const now  = new Date().toISOString();
  const seed = {
    record_id: 'HW-000001', entry_id: 'HW-000001',
    kb_set: 'DigiEDU_ServiceDesk_HW_KB', category: 'HW',
    record_type: 'issue_resolution', status: 'approved', case_status: 'resolved',
    version: '1.0.0', language: 'sk',
    title: 'Notebook neaktivuje USB-C dokovaciu stanicu – externé monitory ostanú čierne',
    problem_summary: 'Notebook sa pripojí k dokovacej stanici, napájanie funguje, ale externé monitory sa nezobrazia.',
    professional_article: 'Najprv over, či ide o plnohodnotné USB-C pripojenie s podporou napájania aj video režimu. Skontroluj, či dok aj notebook používajú podporovaný kábel. V Správcovi zariadení over grafický adaptér, USB radič a Thunderbolt/USB-C controller. Následne aktualizuj firmware docku, BIOS notebooku a grafický ovládač v odporúčanom poradí: BIOS, chipset, grafika, dock firmware. Ak sa monitory stále neprebudia, nastav detekciu zobrazení a otestuj každý monitor samostatne. Laicky: dokovačka notebook nabíja, ale video časť sa neprebudí. Najčastejšie pomôže správny kábel, update ovládačov alebo nový štart docku.',
    layman_summary: 'Dokovačka notebook nabíja, ale video časť sa neprebudí. Zvyčajne pomôže správny kábel alebo update ovládačov.',
    root_causes: ['Použitý USB-C kábel nepodporuje video prenos.', 'Zastaraný BIOS, chipset driver alebo firmware.', 'Grafický adaptér po prebudení nesprávne reinicializuje výstupy.'],
    diagnostic_questions: ['Fungujú monitory po pripojení k inému notebooku?', 'Zobrazí sa dock v Správcovi zariadení?', 'Začal problém po aktualizácii systému?'],
    hotfixes: ['Odpoj dock od napájania na 30 sek, potom pripoj nanovo.', 'Vymeň USB-C kábel za certifikovaný.', 'Win+Ctrl+Shift+B – reset grafického subsystému.'],
    generated_user_questions: ['Prečo nejdú monitory cez dokovačku?', 'Dokovačka nabíja ale monitor je čierny – čo s tým?', 'Môže byť chyba v kábli?'],
    generated_answers: ['Otestuj iný certifikovaný USB-C kábel.', 'Aktualizuj BIOS a grafický ovládač.', 'Ak problém ostáva len na jednom notebooku, ide o lokálnu chybu.'],
    faq_items: [
      { question: 'Je dokovačka pokazená, keď nabíja ale neprenáša obraz?', answer: 'Nie vždy – nabíjanie a video sú odlišné vrstvy komunikácie.' },
      { question: 'V akom poradí robiť aktualizácie?', answer: 'BIOS a chipset → grafický ovládač → firmware docku.' },
      { question: 'Prečo nastáva problém po uspávaní?', answer: 'Niektoré zariadenia po prebudení nesprávne obnovia video linky cez USB-C.' },
      { question: 'Má zmysel skúsiť iný monitor?', answer: 'Áno, pomôže odlíšiť chybu docku od problému monitora.' },
      { question: 'Kedy eskalovať?', answer: 'Ak problém pretrváva s viacerými káblami a monitormi po aktualizáciách.' }
    ],
    tags: ['hw', 'dokovacia-stanica', 'usb-c', 'monitor', 'video-vystup', 'notebook', 'servis'],
    keywords: ['dock nefunguje', 'externy monitor cierny', 'usb c dok', 'displayport alt mode'],
    synonyms: ['dokovačka', 'dock', 'usb c hub', 'replikátor portov'],
    related_kb_sets: ['DigiEDU_ServiceDesk_BRAIN_KB'],
    related_record_ids: [],
    priority: 'high', audience: ['user', 'technician'],
    escalation_to: [], fallback_to: ['DigiEDU_ServiceDesk_INE_KB'],
    source_type: 'manual_case', source_refs: [],
    confidence_score: 0.92,
    created_at: now, updated_at: now, last_reviewed_at: now,
    change_note: 'Seed ukážkový záznam',
    device_name: 'Notebook + USB-C dok',
    actual_fix: 'Výmena USB-C kábla za certifikovaný vyriešila problém.',
    synced: false
  };

  await dbPut('main_kb', seed);
  console.log('[DigiEDU] Demo seed záznam vytvorený');
}

// ── FIND RELATED ──────────────────────────────────────────────

async function findRelatedKBEntries(entry, maxResults = 5) {
  const cat     = entry.category;
  const entries = await getAllEntries(cat);
  const q       = (entry.problem_summary || entry.title || '').toLowerCase();
  const words   = q.split(/\s+/).filter(w => w.length > 3);

  return entries
    .filter(e => e.record_id !== entry.record_id)
    .map(e => {
      const text  = (e.problem_summary || e.title || '').toLowerCase();
      let   score = 0;
      words.forEach(w => { if (text.includes(w)) score++; });
      return { e, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.e);
}

async function loadRelatedRecords(entry) {
  const related = [];
  for (const rid of (entry.related_record_ids || [])) {
    const rec = await getEntry(rid);
    if (rec) related.push(rec);
  }
  return related;
}

// ── Legacy alias pre priamy prístup k stores ─────────────────
// Unified KB stores (HW, 365 atď.) mapujú na main_kb
async function dbGetAll(store) {
  const unifiedStores = new Set(['HW','365','WIFI','ADMIN','OTHER','WEB','EXTRA','BRAIN']);
  if (unifiedStores.has(store)) {
    return getAllEntries(store);
  }
  // Ostatné stores (meta, pending_sync, ...) – priamy prístup
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

// Priamy prístup k main_kb store (bez mapovania)
async function dbGetAll_impl(store) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}
