// ============================================================
// DigiEDU AI Assistant – app.js v3.0
// Cloud-First workflow
// ============================================================

let APP = {
  currentCase:   null,
  currentScreen: 'screen-home'
};

function resetCase() {
  APP.currentCase = {
    id: null, category: null, device: null, problemText: '',
    createdAt: null, round1Output: null, round2Output: null,
    quickTips: [], techNotes: '', status: null,
    actualFix: '', finalNote: '', escalationReason: '', escalated: false
  };
}

// ── SHA-256 overenie hesla (SubtleCrypto API) ─────────────────
async function verifyAdminPassword(input) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === CONFIG.ADMIN_PASSWORD_HASH;
}

// ── Model prepínač ────────────────────────────────────────────
function setModel(modelKey, clickedBtn) {
  if (!CONFIG.MODELS[modelKey]) return;
  CONFIG.ACTIVE_MODEL = modelKey;
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.model === modelKey);
  });
  updateModelIndicators();
  updateGlobalCostBar();
  const m = CONFIG.MODELS[modelKey];
  showToast(`Model: ${m.label} | $${m.input}/M in · $${m.output}/M out`, 'info', 3000);
}

function updateModelIndicators() {
  const key   = CONFIG.ACTIVE_MODEL;
  const label = CONFIG.MODEL_LABEL;
  ['model-indicator-case', 'model-indicator-r1', 'model-indicator-r2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.className   = `model-indicator ${key}`;
  });
}

// ── Inicializácia ─────────────────────────────────────────────
async function initApp() {
  // 1. Otvor IndexedDB + seed demo
  try {
    await dbOpen();
    await seedDemoKBIfEmpty();
  } catch (err) {
    console.error('DB init zlyhala:', err);
    showToast('Chyba databázy – skúste znovu', 'error');
  }

  // 2. UI setup
  try {
    renderDeviceDropdown();
    await updateHomeCounters();
    updateModelIndicators();
    updateGlobalCostBar();
    bindUIEvents();
  } catch (err) {
    console.error('UI init zlyhala:', err);
    showToast('Chyba inicializácie: ' + err.message, 'error');
  }

  showScreen('screen-home');

  // 3. Cloud sync NA POZADÍ (neblokuje UI)
  syncCloudBackground();
}

// Asynchrónny cloud sync – nevolá sa await, beží na pozadí
async function syncCloudBackground() {
  updateCloudIndicator('syncing');

  // Najprv odošli pending záznamy
  const pendingResult = await flushPendingQueue();
  if (pendingResult.flushed > 0) {
    await updatePendingBadge();
  }

  // Stiahni fresh dáta z Drive
  const result = await syncWithCloud();

  if (result.ok) {
    updateCloudIndicator('online');
    await updateHomeCounters();
    updateGlobalCostBar();
    if (result.synced > 0) {
      showToast(`☁️ Cloud sync: +${result.synced} nových záznamov`, 'success', 3500);
    }
  } else {
    updateCloudIndicator('offline');
    showToast('⚠️ Nepodarilo sa spojiť s cloudom. Pracujem v lokálnom režime.', 'warning', 5000);
  }

  await updatePendingBadge();
}

// ── Cloud indikátor v logo ────────────────────────────────────
function updateCloudIndicator(state) {
  const dot = document.getElementById('cloud-sync-dot');
  if (!dot) return;
  dot.className = `cloud-sync-dot ${state}`;
  dot.title = {
    online:  '☁️ Cloud sync OK',
    offline: '⚠️ Offline – lokálna cache',
    syncing: '🔄 Synchronizujem...'
  }[state] || '';
}

