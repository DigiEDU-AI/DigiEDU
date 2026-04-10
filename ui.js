// ============================================================
// DigiEDU – UI Utilities (ui.js)
// ============================================================

// ── Toast notifikácie ─────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ── Modaly ────────────────────────────────────────────────────

function showModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('active'); document.body.classList.add('modal-open'); }
}

function hideModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('active'); document.body.classList.remove('modal-open'); }
}

function hideAllModals() {
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  document.body.classList.remove('modal-open');
}

// ── Screens (SPA routing) ─────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) {
    screen.classList.add('active');
    window.scrollTo(0, 0);
  }
}

// ── Loading overlay ───────────────────────────────────────────

function showLoading(message = 'Spracovávam...') {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.querySelector('.loading-msg').textContent = message;
    overlay.classList.add('active');
  }
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ── Progress bar ──────────────────────────────────────────────

function animateProgress(elementId, duration = 2000, onDone) {
  const bar = document.getElementById(elementId);
  if (!bar) { if (onDone) onDone(); return; }
  const fill = bar.querySelector('.progress-fill');
  if (!fill) { if (onDone) onDone(); return; }
  fill.style.width = '0%';
  fill.style.transition = `width ${duration}ms ease-in-out`;
  requestAnimationFrame(() => {
    fill.style.width = '100%';
    setTimeout(() => { if (onDone) onDone(); }, duration + 100);
  });
}

// ── Password modal ────────────────────────────────────────────

function requirePassword(onSuccess) {
  const modal = document.getElementById('modal-password');
  const input = document.getElementById('password-input');
  const btn = document.getElementById('password-confirm-btn');
  const err = document.getElementById('password-error');

  if (!modal) { onSuccess(); return; }
  input.value = '';
  err.textContent = '';
  showModal('modal-password');

  const handleConfirm = () => {
    if (input.value === CONFIG.IMPORT_PASSWORD) {
      hideModal('modal-password');
      btn.removeEventListener('click', handleConfirm);
      onSuccess();
    } else {
      err.textContent = 'Nesprávne heslo';
      input.value = '';
      input.focus();
    }
  };

  btn.replaceWith(btn.cloneNode(true)); // Remove old listeners
  document.getElementById('password-confirm-btn').addEventListener('click', handleConfirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleConfirm(); }, { once: true });
  input.focus();
}

// ── Device dropdown ───────────────────────────────────────────

