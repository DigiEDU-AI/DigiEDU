// ============================================================
// DigiEDU – kb.js v3.0  |  Cloud-First KB operácie
// ============================================================

// ── Uloženie KB záznamu (lokálne + cloud) ────────────────────

async function saveKBEntry(caseState, aiKBData) {
  const cat = caseState.category;
  const now = new Date().toISOString();
  const ks  = CONFIG.KB_SETS[cat] || {};

  const helped = (caseState.quickTips || []).filter(t => t.state === 'helped').map(t => t.tip);
  const failed = (caseState.quickTips || []).filter(t => t.state === 'failed').map(t => t.tip);
  const tested = (caseState.quickTips || []).filter(t => t.state !== 'untested').map(t => t.tip);

  const kbStatus   = caseState.status === 'resolved' ? 'approved' : 'staging';
  const kbPriority = aiKBData.priority || (caseState.status === 'escalated' ? 'high' : 'medium');

  const entry = {
    // ── Identifikácia ──────────────────────────────────────
    record_id:   caseState.id,
    entry_id:    caseState.id,
    kb_set:      ks.folder || `DigiEDU_ServiceDesk_${cat}_KB`,
    category:    cat,
    record_type: 'issue_resolution',
    status:      kbStatus,
    case_status: caseState.status,
    version:     '1.0.0',
    language:    'sk',
    synced:      false,   // označí sa po úspešnom odoslaní na cloud

    // ── Obsah ─────────────────────────────────────────────
    title:                    aiKBData.title || `${cat} – ${caseState.device?.name || 'prípad'}`,
    problem_summary:          aiKBData.problem_summary || '',
    professional_article:     aiKBData.professional_article || '',
    layman_summary:           aiKBData.layman_summary || '',
    root_causes:              ensureArray(aiKBData.root_causes, 3),
    diagnostic_questions:     ensureArray(aiKBData.diagnostic_questions, 3),
    hotfixes:                 ensureArray(aiKBData.hotfixes, 3),
    generated_user_questions: ensureArray(aiKBData.generated_user_questions, 3),
    generated_answers:        ensureArray(aiKBData.generated_answers, 3),
    faq_items:                ensureFaqItems(aiKBData.faq_items, aiKBData.chatbot_qa_set_1, 5),

    // ── Metadáta ──────────────────────────────────────────
    tags:               ensureArray(aiKBData.tags, 5),
    keywords:           ensureArray(aiKBData.keywords, 5),
    synonyms:           ensureArray(aiKBData.synonyms, 3),
    related_kb_sets:    aiKBData.related_kb_sets    || ['DigiEDU_ServiceDesk_BRAIN_KB'],
    related_record_ids: aiKBData.related_record_ids || [],
    priority:           kbPriority,
    audience:           ['user', 'technician'],
    escalation_to:      caseState.status === 'escalated' ? [ks.folder || cat] : [],
    fallback_to:        ['DigiEDU_ServiceDesk_INE_KB', 'DigiEDU_ServiceDesk_WEB_KB'],
    source_type:        'manual_case',
    source_refs:        [],
    confidence_score:   aiKBData.confidence_score || 0.7,

    // ── Časové údaje ───────────────────────────────────────
    created_at:       caseState.createdAt,
    updated_at:       now,
    last_reviewed_at: now,
    change_note:      aiKBData.change_note || 'Záznam vytvorený z prípadu',

    // ── Prípad dáta ────────────────────────────────────────
    case_hash:     generateHash(caseState.problemText + caseState.id),
    closed_at:     now,
    device_name:   caseState.device?.name || '',
    device_info:   caseState.device ? {
      model: caseState.device.name || '', pn: caseState.device.pn || '',
      description: caseState.device.description || ''
    } : {},
    original_problem_text: caseState.problemText,
    quick_tips:            caseState.quickTips || [],
    what_was_tested:       tested,
    what_failed:           failed,
    what_helped:           helped,
    actual_fix:            caseState.actualFix || '',
    final_resolution:      caseState.actualFix || caseState.finalNote || '',
    escalation_reason:     caseState.status === 'escalated' ? (caseState.actualFix || '') : '',
    new_information_from_technician: caseState.techNotes ? [caseState.techNotes] : []
  };

  // 1. Ulož lokálne (IndexedDB)
  await dbPut('main_kb', entry);
  await mergeTagsToDict(cat, entry.tags);
  if (entry.keywords?.length) await mergeTagsToDict(cat, entry.keywords);

  // 2. Odošli na cloud (optimisticky, no-cors)
  const cloudOk = await pushToCloud(entry);

  if (cloudOk) {
    // Označ ako synced
    await dbPut('main_kb', { ...entry, synced: true });
    showToast('✅ Prípad uzavretý a odosielaný do cloudu', 'success', 3500);
  } else {
    // Pridaj do pending queue
    await addToPendingQueue(entry);
    showToast('✅ Prípad uzavretý · ⚠️ Offline – čaká na sync', 'warning', 5000);
  }

  // 3. Aktualizuj pending badge
  if (typeof updatePendingBadge === 'function') updatePendingBadge();

  return entry;
}