// ── Pending badge ─────────────────────────────────────────────
async function updatePendingBadge() {
  const count  = await getPendingCount();
  const badge  = document.getElementById('pending-sync-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `${count} čaká na sync`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Home counters ─────────────────────────────────────────────
async function updateHomeCounters() {
  const counters = await getCounters();
  CONFIG.CATEGORY_KEYS.forEach(cat => {
    const c       = counters[cat] || {};
    const totalEl = document.getElementById(`counter-total-${cat}`);
    const newEl   = document.getElementById(`counter-new-${cat}`);
    if (totalEl) totalEl.textContent = c.total || 0;
    if (newEl)   newEl.textContent   = '';
  });

  // WEB badge
  const webCount = (counters.WEB || {}).total || 0;
  const webEl    = document.getElementById('counter-web-kb');
  if (webEl) {
    webEl.innerHTML     = `🌐 ${webCount} WEB záznamov`;
    webEl.style.display = webCount > 0 ? 'block' : 'none';
  }
}

// ── Admin heslo – SHA-256 verify ─────────────────────────────
async function requireAdminPassword(onSuccess) {
  const pwdInput    = document.getElementById('admin-password-input');
  const pwdError    = document.getElementById('admin-password-error');
  const confirmBtn  = document.getElementById('admin-password-confirm');

  if (pwdInput)  pwdInput.value = '';
  if (pwdError)  pwdError.textContent = '';
  showModal('modal-admin-password');

  async function handleConfirm() {
    const val = (pwdInput?.value || '').trim();
    const ok  = await verifyAdminPassword(val);
    if (ok) {
      hideAllModals();
      confirmBtn.removeEventListener('click', handleConfirm);
      onSuccess();
    } else {
      if (pwdError) pwdError.textContent = 'Nesprávne heslo';
      if (pwdInput) { pwdInput.value = ''; pwdInput.focus(); }
    }
  }

  if (confirmBtn) {
    confirmBtn.removeEventListener('click', handleConfirm);
    confirmBtn.addEventListener('click', handleConfirm);
  }
  if (pwdInput) {
    pwdInput.addEventListener('keydown', function h(e) {
      if (e.key === 'Enter')  handleConfirm();
      if (e.key === 'Escape') { hideAllModals(); pwdInput.removeEventListener('keydown', h); }
    });
  }
}

// ── Admin panel – populate + save ─────────────────────────────
function populateAdminScreen() {
  const modelSel = document.getElementById('admin-model-select');
  if (modelSel) modelSel.value = CONFIG.ACTIVE_MODEL;
  const limEnabled = document.getElementById('admin-limits-enabled');
  if (limEnabled) limEnabled.checked = CONFIG.MAX_COST_ENABLED;
  const fields = {
    'admin-limit-r1': CONFIG.COST_LIMITS.round1, 'admin-limit-r2': CONFIG.COST_LIMITS.round2,
    'admin-limit-grammar': CONFIG.COST_LIMITS.grammar, 'admin-limit-kb': CONFIG.COST_LIMITS.kb_gen,
    'admin-limit-web': CONFIG.COST_LIMITS.web_search,
    'admin-kb-min': CONFIG.KB_WEIGHT_MIN, 'admin-kb-mid': CONFIG.KB_WEIGHT_MID, 'admin-kb-max': CONFIG.KB_WEIGHT_MAX
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id); if (el) el.value = val;
  });
  const apiKeyEl = document.getElementById('admin-api-key');
  if (apiKeyEl) apiKeyEl.value = '';  // nezobrazuj existujúci kľúč
  getKBRegimeLabel().then(label => {
    const el = document.getElementById('admin-regime-label');
    if (el) el.textContent = label;
  }).catch(() => {});
}