function renderDeviceDropdown() {
  const sel = document.getElementById('device-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Vyberte zariadenie --</option>';
  (typeof DEVICES !== 'undefined' ? DEVICES : []).forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${d.id}. ${d.name}`;
    sel.appendChild(opt);
  });
}

// ── Quick tips renderer ───────────────────────────────────────

function renderQuickTips(tips, containerId = 'quick-tips-container') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  tips.forEach((tip, i) => {
    const item = document.createElement('div');
    item.className = 'quick-tip-item';
    item.dataset.index = i;
    item.innerHTML = `
      <div class="quick-tip-header">
        <span class="tip-num">${i + 1}.</span>
        <span class="tip-text">${escapeHtml(tip.tip || tip)}</span>
      </div>
      <div class="quick-tip-controls">
        <label class="tip-state-label ${tip.state === 'untested' ? 'active' : ''}" data-state="untested">
          <input type="radio" name="tip_${i}" value="untested" ${tip.state === 'untested' ? 'checked' : ''}> Neskúšané
        </label>
        <label class="tip-state-label ${tip.state === 'failed' ? 'active' : ''}" data-state="failed">
          <input type="radio" name="tip_${i}" value="failed" ${tip.state === 'failed' ? 'checked' : ''}> ❌ Nepomohlo
        </label>
        <label class="tip-state-label ${tip.state === 'helped' ? 'active' : ''}" data-state="helped">
          <input type="radio" name="tip_${i}" value="helped" ${tip.state === 'helped' ? 'checked' : ''}> ✅ Pomohlo
        </label>
      </div>
      <input type="text" class="tip-note-input" placeholder="Voliteľná poznámka..." value="${escapeHtml(tip.note || '')}">
    `;
    // Highlight active radio
    item.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        item.querySelectorAll('.tip-state-label').forEach(l => l.classList.remove('active'));
        const checked = item.querySelector('input[type="radio"]:checked');
        if (checked) checked.closest('.tip-state-label').classList.add('active');
      });
    });
    container.appendChild(item);
  });
}

// Načítanie stavov quick tipov z DOM
function readQuickTips(containerId = 'quick-tips-container') {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const items = container.querySelectorAll('.quick-tip-item');
  return Array.from(items).map(item => {
    const checked = item.querySelector('input[type="radio"]:checked');
    const noteInput = item.querySelector('.tip-note-input');
    const tipText = item.querySelector('.tip-text')?.textContent || '';
    return {
      tip: tipText,
      state: checked?.value || 'untested',
      note: noteInput?.value || ''
    };
  });
}

// ── Token / Cost Bar ──────────────────────────────────────────

function renderTokenBar(usage, isDemo, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ses = typeof TOKEN_SESSION !== 'undefined' ? TOKEN_SESSION
    : { input_tokens:0, output_tokens:0, cost_usd:0, calls:0, web_calls:0, web_cache_hits:0 };

  const lastIn   = usage?.input_tokens  || 0;
  const lastOut  = usage?.output_tokens || 0;
  const lastCost = usage
    ? ((lastIn / 1_000_000) * CONFIG.PRICE_INPUT_PER_MTOK + (lastOut / 1_000_000) * CONFIG.PRICE_OUTPUT_PER_MTOK)
    : 0;

  const limitWarn = false;
  const limitHtml = CONFIG.MAX_COST_ENABLED
    ? `<span class="token-sep">·</span><span class="token-label muted">Per-call limity</span>`
    : '';

  if (isDemo) {
    container.innerHTML = `
      <div class="token-bar demo-mode">
        <span class="token-bar-icon">⚡</span>
        <span class="token-label">DEMO režim</span>
        <span class="token-sep">·</span>
        <span class="token-label muted">Claude API nedostupné – tokeny sa neminuli</span>
      </div>`;
    return;
  }

  const webHtml = ses.web_calls
    ? `<span class="token-sep">·</span><span class="token-label muted">🌐 ${ses.web_calls} web</span>${ses.web_cache_hits ? `<span class="token-label muted"> ⚡${ses.web_cache_hits}× cache</span>` : ''}`
    : '';

  container.innerHTML = `
    <div class="token-bar">
      <div class="token-group">
        <span class="token-bar-icon">🔤</span>
        <span class="token-label muted">Toto volanie:</span>
        <span class="token-val">${fmtNum(lastIn + lastOut)} tok</span>
        <span class="token-sep">·</span>
        <span class="token-val">${lastIn.toLocaleString('sk')} in</span>
        <span class="token-val">${lastOut.toLocaleString('sk')} out</span>
        <span class="token-cost ${limitWarn ? 'token-warn' : ''}">≈ $${lastCost.toFixed(4)}</span>
        ${limitHtml}
      </div>
      <div class="token-sep-v">|</div>
      <div class="token-group">
        <span class="token-bar-icon">📊</span>
        <span class="token-label muted">Session (${ses.calls} vol.):</span>
        <span class="token-val">${fmtNum(ses.input_tokens + ses.output_tokens)} tok</span>
        <span class="token-val">${fmtNum(ses.input_tokens)} in</span>
        <span class="token-val">${fmtNum(ses.output_tokens)} out</span>
        <span class="token-cost session-cost">≈ $${ses.cost_usd.toFixed(4)}</span>
        ${webHtml}
      </div>
      <div class="token-model">
        <span class="token-label muted">Model:</span>
        <span class="token-val">${CONFIG.API_MODEL}</span>
      </div>
    </div>`;
}

function fmtNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// ── AI Output renderers ───────────────────────────────────────

function renderRound1Output(data, caseId, catName) {
  const container = document.getElementById('round1-output');
  if (!container) return;

  const steps     = (data.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const causes    = (data.analysis?.possible_causes || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');
  const verify    = (data.analysis?.what_to_verify || []).map(v => `<li>${escapeHtml(v)}</li>`).join('');
  const questions = (data.questions || []).map((q, i) => `<li><strong>Q${i+1}:</strong> ${escapeHtml(q)}</li>`).join('');
  const mainRec   = data.main_recommendation || data.analysis?.what_it_means || '';

  container.innerHTML = `
    <div class="ai-section section-main-rec">
      <div class="ai-section-header">
        <span class="section-letter section-letter-main">★</span>
        Hlavná odporúčaná rada technika
      </div>
      <div class="ai-section-body">
        <div class="main-rec-text">${escapeHtml(mainRec)}</div>
        <div class="main-rec-meta">
          <span class="main-rec-summary">${escapeHtml(data.problem_summary || '')}</span>
        </div>
      </div>
    </div>

    <div class="ai-section section-analysis">
      <div class="ai-section-header"><span class="section-letter">A</span> Analýza problému</div>
      <div class="ai-section-body">
        <div class="two-col">
          <div>
            <h4>Možné príčiny</h4>
            <ul>${causes}</ul>
          </div>
          <div>
            <h4>Čo overiť</h4>
            <ul>${verify}</ul>
          </div>
        </div>
        <div class="most-likely">
          <strong>Najpravdepodobnejší scenár:</strong> ${escapeHtml(data.analysis?.most_likely || '')}
        </div>
      </div>
    </div>

    <div class="ai-section section-steps">
      <div class="ai-section-header"><span class="section-letter">B</span> Postup riešenia krok za krokom</div>
      <div class="ai-section-body">
        <ol class="steps-list">${steps}</ol>
      </div>
    </div>

    <div class="ai-section section-questions">
      <div class="ai-section-header"><span class="section-letter">C</span> Otázky pre zadávateľa</div>
      <div class="ai-section-body">
        <ul class="questions-list">${questions}</ul>
      </div>
    </div>
  `;
}

function renderRound2Output(data) {
  const container = document.getElementById('round2-output');
  if (!container) return;

  const steps = (data.refined_steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const avoid = (data.what_to_avoid || []).map(a => `<li>${escapeHtml(a)}</li>`).join('');

  container.innerHTML = `
    <div class="ai-section section-round2">
      <div class="ai-section-header round2-header"><span class="section-letter">II</span> Druhé kolo – Detailná analýza</div>
      <div class="ai-section-body">
        <div class="key-finding">
          <strong>Kľúčový záver:</strong> ${escapeHtml(data.key_finding || '')}
        </div>
        <p class="analysis-main">${escapeHtml(data.refined_analysis || '')}</p>

        <h4>Spresnenný postup</h4>
        <ol class="steps-list">${steps}</ol>

        <div class="solution-box">
          <strong>Najpravdepodobnejšie riešenie:</strong>
          <p>${escapeHtml(data.most_likely_solution || '')}</p>
        </div>

        ${avoid ? `
        <div class="avoid-box">
          <h4>⛔ Neskúšať – nepomáha:</h4>
          <ul>${avoid}</ul>
        </div>` : ''}

        <div class="escalation-hint">
          <strong>Kedy eskalovať:</strong> ${escapeHtml(data.escalation_signal || '')}
        </div>
      </div>
    </div>
  `;
}

// ── Search results renderer ───────────────────────────────────

function renderSearchResults(results, containerId = 'search-results') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!results.length) {
    container.innerHTML = '<div class="no-results">🔍 Žiadne výsledky. Skúste iný výraz alebo kategóriu.</div>';
    return;
  }

  const CAT_ICONS = { HW:'🖥️', '365':'☁️', WIFI:'📡', ADMIN:'📋', OTHER:'❓', WEB:'🌐', EXTRA:'🧠', BRAIN:'🧠' };

  container.innerHTML = results.map(e => {
    const isWeb  = (e.category === 'WEB' || e._store === 'WEB');
    const cat    = e.category || e._store || '?';
    const icon   = CAT_ICONS[cat] || '📄';
    const title  = e.title || e.problem_summary || e.query || (e.original_problem_text||'').slice(0, 100) || 'Bez názvu';
    const solved = e.actual_fix || e.final_resolution || '';
    const conf   = e.confidence_score ? `${Math.round(e.confidence_score * 100)}%` : '';
    const prio   = e.priority || '';
    const prioColor = { critical:'#ef4444', high:'#f59e0b', medium:'#3b82f6', low:'#6b7280' }[prio] || '#6b7280';
    const id     = e.record_id || e.entry_id || '';
    const tags   = (e.tags || []).slice(0, 4);
    const faqCount = (e.faq_items || []).length;

    return `
    <div class="search-result-card${isWeb ? ' web-entry' : ''}" data-id="${escapeHtml(id)}" data-store="${escapeHtml(cat)}" style="cursor:pointer;">
      <div class="result-header" style="gap:6px;flex-wrap:wrap;">
        <span class="result-id">${escapeHtml(id)}</span>
        <span class="result-cat cat-${cat.toLowerCase()}">${icon} ${escapeHtml(cat)}</span>
        <span class="result-status status-${e.status || 'raw'}">${statusLabel(e.status || 'raw')}</span>
        ${prio ? `<span style="font-size:10px;font-weight:700;color:${prioColor};text-transform:uppercase;">${prio}</span>` : ''}
        ${conf ? `<span style="font-size:10px;color:var(--text-dim);margin-left:auto;">✓ ${conf}</span>` : ''}
      </div>

      <div class="result-title" style="font-size:14px;font-weight:600;margin:6px 0 4px;">${escapeHtml(title)}</div>

      ${e.device_name ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">🖥️ ${escapeHtml(e.device_name)}</div>` : ''}

      ${solved ? `<div style="font-size:12px;color:#10b981;background:rgba(16,185,129,0.08);border-left:2px solid #10b981;padding:4px 8px;border-radius:4px;margin-bottom:6px;">✅ ${escapeHtml(solved.slice(0, 120))}${solved.length > 120 ? '…' : ''}</div>` : ''}

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="result-tags" style="flex:1;">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        ${faqCount ? `<span style="font-size:11px;color:var(--text-dim);">💬 ${faqCount} FAQ</span>` : ''}
        ${formatDate(e.created_at) ? `<span style="font-size:11px;color:var(--text-dim);">${formatDate(e.created_at)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.search-result-card').forEach(card => {
    card.addEventListener('click', () => showKBDetail(card.dataset.id, card.dataset.store));
  });
}

async function showKBDetail(entryId, store) {
  // V Cloud-First architektúre sú záznamy v unified main_kb store
  // getEntry() funguje priamo, dbGet() len ako fallback
  let entry = null;
  if (typeof getEntry === 'function') {
    entry = await getEntry(entryId);
  }
  if (!entry && typeof dbGet === 'function') {
    entry = await dbGet(store || 'main_kb', entryId);
  }
  if (!entry) {
    // Posledný pokus – hľadaj vo všetkých known stores
    for (const s of ['main_kb', 'HW', '365', 'WIFI', 'ADMIN', 'OTHER', 'WEB', 'EXTRA']) {
      try { entry = await dbGet(s, entryId); if (entry) break; } catch {}
    }
  }
  if (!entry) { showToast('Záznam nenájdený – skúste znovu', 'error'); return; }

  const modal = document.getElementById('modal-kb-detail');
  const body  = document.getElementById('kb-detail-body');
  if (!modal || !body) return;

  // ── WEB KB záznam ─────────────────────────────────────────
  if (store === 'WEB') {
    body.innerHTML = `
      <div class="detail-meta">
        <span class="result-id">${escapeHtml(entry.entry_id)}</span>
        <span class="result-cat cat-web">🌐 WEB cache</span>
      </div>
      ${entry.device ? `<div class="detail-device">🖥️ <strong>${escapeHtml(entry.device)}</strong></div>` : ''}
      <div class="detail-section">
        <h3>🔍 Pôvodný dotaz</h3>
        <p>${escapeHtml(entry.query || '—')}</p>
      </div>
      <div class="detail-section solution-box">
        <h3>🌐 Obsah z webu</h3>
        <pre style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:#e2e8f0;">${escapeHtml(entry.content || '—')}</pre>
      </div>
      <div class="detail-section">
        <div class="result-tags">${(entry.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="detail-dates">Uložené: ${formatDate(entry.created_at)}</div>
      </div>
    `;
    showModal('modal-kb-detail');
    return;
  }

  // ── Kompletný KB záznam ──────────────────────────────────
  const displayStatus = entry.case_status || entry.status;
  const priorityBadge = entry.priority
    ? `<span class="tag tag-priority-${entry.priority}">${entry.priority}</span>` : '';

  // Hotfixy, root causes, diagnostické otázky
  const hotfixes = (entry.hotfixes || []).filter(h => h && h !== '—').map(h => `<li>🔧 ${escapeHtml(h)}</li>`).join('');
  const roots    = (entry.root_causes || []).filter(r => r && r !== '—').map(r => `<li>${escapeHtml(r)}</li>`).join('');
  const diagQ    = (entry.diagnostic_questions || []).filter(d => d && d !== '—').map(d => `<li>${escapeHtml(d)}</li>`).join('');

  // Quick tips
  const tips = (entry.quick_tips || []).map(t => {
    const tip = typeof t === 'string' ? t : t.tip;
    const st  = typeof t === 'object' ? t.state : 'untested';
    const icon = st === 'helped' ? '✅' : st === 'failed' ? '❌' : '○';
    return `<li>${icon} ${escapeHtml(tip)}</li>`;
  }).join('');

  // Helped / Failed
  const helped = (entry.what_helped || []).map(h => `<li>✅ ${escapeHtml(h)}</li>`).join('');
  const failed = (entry.what_failed || []).map(f => `<li>❌ ${escapeHtml(f)}</li>`).join('');

  // Recommended steps (legacy)
  const steps = (entry.recommended_steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  // FAQ (nový formát) alebo legacy chatbot_qa_set
  const faqItems = entry.faq_items || [];
  const legacyQA = [...(entry.chatbot_qa_set_1 || []), ...(entry.chatbot_qa_set_2 || [])];
  const qaSource = faqItems.length ? faqItems : legacyQA;
  const qaHtml = qaSource
    .filter(f => (f.question || f.q) && (f.question || f.q) !== '—')
    .map(f => `<div class="qa-pair"><strong>Q:</strong> ${escapeHtml(f.question || f.q || '')}<br><strong>A:</strong> ${escapeHtml(f.answer || f.a || '')}</div>`)
    .join('');

  // Technické poznámky
  const techNotes = (entry.new_information_from_technician || []).filter(Boolean).join('\n');

  body.innerHTML = `
    <div class="detail-meta">
      <span class="result-id">${escapeHtml(entry.record_id || entry.entry_id)}</span>
      <span class="result-cat cat-${(entry.kb_set || entry.category || '').toLowerCase()}">${escapeHtml(entry.kb_set || entry.category)}</span>
      <span class="result-status status-${displayStatus}">${statusLabel(displayStatus)}</span>
      ${priorityBadge}
    </div>

    ${entry.title ? `<div style="font-size:17px;font-weight:700;margin:10px 0 14px;color:var(--text);">${escapeHtml(entry.title)}</div>` : ''}
    ${entry.device_name ? `<div class="detail-device">🖥️ <strong>${escapeHtml(entry.device_name)}</strong>${entry.device_info?.pn ? ` (P/N: ${escapeHtml(entry.device_info.pn)})` : ''}</div>` : ''}

    <!-- Problém -->
    <div class="detail-section">
      <h3>🎯 Problém</h3>
      <p>${escapeHtml(entry.problem_summary || entry.original_problem_text || '')}</p>
      ${entry.original_problem_text && entry.problem_summary && entry.original_problem_text !== entry.problem_summary
        ? `<p style="margin-top:6px;color:var(--text-muted);font-size:13px;"><em>Originálny text:</em> ${escapeHtml(entry.original_problem_text)}</p>` : ''}
    </div>

    <!-- Profesionálny článok -->
    ${entry.professional_article ? `
    <div class="detail-section solution-box" style="border-color:rgba(59,130,246,0.3);">
      <h3>📖 Profesionálny článok</h3>
      <p style="line-height:1.7;">${escapeHtml(entry.professional_article)}</p>
      ${entry.layman_summary ? `<p style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);color:var(--text-muted);font-style:italic;">👤 Pre používateľa: ${escapeHtml(entry.layman_summary)}</p>` : ''}
    </div>` : ''}

    <!-- Riešenie -->
    ${entry.actual_fix || entry.final_resolution ? `
    <div class="detail-section solution-box">
      <h3>✅ Riešenie</h3>
      <p>${escapeHtml(entry.actual_fix || entry.final_resolution)}</p>
    </div>` : ''}

    <!-- Root causes + Hotfixy -->
    ${roots || hotfixes ? `
    <div class="detail-section two-col">
      ${roots ? `<div><h4>🔍 Hlavné príčiny</h4><ul>${roots}</ul></div>` : ''}
      ${hotfixes ? `<div><h4>🔧 Hotfixy</h4><ul>${hotfixes}</ul></div>` : ''}
    </div>` : ''}

    <!-- Diagnostické otázky -->
    ${diagQ ? `<div class="detail-section"><h3>❓ Diagnostické otázky</h3><ul>${diagQ}</ul></div>` : ''}

    <!-- Kroky (legacy) -->
    ${steps ? `<div class="detail-section"><h3>📋 Odporúčané kroky</h3><ol class="steps-list">${steps}</ol></div>` : ''}

    <!-- Quick tipy -->
    ${tips ? `<div class="detail-section"><h3>⚡ Quick tipy</h3><ul>${tips}</ul></div>` : ''}

    <!-- Čo pomohlo / nepomohlo -->
    ${helped || failed ? `
    <div class="detail-section two-col">
      ${helped ? `<div><h4>✅ Čo pomohlo</h4><ul>${helped}</ul></div>` : ''}
      ${failed ? `<div><h4>❌ Čo nepomohlo</h4><ul>${failed}</ul></div>` : ''}
    </div>` : ''}

    <!-- Technické poznámky -->
    ${techNotes ? `<div class="detail-section"><h3>📝 Poznámky technika</h3><p>${escapeHtml(techNotes)}</p></div>` : ''}

    <!-- Eskalácia -->
    ${entry.escalation_reason ? `<div class="detail-section" style="border-left:3px solid #f59e0b;padding-left:12px;"><h3>⬆️ Dôvod eskalácie</h3><p>${escapeHtml(entry.escalation_reason)}</p></div>` : ''}

    <!-- FAQ -->
    ${qaHtml ? `<div class="detail-section"><h3>💬 FAQ</h3>${qaHtml}</div>` : ''}

    <!-- Tagy, keywords -->
    <div class="detail-section">
      <div class="result-tags">
        ${(entry.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        ${(entry.keywords || []).filter(k => k && k !== '—').map(k => `<span class="tag tag-keyword">${escapeHtml(k)}</span>`).join('')}
      </div>
      <div class="detail-dates">
        Vytvorený: ${formatDate(entry.created_at)} | Aktualizovaný: ${formatDate(entry.updated_at || entry.closed_at)}
        ${entry.version ? ` | v${escapeHtml(entry.version)}` : ''}
        ${entry.confidence_score ? ` | Dôvera: ${Math.round(entry.confidence_score * 100)}%` : ''}
      </div>
    </div>

    <!-- Podobné záznamy (načítajú sa async) -->
    <div class="detail-section" id="related-records-section">
      <h3>🔗 Podobné záznamy</h3>
      <div id="related-records-list" style="color:var(--text-muted);font-size:13px;">Hľadám...</div>
    </div>
  `;

  showModal('modal-kb-detail');

  // Async: nájdi a zobraz podobné záznamy
  loadRelatedRecords(entry);
}

// ── Načítanie podobných záznamov do detailu ────────────────

async function loadRelatedRecords(entry) {
  const container = document.getElementById('related-records-list');
  if (!container) return;

  try {
    // Použi unified findRelatedKBEntries ak dostupná
    let related = [];
    if (typeof findRelatedKBEntries === 'function') {
      related = await findRelatedKBEntries(entry, 6);
    } else {
      // Fallback – manuálne hľadanie v known stores
      const q = (entry.problem_summary || entry.title || '').toLowerCase();
      const words = q.split(/\s+/).filter(w => w.length > 3);
      const stores = ['HW','365','WIFI','ADMIN','OTHER'];
      for (const s of stores) {
        try {
          const entries = await dbGetAll(s);
          for (const e of entries) {
            if (e.entry_id === entry.entry_id) continue;
            const text = (e.problem_summary || e.title || '').toLowerCase();
            const score = words.filter(w => text.includes(w)).length;
            if (score >= 2) related.push({ ...e, _score: score });
          }
        } catch {}
      }
      related = related.sort((a,b) => b._score - a._score).slice(0, 6);
    }

    if (!related.length) {
      container.innerHTML = '<span style="color:var(--text-dim);">Žiadne podobné záznamy</span>';
      return;
    }

    const CAT_ICONS = { HW:'🖥️', '365':'☁️', WIFI:'📡', ADMIN:'📋', OTHER:'❓', WEB:'🌐', EXTRA:'🧠' };

    container.innerHTML = related.map(r => {
      const cat  = r.category || r.kb_set || '?';
      const icon = CAT_ICONS[cat] || '📄';
      const rid  = r.record_id || r.entry_id;
      const title = r.title || r.problem_summary || rid;
      const solved = r.actual_fix || r.final_resolution || '';
      return `
        <div class="related-record-card" data-id="${escapeHtml(rid)}" data-store="${escapeHtml(cat)}" style="cursor:pointer;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;transition:border-color 0.2s;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--text-dim);">${escapeHtml(rid)}</span>
            <span style="font-size:11px;font-weight:700;">${icon} ${escapeHtml(cat)}</span>
            ${r.priority ? `<span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;">${r.priority}</span>` : ''}
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px;">${escapeHtml(title.slice(0, 100))}${title.length > 100 ? '…' : ''}</div>
          ${solved ? `<div style="font-size:11px;color:#10b981;">✅ ${escapeHtml(solved.slice(0, 80))}${solved.length > 80 ? '…' : ''}</div>` : ''}
          <div style="margin-top:5px;">${(r.tags || []).slice(0, 3).map(t => `<span class="tag" style="font-size:10px;">${escapeHtml(t)}</span>`).join('')}</div>
        </div>`;
    }).join('');

    // Klik na related → otvor detail
    container.querySelectorAll('.related-record-card').forEach(card => {
      card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--border-strong)');
      card.addEventListener('mouseleave', () => card.style.borderColor = 'var(--border)');
      card.addEventListener('click', () => showKBDetail(card.dataset.id, card.dataset.store));
    });

  } catch (err) {
    container.innerHTML = `<span style="color:var(--text-dim);">Chyba načítania: ${escapeHtml(err.message)}</span>`;
  }
}
// ── Counter badges update ─────────────────────────────────────

async function updateHomeCounters() {
  const counters = await getCounters();
  CONFIG.CATEGORY_KEYS.forEach(cat => {
    const c      = counters[cat] || {};
    const totalEl = document.getElementById(`counter-total-${cat}`);
    const newEl   = document.getElementById(`counter-new-${cat}`);
    if (totalEl) totalEl.textContent = c.total || 0;
    if (newEl) {
      newEl.textContent = c.newSinceExport || 0;
      newEl.classList.toggle('has-new', (c.newSinceExport || 0) > 0);
    }
  });
  const extraEl = document.getElementById('counter-extra');
  if (extraEl) extraEl.textContent = (counters.EXTRA?.total || 0) + ' EXTRA záznamov';

  // WEB KB počítadlo + nové záznamy badge
  try {
    const webCount    = await getWebKBCount();
    const webNew      = await getWebNewCount();
    const webLastExp  = await getWebLastExport();
    const webEl       = document.getElementById('counter-web-kb');
    if (webEl) {
      const newBadge = webNew > 0 ? ` · <strong>${webNew} nových</strong>` : '';
      const lastBadge = webLastExp
        ? ` · export ${new Date(webLastExp).toLocaleDateString('sk-SK')}`
        : '';
      webEl.innerHTML   = `🌐 ${webCount} WEB záznamov${newBadge}${lastBadge}`;
      webEl.style.display = webCount > 0 ? 'block' : 'none';
    }
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusLabel(status) {
  const labels = {
    resolved: '✅ Vyriešené', unresolved: '❌ Nevyriešené', escalated: '⬆️ Eskalované',
    approved: '✅ Schválené', staging: '🔄 Staging', raw: '📝 Raw', draft: '📋 Draft', archived: '🗄️ Archivované'
  };
  return labels[status] || status || '?';
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  try { return new Date(iso).toLocaleDateString('sk-SK'); } catch { return iso; }
}

// ── Globálna Cost Bar (fixná dole v strede) ───────────────────

function updateGlobalCostBar() {
  const bar = document.getElementById('global-cost-bar');
  if (!bar) return;

  const s   = typeof TOKEN_SESSION !== 'undefined' ? TOKEN_SESSION : { input_tokens:0, output_tokens:0, cost_usd:0, calls:0, web_calls:0, web_cache_hits:0 };
  const limEnabled = CONFIG.MAX_COST_ENABLED;

  const limitHtml = limEnabled
    ? `<span class="gcb-sep">|</span>
       <span class="gcb-label">Limity:</span>
       <span class="gcb-val gcb-limit">R1:$${(CONFIG.COST_LIMITS?.round1||0).toFixed(3)} R2:$${(CONFIG.COST_LIMITS?.round2||0).toFixed(3)}</span>`
    : '';

  bar.innerHTML = `
    <div class="gcb-inner">
      <span class="gcb-icon">💰</span>
      <span class="gcb-label">Session:</span>
      <span class="gcb-val gcb-cost">\$${s.cost_usd.toFixed(4)}</span>
      <span class="gcb-sep">·</span>
      <span class="gcb-label">${s.calls} volaní</span>
      ${s.web_calls ? `<span class="gcb-sep">·</span><span class="gcb-label">🌐 ${s.web_calls} web</span>` : ''}
      ${s.web_cache_hits ? `<span class="gcb-sep">·</span><span class="gcb-label">⚡ ${s.web_cache_hits}× cache</span>` : ''}
      ${limitHtml}
      <button class="gcb-settings-btn" onclick="openCostSettings()" title="Nastaviť limit">⚙️</button>
    </div>
  `;
}

// ── WEB KB counter update ─────────────────────────────────────

async function updateWebKBCounter() {
  // Rýchla aktualizácia len WEB KB badges bez načítania celých counters
  try {
    const webCount   = await getWebKBCount();
    const webNew     = await getWebNewCount();
    const webLastExp = await getWebLastExport();
    const webEl      = document.getElementById('counter-web-kb');
    if (webEl) {
      const newBadge  = webNew > 0 ? ` · <strong>${webNew} nových</strong>` : '';
      const lastBadge = webLastExp
        ? ` · export ${new Date(webLastExp).toLocaleDateString('sk-SK')}`
        : '';
      webEl.innerHTML     = `🌐 ${webCount} WEB záznamov${newBadge}${lastBadge}`;
      webEl.style.display = webCount > 0 ? 'block' : 'none';
    }
  } catch {}
}

// ── Cost Settings Modal ───────────────────────────────────────

function openCostSettings() {
  const modal = document.getElementById('modal-cost-settings');
  if (!modal) return;

  // Naplň aktuálne hodnoty
  const enabledEl = document.getElementById('cost-limit-enabled');
  const limitEl   = document.getElementById('cost-limit-value');
  if (enabledEl) enabledEl.checked = CONFIG.MAX_COST_ENABLED;
  if (limitEl)   limitEl.value     = CONFIG.MAX_COST_PER_CALL;

  // Model info
  const modelEl  = document.getElementById('cost-modal-model');
  const pricesEl = document.getElementById('cost-modal-prices');
  if (modelEl)  modelEl.textContent  = CONFIG.MODEL_LABEL + ' (' + CONFIG.API_MODEL + ')';
  if (pricesEl) pricesEl.textContent =
    `$${CONFIG.PRICE_INPUT_PER_MTOK}/M input · $${CONFIG.PRICE_OUTPUT_PER_MTOK}/M output`;

  updateCostLimitInputState();
  showModal('modal-cost-settings');
}

function updateCostLimitInputState() {
  const enabledEl = document.getElementById('cost-limit-enabled');
  const limitEl   = document.getElementById('cost-limit-value');
  const infoEl    = document.getElementById('cost-limit-info');
  if (!enabledEl || !limitEl) return;

  const enabled = enabledEl.checked;
  limitEl.disabled = !enabled;

  if (enabled && infoEl) {
    const lim = CONFIG.COST_LIMITS || {};
    const inPerM  = CONFIG.PRICE_INPUT_PER_MTOK;
    const outPerM = CONFIG.PRICE_OUTPUT_PER_MTOK;
    const calcOut = (budget, estIn) => Math.max(0, Math.floor(((budget - (estIn/1e6)*inPerM) * 1e6) / outPerM));

    const estSession = (lim.web_search||0) + (lim.round1||0) + (lim.round2||0) + (lim.grammar||0) + (lim.kb_gen||0);

    infoEl.innerHTML =
      `<strong>Per-call limity (${CONFIG.MODEL_LABEL}):</strong><br>` +
      `• Kolo 1: <strong>$${(lim.round1||0).toFixed(3)}</strong> → ~${calcOut(lim.round1||0, 1200).toLocaleString('sk')} out tok<br>` +
      `• Kolo 2: <strong>$${(lim.round2||0).toFixed(3)}</strong> → ~${calcOut(lim.round2||0, 2000).toLocaleString('sk')} out tok<br>` +
      `• Gramatika: <strong>$${(lim.grammar||0).toFixed(3)}</strong> → ~${calcOut(lim.grammar||0, 300).toLocaleString('sk')} out tok<br>` +
      `• KB gen: <strong>$${(lim.kb_gen||0).toFixed(3)}</strong> → ~${calcOut(lim.kb_gen||0, 1500).toLocaleString('sk')} out tok<br>` +
      `• Web search: <strong>$${(lim.web_search||0).toFixed(3)}</strong> → ~${calcOut(lim.web_search||0, 400).toLocaleString('sk')} out tok<br>` +
      `• <strong>Max celý prípad: ≈ $${estSession.toFixed(3)}</strong>`;
  } else if (infoEl) {
    infoEl.innerHTML = 'Limit vypnutý – použijú sa plné nastavenia modelu (MAX_TOKENS = ' + CONFIG.MAX_TOKENS + ').<br>' +
      'Všetky volania budú neobmedzené.';
  }
}

function saveCostSettings() {
  const enabledEl = document.getElementById('cost-limit-enabled');
  if (!enabledEl) return;

  CONFIG.MAX_COST_ENABLED = enabledEl.checked;

  hideAllModals();
  updateGlobalCostBar();

  const msg = CONFIG.MAX_COST_ENABLED
    ? '💰 Per-call limity aktívne'
    : '💰 Limity vypnuté – plný výkon';
  showToast(msg, 'success', 4000);
}

// ── Oprava: updateWebKBCounter pre Cloud-First ─────────────────
async function updateWebKBCounter() {
  try {
    const webCount = typeof getWebKBCount === 'function' ? await getWebKBCount() : 0;
    const webEl    = document.getElementById('counter-web-kb');
    if (webEl) {
      webEl.innerHTML     = `🌐 ${webCount} WEB záznamov`;
      webEl.style.display = webCount > 0 ? 'block' : 'none';
    }
  } catch {}
}