// ── EXPORT MAIN_KB (lokálna záloha) ──────────────────────────

async function exportMainKB() {
  const all = await dbGetAll_impl ? await dbGetAll_impl('main_kb') : await getAllEntries();

  const mainKB = {
    _type:       'MAIN_KB',
    version:     '1.0',
    exported_at: new Date().toISOString(),
    source:      'DigiEDU_AI_Assistant',
    description: 'Kompletná Knowledge Base – všetky kategórie v jednom súbore',
    stats: {
      total: all.length,
      by_category: {}
    },
    entries: all
  };

  // Stats
  for (const cat of [...CONFIG.CATEGORY_KEYS, 'WEB', 'EXTRA', 'BRAIN']) {
    const count = all.filter(e => e.category === cat).length;
    if (count > 0) mainKB.stats.by_category[cat] = count;
  }

  const blob  = new Blob([JSON.stringify(mainKB, null, 2)], { type: 'application/json' });
  const fname = `MAIN_KB_${new Date().toISOString().slice(0, 10)}.json`;
  triggerDownload(blob, fname);
  return { total: all.length, fname };
}

// ── EXPORT ZIP (záloha Drive štruktúra) ──────────────────────

async function backupAllDBs() {
  if (typeof JSZip === 'undefined') {
    showToast('JSZip sa nenačítal – skúste obnoviť stránku', 'error');
    throw new Error('JSZip not loaded');
  }

  const zip   = new JSZip();
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const all   = await getAllEntries();

  // Roztrieď podľa kategórie
  const byCategory = {};
  for (const e of all) {
    const cat = e.category || 'OTHER';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(e);
  }

  // MAIN_KB.json – kompletný súbor
  const mainKBData = {
    _type: 'MAIN_KB', version: '1.0',
    exported_at: now.toISOString(),
    entries: all
  };
  zip.file('MAIN_KB.json', JSON.stringify(mainKBData, null, 2));

  // KB_DataSET štruktúra
  const KB_FOLDER_MAP = {
    HW:    'DigiEDU_ServiceDesk_HW_KB',
    '365': 'DigiEDU_ServiceDesk_365_KB',
    WIFI:  'DigiEDU_ServiceDesk_WIFI_KB',
    ADMIN: 'DigiEDU_ServiceDesk_ADMIN_KB',
    OTHER: 'DigiEDU_ServiceDesk_INE_KB',
    WEB:   'DigiEDU_ServiceDesk_WEB_KB',
    EXTRA: 'DigiEDU_ServiceDesk_BRAIN_KB',
    BRAIN: 'DigiEDU_ServiceDesk_BRAIN_KB'
  };

  for (const [cat, entries] of Object.entries(byCategory)) {
    const folder = KB_FOLDER_MAP[cat] || `DigiEDU_ServiceDesk_${cat}_KB`;
    const kbFolder = zip.folder('KB_DataSET').folder(folder);
    kbFolder.file('records.jsonl', entries.map(e => JSON.stringify(e)).join('\n'));

    // faq.jsonl
    const faqLines = entries.filter(e => e.faq_items?.length).map(e =>
      JSON.stringify({ record_id: e.record_id, faq_items: e.faq_items })
    );
    if (faqLines.length) kbFolder.file('faq.jsonl', faqLines.join('\n'));

    // markdown_views
    const mdFolder = kbFolder.folder('markdown_views');
    for (const e of entries) {
      mdFolder.file(`${e.record_id}.md`, buildMarkdownView(e));
    }
  }

  // README
  zip.file('README.txt', `DigiEDU KB Záloha – ${today}\nCelkový počet záznamov: ${all.length}\nSúbory: MAIN_KB.json + KB_DataSET/ štruktúra`);

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  triggerDownload(zipBlob, `DigiEDU_KB_Backup_${today}.zip`);
  return all.length;
}

// ── MARKDOWN VIEW ─────────────────────────────────────────────