function saveAdminSettings() {
  const modelSel = document.getElementById('admin-model-select');
  if (modelSel && CONFIG.MODELS[modelSel.value]) {
    CONFIG.ACTIVE_MODEL = modelSel.value;
    document.querySelectorAll('.model-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.model === CONFIG.ACTIVE_MODEL));
  }
  const limEnabled = document.getElementById('admin-limits-enabled');
  if (limEnabled) CONFIG.MAX_COST_ENABLED = limEnabled.checked;

  const costMap = {
    'admin-limit-r1': 'round1', 'admin-limit-r2': 'round2',
    'admin-limit-grammar': 'grammar', 'admin-limit-kb': 'kb_gen', 'admin-limit-web': 'web_search'
  };
  Object.entries(costMap).forEach(([id, key]) => {
    const v = parseFloat(document.getElementById(id)?.value);
    if (!isNaN(v)) CONFIG.COST_LIMITS[key] = v;
  });
  const kbMap = { 'admin-kb-min': 'KB_WEIGHT_MIN', 'admin-kb-mid': 'KB_WEIGHT_MID', 'admin-kb-max': 'KB_WEIGHT_MAX' };
  Object.entries(kbMap).forEach(([id, key]) => {
    const v = parseFloat(document.getElementById(id)?.value);
    if (!isNaN(v)) CONFIG[key] = v;
  });
  const apiKey = document.getElementById('admin-api-key')?.value?.trim();
  if (apiKey?.startsWith('sk-ant-')) CONFIG.API_KEY = apiKey;

  updateModelIndicators();
  updateGlobalCostBar();
  showToast('✅ Nastavenia uložené', 'success', 3000);
  showScreen('screen-home');
}

// ── Export MAIN_KB (admin) ────────────────────────────────────
async function handleAdminExportMainKB() {
  showLoading('Exportujem MAIN_KB...');
  try {
    const { total, fname } = await exportMainKB();
    hideLoading();
    showToast(`✅ MAIN_KB exportovaný – ${total} záznamov → ${fname}`, 'success', 5000);
  } catch (err) {
    hideLoading();
    showToast('Chyba exportu: ' + err.message, 'error');
  }
}

// ── Export ZIP záloha ─────────────────────────────────────────
async function handleExportKB() {
  const scope = document.getElementById('export-scope-select')?.value || 'all';
  showLoading('Exportujem KB zálohu...');
  try {
    const count = await backupAllDBs();
    hideLoading(); hideAllModals();
    showToast(`✅ ZIP záloha – ${count} záznamov`, 'success', 5000);
  } catch (err) {
    hideLoading();
    showToast('Chyba exportu: ' + err.message, 'error');
  }
}

// ── Import KB ─────────────────────────────────────────────────
async function handleImportKB() {
  const fileInput = document.getElementById('import-file-input');
  const files     = fileInput?.files;
  if (!files?.length) { showToast('Vyberte súbor', 'warning'); return; }

  showLoading('Importujem KB...');
  let totalImported = 0, totalMerged = 0, totalSkipped = 0;

  for (const file of files) {
    try {
      const result = await importKBFile(file);
      totalImported += result.imported;
      totalMerged   += (result.merged || 0);
      totalSkipped  += result.skipped;
    } catch (err) {
      showToast(`Chyba: ${file.name} – ${err.message}`, 'error');
    }
  }

  hideLoading();
  await updateHomeCounters();
  const statsEl = document.getElementById('import-result-stats');
  if (statsEl) {
    statsEl.style.display = 'block';
    statsEl.innerHTML = `✅ Import: <strong>${totalImported}</strong> nových · <strong>${totalMerged}</strong> aktualizovaných · <strong>${totalSkipped}</strong> preskočených`;
  }
  if (totalImported > 0) showToast(`Import: ${totalImported} záznamov`, 'success', 4000);
  fileInput.value = '';
}

// ── Manuálny cloud sync ───────────────────────────────────────
async function handleManualSync() {
  showToast('🔄 Spúšťam cloud sync...', 'info', 2000);
  await syncCloudBackground();
}

// ── Grammar preview ───────────────────────────────────────────
function showGrammarPreview(original, corrected) {
  return new Promise(resolve => {
    const origEl    = document.getElementById('grammar-original');
    const corrEl    = document.getElementById('grammar-corrected');
    const acceptBtn = document.getElementById('grammar-accept');
    const skipBtn   = document.getElementById('grammar-skip');
    if (!origEl || !corrEl || !acceptBtn || !skipBtn) { resolve(null); return; }
    origEl.textContent = original; corrEl.value = corrected;
    showModal('modal-grammar-preview');
    const cleanup  = () => { acceptBtn.removeEventListener('click', onAccept); skipBtn.removeEventListener('click', onSkip); hideModal('modal-grammar-preview'); };
    const onAccept = () => { cleanup(); resolve(corrEl.value.trim() || corrected); };
    const onSkip   = () => { cleanup(); resolve(null); };
    acceptBtn.addEventListener('click', onAccept);
    skipBtn.addEventListener('click', onSkip);
  });
}

// ── UI Event bindingy ─────────────────────────────────────────
function bindUIEvents() {
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => startCase(card.dataset.cat));
  });

  const searchBtn = document.getElementById('btn-search-kb');
  if (searchBtn) searchBtn.addEventListener('click', openSearch);

  const importBtn = document.getElementById('btn-import-kb');
  if (importBtn) importBtn.addEventListener('click', () => showModal('modal-import'));

  const exportBtn = document.getElementById('btn-export-kb');
  if (exportBtn) exportBtn.addEventListener('click', handleExportKB);

  const importConfirmBtn = document.getElementById('btn-import-confirm');
  if (importConfirmBtn) importConfirmBtn.addEventListener('click', handleImportKB);

  const syncBtn = document.getElementById('btn-manual-sync');
  if (syncBtn) syncBtn.addEventListener('click', handleManualSync);

  const round1Btn = document.getElementById('btn-round1');
  if (round1Btn) round1Btn.addEventListener('click', handleRound1);

  const caseCloseBtn1 = document.getElementById('btn-close-case-form');
  if (caseCloseBtn1) caseCloseBtn1.addEventListener('click', openCloseCase);

  const round2Btn = document.getElementById('btn-round2');
  if (round2Btn) round2Btn.addEventListener('click', handleRound2);

  const caseCloseBtn2 = document.getElementById('btn-close-case-r1');
  if (caseCloseBtn2) caseCloseBtn2.addEventListener('click', openCloseCase);

  const closeCaseBtn3 = document.getElementById('btn-close-case-r2');
  if (closeCaseBtn3) closeCaseBtn3.addEventListener('click', openCloseCase);

  const handoffBtn = document.getElementById('btn-handoff');
  if (handoffBtn) handoffBtn.addEventListener('click', openHandoff);

  const escalateBtn = document.getElementById('btn-escalate');
  if (escalateBtn) escalateBtn.addEventListener('click', handleEscalate);

  const confirmCloseBtn = document.getElementById('btn-confirm-close');
  if (confirmCloseBtn) confirmCloseBtn.addEventListener('click', confirmCloseCase);

  const homeBtn = document.getElementById('btn-back-home');
  if (homeBtn) homeBtn.addEventListener('click', goHome);

  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'screen-home';
      if (target === 'screen-home' && APP.currentCase?.id) {
        if (!confirm('Ste si istý? Prípad nebude uložený.')) return;
      }
      showScreen(target);
    });
  });

  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) hideAllModals(); });
  });
  document.querySelectorAll('.btn-modal-close').forEach(btn => {
    btn.addEventListener('click', () => hideAllModals());
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.addEventListener('input', debounce(handleSearch, 350));

  const searchCatFilter = document.getElementById('search-cat-filter');
  if (searchCatFilter) searchCatFilter.addEventListener('change', handleSearch);

  const searchStatusFilter = document.getElementById('search-status-filter');
  if (searchStatusFilter) searchStatusFilter.addEventListener('change', handleSearch);

  const searchExtraToggle = document.getElementById('search-extra-toggle');
  if (searchExtraToggle) searchExtraToggle.addEventListener('change', handleSearch);

  const searchWebToggle = document.getElementById('search-web-toggle');
  if (searchWebToggle) searchWebToggle.addEventListener('change', handleSearch);

  document.querySelectorAll('.handoff-service-btn').forEach(btn => {
    btn.addEventListener('click', () => openExternalAI(btn.dataset.service));
  });

  const statusSelect = document.getElementById('close-status-select');
  if (statusSelect) statusSelect.addEventListener('change', updateCloseCaseForm);

  // Admin
  const adminBtn = document.getElementById('btn-admin');
  if (adminBtn) adminBtn.addEventListener('click', () => {
    requireAdminPassword(() => { populateAdminScreen(); showScreen('screen-admin'); });
  });

  const adminBackBtn = document.getElementById('btn-admin-back');
  if (adminBackBtn) adminBackBtn.addEventListener('click', goHome);

  const adminSaveBtn = document.getElementById('btn-admin-save');
  if (adminSaveBtn) adminSaveBtn.addEventListener('click', saveAdminSettings);

  const adminExportBtn = document.getElementById('btn-admin-export-kb');
  if (adminExportBtn) adminExportBtn.addEventListener('click', handleAdminExportMainKB);

  const adminSyncBtn = document.getElementById('btn-admin-sync');
  if (adminSyncBtn) adminSyncBtn.addEventListener('click', async () => {
    showToast('🔄 Manuálny sync...', 'info', 2000);
    await syncCloudBackground();
    showToast('✅ Sync dokončený', 'success', 3000);
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideAllModals(); });

  const deviceSelect = document.getElementById('device-select');
  if (deviceSelect) {
    deviceSelect.addEventListener('change', () => {
      const idx = deviceSelect.value;
      if (idx === '') { document.getElementById('device-info-box')?.classList.add('hidden'); return; }
      const dev = DEVICES[parseInt(idx)];
      if (dev) showDeviceInfo(dev);
    });
  }
}

// ── Štart prípadu ─────────────────────────────────────────────
async function startCase(category) {
  resetCase();
  APP.currentCase.category  = category;
  APP.currentCase.createdAt = new Date().toISOString();
  APP.currentCase.id        = await generateNextId(category);

  const catInfo   = CONFIG.CATEGORIES[category] || { name: category, icon: '❓' };
  const headerEl  = document.getElementById('case-category-label');
  if (headerEl)   headerEl.textContent = `${catInfo.icon} ${catInfo.name}`;
  const caseIdEl  = document.getElementById('case-id-display');
  if (caseIdEl)   caseIdEl.textContent = APP.currentCase.id;
  const hwSection = document.getElementById('hw-section');
  if (hwSection)  hwSection.style.display = category === 'HW' ? 'block' : 'none';

  document.getElementById('problem-text').value = '';
  const devSel = document.getElementById('device-select');
  if (devSel) devSel.value = '';
  document.getElementById('device-info-box')?.classList.add('hidden');
  showScreen('screen-case');
}

function showDeviceInfo(dev) {
  const box = document.getElementById('device-info-box');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="device-info-grid">
      <div><strong>P/N:</strong> ${escapeHtml(dev.pn) || '—'}</div>
      <div><strong>SN:</strong> ${escapeHtml(dev.sn_sample) || '—'}</div>
      <div class="device-desc" style="grid-column:1/-1;"><strong>Popis:</strong> ${escapeHtml(dev.description?.slice(0,200)) || '—'}</div>
    </div>`;
}

// ── Round 1 ───────────────────────────────────────────────────
async function handleRound1() {
  const problemText = document.getElementById('problem-text')?.value?.trim();
  if (!problemText) { showToast('Zadajte popis problému', 'warning'); return; }

  const cs       = APP.currentCase;
  cs.problemText = problemText;

  if (cs.category === 'HW') {
    const devSel = document.getElementById('device-select');
    if (devSel?.value !== '') cs.device = DEVICES[parseInt(devSel.value)];
  }

  showLoading('AI analyzuje problém...');
  try {
    const kbCtx    = await getKBContextForAI(cs.category, cs.problemText);
    const extraCtx = await getExtraKBContext(cs.problemText);
    showLoading('Kontrolujem WEB KB...');
    const webResult = await searchWebWithCache(cs.problemText, cs.device?.name || '', cs.category);
    const webCtx    = webResult.content || null;
    if (webResult.fromCache) showToast('⚡ WEB KB cache hit', 'success', 2000);

    showLoading('AI analyzuje...');
    const result      = await runRound1(cs, kbCtx, extraCtx, webCtx);
    cs.round1Output   = result.data;
    cs.quickTips      = (result.data.quick_tips || []).map(tip => ({
      tip: typeof tip === 'string' ? tip : tip.tip, state: 'untested', note: ''
    }));

    hideLoading();
    renderRound1Output(result.data, cs.id, (CONFIG.CATEGORIES[cs.category] || {}).name);
    renderQuickTips(cs.quickTips);
    renderTokenBar(result.usage || null, !!result.demo, 'token-bar-r1');
    updateGlobalCostBar();
    updateRound1Header();
    if (result.demo) showToast('Demo režim – Claude API nedostupné', 'warning', 5000);
    showScreen('screen-round1');
  } catch (err) {
    hideLoading();
    showToast('Chyba AI: ' + err.message, 'error');
    console.error(err);
  }
}

function updateRound1Header() {
  const cs = APP.currentCase;
  const el = document.getElementById('round1-case-header');
  if (!el) return;
  const catInfo = CONFIG.CATEGORIES[cs.category] || { name: cs.category, icon: '?' };
  el.innerHTML = `
    <span class="case-id-badge">${escapeHtml(cs.id)}</span>
    <span class="cat-badge cat-${cs.category?.toLowerCase()}">${catInfo.icon} ${catInfo.name}</span>
    ${cs.device ? `<span class="device-badge">🖥️ ${escapeHtml(cs.device.name)}</span>` : ''}`;
}

// ── Round 2 ───────────────────────────────────────────────────
async function handleRound2() {
  const cs       = APP.currentCase;
  cs.quickTips   = readQuickTips('quick-tips-container');
  cs.techNotes   = document.getElementById('tech-notes-input')?.value?.trim() || '';

  showLoading('AI spracúva nové informácie...');
  try {
    const kbCtx    = await getKBContextForAI(cs.category, cs.problemText);
    const extraCtx = await getExtraKBContext(cs.problemText);
    const webResult = await searchWebWithCache(cs.problemText, cs.device?.name || '', cs.category);
    const webCtx    = webResult.content || null;
    if (webResult.fromCache) showToast('⚡ WEB KB cache použitá', 'info', 2000);

    const result    = await runRound2(cs, kbCtx, extraCtx, webCtx);
    cs.round2Output = result.data;

    hideLoading();
    renderRound2Output(result.data);
    renderTokenBar(result.usage || null, !!result.demo, 'token-bar-r2');
    updateGlobalCostBar();
    updateRound2Header();
    if (result.demo) showToast('Demo režim', 'warning', 4000);
    showScreen('screen-round2');
  } catch (err) {
    hideLoading();
    showToast('Chyba AI: ' + err.message, 'error');
    console.error(err);
  }
}

function updateRound2Header() {
  const cs = APP.currentCase;
  const el = document.getElementById('round2-case-header');
  if (!el) return;
  const catInfo = CONFIG.CATEGORIES[cs.category] || { name: cs.category, icon: '?' };
  el.innerHTML = `
    <span class="case-id-badge">${escapeHtml(cs.id)}</span>
    <span class="cat-badge cat-${cs.category?.toLowerCase()}">${catInfo.icon} ${catInfo.name}</span>
    ${cs.device ? `<span class="device-badge">🖥️ ${escapeHtml(cs.device.name)}</span>` : ''}`;
}

// ── Uzatvorenie prípadu ───────────────────────────────────────
function openCloseCase() {
  const cs  = APP.currentCase;
  const hdr = document.getElementById('close-case-id');
  if (hdr) hdr.textContent = cs.id || '—';
  const statusSel = document.getElementById('close-status-select');
  if (statusSel) statusSel.value = cs.escalated ? 'escalated' : '';
  document.getElementById('close-actual-fix').value  = '';
  document.getElementById('close-final-note').value  = '';
  updateCloseCaseForm();
  showScreen('screen-closecase');
}

function updateCloseCaseForm() {
  const status   = document.getElementById('close-status-select')?.value;
  const fixLabel = document.getElementById('actual-fix-label');
  const fixField = document.getElementById('close-actual-fix');
  if (!fixLabel || !fixField) return;
  if (status === 'resolved') {
    fixLabel.textContent  = 'Čo reálne vyriešilo problém? *';
    fixField.placeholder  = 'Popíšte čo fungovalo...';
    fixField.required     = true;
  } else if (status === 'escalated') {
    fixLabel.textContent  = 'Dôvod eskalácie *';
    fixField.placeholder  = 'Prečo bolo eskalované...';
    fixField.required     = true;
  } else {
    fixLabel.textContent  = 'Poznámka k nevyriešenému stavu';
    fixField.placeholder  = 'Voliteľné...';
    fixField.required     = false;
  }
}

async function confirmCloseCase() {
  const status    = document.getElementById('close-status-select')?.value;
  const actualFix = document.getElementById('close-actual-fix')?.value?.trim();
  const finalNote = document.getElementById('close-final-note')?.value?.trim();

  if (!status) { showToast('Vyberte stav prípadu', 'warning'); return; }
  if ((status === 'resolved' || status === 'escalated') && !actualFix) {
    showToast('Vyplňte povinné pole', 'warning'); return;
  }

  const cs       = APP.currentCase;
  cs.status      = status;
  cs.actualFix   = actualFix || '';
  cs.finalNote   = finalNote || '';
  if (status === 'escalated') cs.escalationReason = actualFix;

  // Gramatická oprava
  if (actualFix && actualFix.length >= 5) {
    showLoading('AI opravuje gramatiku...');
    try {
      const gramResult = await runGrammarCorrection(actualFix, cs.category, status);
      if (gramResult.success && gramResult.corrected !== actualFix) {
        hideLoading();
        const accepted = await showGrammarPreview(actualFix, gramResult.corrected);
        if (accepted !== null) {
          cs.actualFix = accepted;
          if (status === 'escalated') cs.escalationReason = accepted;
          document.getElementById('close-actual-fix').value = accepted;
        }
        updateGlobalCostBar();
      } else { hideLoading(); }
    } catch (gramErr) {
      hideLoading();
      console.warn('Gramatická oprava preskočená:', gramErr.message);
    }
  }

  showLoading('Generujem KB záznam...');
  try {
    const kbResult = await generateKBEntry(cs);
    const entry    = await saveKBEntry(cs, kbResult.data);
    entry.final_resolution = cs.actualFix || cs.finalNote || '';

    hideLoading();
    updateGlobalCostBar();
    await updateHomeCounters();
    await updatePendingBadge();
    showSummary(entry, kbResult.demo);
  } catch (err) {
    hideLoading();
    showToast('Chyba ukladania: ' + err.message, 'error');
    console.error(err);
  }
}

// ── Súhrn ─────────────────────────────────────────────────────
function showSummary(entry, isDemo) {
  const container = document.getElementById('summary-content');
  if (!container) { showScreen('screen-home'); return; }

  const cs      = APP.currentCase;
  const helped  = (entry.what_helped || []).map(h => `<li>✅ ${escapeHtml(h)}</li>`).join('');
  const failed  = (entry.what_failed || []).map(f => `<li>❌ ${escapeHtml(f)}</li>`).join('');
  const faqSrc  = entry.faq_items || [];
  const qa1     = faqSrc.slice(0,3).map(qa =>
    `<div class="qa-pair"><strong>Q:</strong> ${escapeHtml(qa.question || '')}<br><strong>A:</strong> ${escapeHtml(qa.answer || '')}</div>`
  ).join('');

  const syncStatus = entry.synced === false
    ? '<div style="color:var(--accent-yellow);font-size:12px;margin-top:4px;">⚠️ Čaká na cloud sync</div>'
    : '<div style="color:var(--accent-green);font-size:12px;margin-top:4px;">☁️ Odosielané do cloudu</div>';

  container.innerHTML = `
    <div class="summary-header">
      <div class="summary-id">${escapeHtml(entry.record_id)}</div>
      <div class="summary-status status-${entry.status}">${statusLabel(entry.status)}</div>
      ${isDemo ? '<div class="demo-badge">Demo KB (bez API)</div>' : ''}
      ${syncStatus}
    </div>
    <div class="summary-grid">
      <div class="summary-section">
        <h3>🎯 Problém</h3>
        <p>${escapeHtml(entry.problem_summary || cs.problemText)}</p>
      </div>
      ${entry.device_name ? `<div class="summary-section"><h3>🖥️ Zariadenie</h3><p>${escapeHtml(entry.device_name)}</p></div>` : ''}
      ${entry.actual_fix ? `<div class="summary-section summary-solution"><h3>✅ Riešenie</h3><p>${escapeHtml(entry.actual_fix)}</p></div>` : ''}
      ${helped || failed ? `<div class="summary-section"><h3>Quick tipy</h3><ul>${helped}${failed}</ul></div>` : ''}
      ${qa1 ? `<div class="summary-section"><h3>💬 Q/A</h3>${qa1}</div>` : ''}
      <div class="summary-section">
        <h3>🏷️ Tagy</h3>
        <div class="result-tags">
          ${(entry.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="summary-section">
        <h3>📦 Uložené</h3>
        <p>${entry.category}_KB | Priorita: ${entry.priority || '—'} | Dôvera: ${Math.round((entry.confidence_score || 0) * 100)}%</p>
      </div>
    </div>`;

  showScreen('screen-summary');
  setTimeout(() => {
    animateProgress('summary-progress', 1800, () => {
      showToast(`KB záznam ${entry.record_id} vytvorený`, 'success', 4000);
    });
  }, 200);
}

// ── Handoff ───────────────────────────────────────────────────
function openHandoff() {
  const handoffText = buildHandoffText(APP.currentCase);
  try {
    navigator.clipboard.writeText(handoffText);
    showToast('Skopírované do schránky', 'success');
  } catch {
    const ta = document.getElementById('handoff-text-preview');
    if (ta) { ta.value = handoffText; ta.select(); document.execCommand('copy'); }
  }
  const preview = document.getElementById('handoff-text-preview');
  if (preview) preview.value = handoffText;
  showModal('modal-handoff');
}

function openExternalAI(service) {
  const urls = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/' };
  const url  = urls[service];
  if (url) { window.open(url, '_blank'); showToast(`Otváram ${service}`, 'info', 3000); hideAllModals(); }
}

// ── Eskalácia ─────────────────────────────────────────────────
function handleEscalate() {
  APP.currentCase.escalated = true;
  showToast('Prípad označený ako eskalovaný', 'warning');
  openCloseCase();
}

// ── Vyhľadávanie ──────────────────────────────────────────────
function openSearch() {
  document.getElementById('search-input').value   = '';
  document.getElementById('search-results').innerHTML = '';
  showModal('modal-search');
}

async function handleSearch() {
  const query        = document.getElementById('search-input')?.value || '';
  const cat          = document.getElementById('search-cat-filter')?.value || '';
  const status       = document.getElementById('search-status-filter')?.value || '';
  const includeExtra = document.getElementById('search-extra-toggle')?.checked || false;
  const includeWeb   = document.getElementById('search-web-toggle')?.checked || false;

  const results = await searchKB(query, {
    category: cat || null, status: status || null, includeExtra, includeWeb
  });
  renderSearchResults(results);
}

// ── Domov ─────────────────────────────────────────────────────
async function goHome() {
  resetCase();
  await updateHomeCounters();
  await updatePendingBadge();
  updateGlobalCostBar();
  showScreen('screen-home');
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('DOMContentLoaded', initApp);