function buildMarkdownView(entry) {
  const lines = [`# ${entry.title || entry.record_id}`, ''];
  lines.push(`**ID:** ${entry.record_id} | **Kategória:** ${entry.category} | **Stav:** ${entry.status} | **Priorita:** ${entry.priority || '—'}`);
  lines.push('');
  if (entry.problem_summary) { lines.push('## Popis problému'); lines.push(entry.problem_summary); lines.push(''); }
  if (entry.professional_article) { lines.push('## Profesionálny článok'); lines.push(entry.professional_article); lines.push(''); }
  if (entry.layman_summary) { lines.push('## Laické zhrnutie'); lines.push(entry.layman_summary); lines.push(''); }
  if (entry.root_causes?.length) { lines.push('## Root Causes'); entry.root_causes.forEach((c, i) => lines.push(`${i+1}. ${c}`)); lines.push(''); }
  if (entry.hotfixes?.length) { lines.push('## Hotfixy'); entry.hotfixes.forEach((h, i) => lines.push(`${i+1}. ${h}`)); lines.push(''); }
  if (entry.faq_items?.length) {
    lines.push('## FAQ');
    entry.faq_items.forEach(f => { lines.push(`**Q:** ${f.question}`); lines.push(`**A:** ${f.answer}`); lines.push(''); });
  }
  if (entry.actual_fix) { lines.push('## Reálne riešenie'); lines.push(entry.actual_fix); lines.push(''); }
  lines.push('---');
  lines.push(`*${entry.created_at || '—'} | v${entry.version || '1.0.0'}*`);
  return lines.join('\n');
}

// ── IMPORT (z exportovaného MAIN_KB.json) ────────────────────

async function importKBFile(file) {
  const text = await readFileAsText(file);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Neplatný JSON súbor');
  }

  // Rozpoznaj formát
  const entries = data.entries || (Array.isArray(data) ? data : [data]);
  let imported = 0, merged = 0, skipped = 0;

  for (let rec of entries) {
    if (!rec.record_id && rec.entry_id) rec.record_id = rec.entry_id;
    if (!rec.record_id) { skipped++; continue; }
    if (!rec.entry_id) rec.entry_id = rec.record_id;
    if (!rec.category) rec.category = CONFIG.getCategoryFromRecord(rec);

    const existing = await getEntry(rec.record_id);
    if (existing) {
      const existDt = new Date(existing.updated_at || 0);
      const newDt   = new Date(rec.updated_at || 0);
      if (newDt >= existDt) {
        await dbPut('main_kb', { ...rec, synced: false });
        merged++;
      } else skipped++;
    } else {
      await dbPut('main_kb', { ...rec, synced: false });
      if (rec.tags?.length) await mergeTagsToDict(rec.category, rec.tags);
      imported++;
    }
  }

  return { imported, merged, skipped, total: entries.length, category: 'MAIN_KB' };
}

// Import súborov – deleguje na importKBFile
async function processKBImport(data) {
  const entries = data.entries || [];
  let imported = 0, skipped = 0;
  for (let rec of entries) {
    if (!rec.record_id) { skipped++; continue; }
    if (!rec.category) rec.category = CONFIG.getCategoryFromRecord(rec);
    await dbPut('main_kb', { ...rec, synced: false });
    imported++;
  }
  return { imported, skipped, total: entries.length };
}

// ── VYHĽADÁVANIE ──────────────────────────────────────────────

async function showKBDetail(entryId) {
  const entry = await getEntry(entryId);
  if (!entry) { showToast('Záznam nebol nájdený', 'warning'); return; }

  const modal = document.getElementById('modal-kb-detail');
  const body  = document.getElementById('kb-detail-body');
  if (!body) return;

  const helped = (entry.what_helped || []).map(h => `<li>✅ ${escapeHtml(h)}</li>`).join('');
  const failed = (entry.what_failed || []).map(f => `<li>❌ ${escapeHtml(f)}</li>`).join('');
  const faqHtml = (entry.faq_items || []).map(f =>
    `<div class="qa-pair"><strong>Q:</strong> ${escapeHtml(f.question || f.q || '')}<br><strong>A:</strong> ${escapeHtml(f.answer || f.a || '')}</div>`
  ).join('');

  const syncBadge = entry.synced === false
    ? '<span style="color:var(--accent-yellow);font-size:11px;">⚠️ Čaká na cloud sync</span>'
    : '<span style="color:var(--accent-green);font-size:11px;">✅ Synced</span>';

  body.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      <span class="case-id-badge">${escapeHtml(entry.record_id)}</span>
      <span style="color:var(--text-muted);font-size:12px;">${entry.category} · v${entry.version || '1.0.0'} · ${entry.status}</span>
      ${syncBadge}
    </div>
    <h3 style="margin-bottom:8px;">${escapeHtml(entry.title || '')}</h3>
    <p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(entry.problem_summary || '')}</p>
    ${entry.professional_article ? `<div class="form-section"><h4>Profesionálny článok</h4><p style="line-height:1.7;font-size:13px;">${escapeHtml(entry.professional_article)}</p></div>` : ''}
    ${entry.actual_fix ? `<div class="form-section"><h4>✅ Reálne riešenie</h4><p>${escapeHtml(entry.actual_fix)}</p></div>` : ''}
    ${helped || failed ? `<div class="form-section"><h4>Quick tipy</h4><ul>${helped}${failed}</ul></div>` : ''}
    ${faqHtml ? `<div class="form-section"><h4>FAQ</h4>${faqHtml}</div>` : ''}
    <div class="result-tags" style="margin-top:12px;">
      ${(entry.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
    </div>
    <div style="margin-top:12px;font-size:11px;color:var(--text-dim);">
      Vytvorené: ${formatDate(entry.created_at)} · Zariadenie: ${escapeHtml(entry.device_name || '—')}
    </div>
  `;
  showModal('modal-kb-detail');
}

// ── HANDOFF ───────────────────────────────────────────────────

function buildHandoffText(cs) {
  return [
    '=== DigiEDU AI Helpdesk – Handoff ===', '',
    `ID: ${cs.id} | Kategória: ${cs.category}`,
    cs.device ? `Zariadenie: ${cs.device.name} (P/N: ${cs.device.pn})` : '',
    `Dátum: ${new Date().toLocaleDateString('sk-SK')}`, '',
    '--- PROBLÉM ---', cs.problemText || '', '',
    '--- PRVÁ ANALÝZA ---', cs.round1Output?.analysis?.most_likely || '', '',
    '--- QUICK TIPY ---',
    ...(cs.quickTips || []).map(t => `${t.state === 'helped' ? '✅' : t.state === 'failed' ? '❌' : '○'} ${t.tip}`), '',
    '--- NOVÉ INFO ---', cs.techNotes || 'Žiadne', '',
    '--- DRUHÁ ANALÝZA ---', cs.round2Output?.refined_analysis || '', '',
    '=== Vložte tento text do zvolenej AI služby ==='
  ].filter(l => l !== null && l !== undefined).join('\n');
}

// ── UTILITY ───────────────────────────────────────────────────

function generateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = (hash << 5) - hash + c; hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function ensureArray(arr, minItems) {
  if (!Array.isArray(arr)) return new Array(minItems).fill('—');
  while (arr.length < minItems) arr.push('—');
  return arr.slice(0, Math.max(minItems, arr.length));
}

function ensureFaqItems(faqItems, legacyQA, count) {
  if (Array.isArray(faqItems) && faqItems.length > 0 && faqItems[0]?.question) {
    while (faqItems.length < count) faqItems.push({ question: '—', answer: '—' });
    return faqItems.slice(0, count);
  }
  if (Array.isArray(legacyQA) && legacyQA.length > 0) {
    const c = legacyQA.map(qa => ({ question: qa.q || qa.question || '—', answer: qa.a || qa.answer || '—' }));
    while (c.length < count) c.push({ question: '—', answer: '—' });
    return c.slice(0, count);
  }
  return new Array(count).fill(null).map(() => ({ question: '—', answer: '—' }));
}

function normalizeKBEntry(entry) {
  if (!entry) return entry;
  if (entry.record_id && !entry.entry_id) entry.entry_id = entry.record_id;
  if (entry.entry_id  && !entry.record_id) entry.record_id = entry.entry_id;
  if (!entry.category) entry.category = CONFIG.getCategoryFromRecord(entry);
  return entry;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Chyba čítania'));
    reader.readAsText(file);
  });
}

// Zachované pre kompatibilitu
async function exportUpdateFile(cat) {
  const entries = await getAllEntries(cat);
  if (!entries.length) return null;
  return new Blob([entries.map(e => JSON.stringify(e)).join('\n')], { type: 'application/json' });
}

function buildExportFilename(cat) {
  return `${cat}_records_${new Date().toISOString().slice(0,10)}.jsonl`;
}

async function exportWebKBFile(entries) {
  if (!entries?.length) return null;
  return new Blob([entries.map(e => JSON.stringify(e)).join('\n')], { type: 'application/json' });
}

function buildWebExportFilename() {
  return `WEB_KB_${new Date().toISOString().slice(0,10)}.jsonl`;
}

async function importWebKBFile(file) {
  return importKBFile(file);
}

async function importExtraKBFile(file) {
  return importKBFile(file);
}
