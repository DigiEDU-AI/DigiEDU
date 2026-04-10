// ============================================================
// DigiEDU – AI Engine (ai.js)
// Claude API + Demo fallback + WEB KB cache + Cost tracking
// ============================================================

// ── Session sledovanie nákladov ───────────────────────────────

let TOKEN_SESSION = {
  input_tokens:   0,
  output_tokens:  0,
  cost_usd:       0,
  calls:          0,
  web_calls:      0,      // koľko volaní šlo na web search API
  web_cache_hits: 0       // koľko krát WEB KB ušetrilo volanie
};

function updateTokenSession(usage, isWebSearch) {
  if (!usage) return;
  const cost = calcCost(usage);
  TOKEN_SESSION.input_tokens  += usage.input_tokens  || 0;
  TOKEN_SESSION.output_tokens += usage.output_tokens || 0;
  TOKEN_SESSION.cost_usd      += cost.total;
  TOKEN_SESSION.calls++;
  if (isWebSearch) TOKEN_SESSION.web_calls++;
  if (typeof updateGlobalCostBar === 'function') updateGlobalCostBar();
}

// ── Výpočet max_tokens – per-call limit podľa typu volania ────

function getAdaptedMaxTokens(estimatedInputTokens, callType) {
  const estIn = estimatedInputTokens || 1200;
  if (!CONFIG.MAX_COST_ENABLED) return CONFIG.MAX_TOKENS;
  const budget = (callType && CONFIG.COST_LIMITS[callType])
    ? CONFIG.COST_LIMITS[callType]
    : CONFIG.COST_LIMITS.round1;
  const inputCost = (estIn / 1_000_000) * CONFIG.PRICE_INPUT_PER_MTOK;
  const remaining = budget - inputCost;
  if (remaining <= 0) return 256;
  const maxOut = Math.floor((remaining * 1_000_000) / CONFIG.PRICE_OUTPUT_PER_MTOK);
  return Math.min(CONFIG.MAX_TOKENS, Math.max(256, maxOut));
}

// Vráti aktuálny KB/WEB pomer podľa počtu záznamov (3-tier adaptívny)
async function getKBWeight() {
  const total = await getTotalCasesCount();
  if (total < CONFIG.KB_REGIME_MID) return CONFIG.KB_WEIGHT_MIN;
  if (total < CONFIG.KB_REGIME_MAX) return CONFIG.KB_WEIGHT_MID;
  return CONFIG.KB_WEIGHT_MAX;
}

async function getKBRegimeLabel() {
  const total = await getTotalCasesCount();
  if (total < CONFIG.KB_REGIME_MID) return `Discovery (${total}/${CONFIG.KB_REGIME_MID}) – ${Math.round(CONFIG.KB_WEIGHT_MIN*100)}% KB`;
  if (total < CONFIG.KB_REGIME_MAX) return `Stabilizing (${total}/${CONFIG.KB_REGIME_MAX}) – ${Math.round(CONFIG.KB_WEIGHT_MID*100)}% KB`;
  return `Saturated (${total}) – ${Math.round(CONFIG.KB_WEIGHT_MAX*100)}% KB`;
}

// ── Claude API volanie ───────────────────────────────────────

async function callClaudeAPI(systemPrompt, userMessage, options) {
  options = options || {};
  if (!CONFIG.API_KEY || CONFIG.API_KEY.length < 10) {
    throw new Error('Chýba API kľúč');
  }
  const maxTok = options.maxTokens || getAdaptedMaxTokens(options.estimatedInputTokens, options.callType);

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CONFIG.API_MODEL,
      max_tokens: maxTok,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data  = await res.json();
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
  updateTokenSession(usage, false);
  return {
    text: data.content[0].text,
    usage
  };
}

// ── WEB SEARCH – štruktúrovaná extrakcia, dedup, merge, cache ─

async function searchWebWithCache(problemText, deviceName, category) {

  // 1. Cache hit
  const cached = await searchWebKB(problemText, category);
  if (cached) {
    TOKEN_SESSION.web_cache_hits++;
    if (typeof updateGlobalCostBar === 'function') updateGlobalCostBar();
    return { fromCache: true, content: cached, usage: null };
  }

  // 2. Web search cez Claude API
  if (!CONFIG.API_KEY || CONFIG.API_KEY.length < 10) {
    return { fromCache: false, content: null, usage: null };
  }

  const queryStr = [
    category   ? `${(CONFIG.CATEGORIES[category] || {}).name || category} problém` : '',
    deviceName ? `zariadenie ${deviceName}` : '',
    problemText
  ].filter(Boolean).join(' – ');

  // Limit tokenov platí aj pre web search volanie
  const webMaxTokens = CONFIG.MAX_COST_ENABLED
    ? getAdaptedMaxTokens(400, 'web_search')
    : (CONFIG.WEB_SEARCH_MAX_TOKENS || 1500);

  let webContent = null;
  let webUsage   = null;
  let webSources = [];

  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CONFIG.API_MODEL,
        max_tokens: webMaxTokens,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Si technický helpdesk asistent DigiEDU. Hľadáš riešenia technických problémov. Zhrň nájdené informácie po slovensky – konkrétne kroky, príkazy, nastavenia. Buď stručný a vecný.',
        messages: [{
          role: 'user',
          content: `Nájdi riešenia pre tento technický problém:\n${queryStr}\n\nChcem konkrétne kroky a príkazy.`
        }]
      })
    });

    if (res.ok) {
      const data   = await res.json();
      webUsage     = data.usage || null;
      const blocks = data.content || [];

      // Extrakcia textu (Claude syntéza)
      const textParts = blocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      // Extrakcia zdrojov zo všetkých blokov
      for (const block of blocks) {
        if (block.type === 'tool_result' || block.type === 'web_search_tool_result') {
          const items = Array.isArray(block.content) ? block.content : [];
          for (const item of items) {
            if (item.url || item.type === 'web_search_result') {
              webSources.push({
                url:     item.url   || '',
                title:   item.title || item.url || 'Zdroj',
                snippet: (item.snippet || item.text || '').slice(0, 300),
                age:     item.page_age || ''
              });
            }
          }
        }
      }

      if (textParts && textParts.length > 30) {
        webContent = textParts;

        // Deduplication: existuje podobný záznam?
        const existing = await findSimilarWebEntry(problemText);

        if (existing) {
          // Doplniť existujúci záznam
          await mergeWebEntry(
            existing, webContent, webSources,
            [category, deviceName, 'web-search'].filter(Boolean)
          );
          if (typeof updateWebKBCounter === 'function') updateWebKBCounter();
        } else {
          // Nový unikátny záznam
          const now = new Date().toISOString();
          const webEntryId = `WEB-RAW-${Date.now()}`;
          await saveWebKBEntry({
            entry_id:       webEntryId,
            record_id:      webEntryId,
            kb_set:         'DigiEDU_ServiceDesk_WEB_KB',
            record_type:    'raw_context',
            status:         'raw',
            version:        '1.0.0',
            language:       'sk',
            source_type:    'web_search',
            promotion_state: 'candidate_created',
            candidate_target_kb_set: category ? (CONFIG.KB_SETS?.[category]?.folder || category) : null,
            source_trust_score: 0.75,
            query:        problemText,
            query_full:   queryStr,
            category:     category   || 'OTHER',
            device:       deviceName || '',
            content:      webContent,
            sources:      webSources,
            source:       'claude-web-search',
            tags:         [category, deviceName, 'web-search'].filter(Boolean),
            created_at:   now,
            updated_at:   now,
            supplemented: 0
          });

          // Počítadlo → auto-export po 30
          const newCount = await incrementWebNewCount();
          if (typeof updateWebKBCounter === 'function') updateWebKBCounter();

          if (newCount >= (CONFIG.WEB_AUTO_EXPORT_THRESHOLD || 30)) {
            try {
              const blob  = await exportWebKBFile();
              const last  = await getWebLastExport();
              if (blob) triggerDownload(blob, buildWebExportFilename(last));
              await resetWebNewCount();
              if (typeof showToast === 'function')
                showToast(`🌐 WEB KB auto-export – ${CONFIG.WEB_AUTO_EXPORT_THRESHOLD} nových záznamov`, 'info', 5000);
            } catch (exportErr) {
              console.warn('WEB KB auto-export zlyhal:', exportErr.message);
            }
          }
        }
      }

      if (webUsage) updateTokenSession(webUsage, true);
    }
  } catch (err) {
    console.warn('Web search zlyhal:', err.message);
  }

  return { fromCache: false, content: webContent, usage: webUsage };
}

// ── Výpočet ceny tokenov ──────────────────────────────────────

function calcCost(usage) {
  if (!usage) return { input: 0, output: 0, total: 0 };
  const inp = (usage.input_tokens  || 0) * (CONFIG.PRICE_INPUT_PER_MTOK  / 1_000_000);
  const out = (usage.output_tokens || 0) * (CONFIG.PRICE_OUTPUT_PER_MTOK / 1_000_000);
  return { input: inp, output: out, total: inp + out };
}

// ── Extrahovanie JSON z AI odpovede ──────────────────────────

function parseAIJson(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[1] || match[0]); } catch {}
  }
  try { return JSON.parse(text); } catch {}
  return null;
}

// ── Systémový prompt pre AI ──────────────────────────────────

function buildSystemPrompt(category, round, kbContext, extraKBContext, webKBContext) {
  const catInfo = CONFIG.KB_SETS?.[category] || CONFIG.CATEGORIES?.[category] || { name: category };
  const kbSetName = catInfo.folder || `DigiEDU_ServiceDesk_${category}_KB`;
  const brainNote = 'DigiEDU_ServiceDesk_BRAIN_KB je vždy aktívna – použi jej komunikačný štýl a triage prístup.';
  return `Si skúsený technický helpdesk asistent DigiEDU (slovenský školský digitalizačný program).
Pomáhaš L1/L2/L3 technikom riešiť problémy v KB sete: ${kbSetName}.
${brainNote}
Odpovedáš VÝHRADNE po SLOVENSKY (technické názvy produktov môžu zostať v origináli).
Vždy odpovedáš iba validným JSON objektom, bez akéhokoľvek iného textu, komentárov ani markdown.

KB-first pravidlo: validovaná KB má vyššiu prioritu ako webové dáta.
Retrieval pomer závisí od nasýtenia KB (discovery 60/40, stabilizing 75/25, saturated 90/10).

${kbContext      ? `INTERNÁ KB [${kbSetName}]:\n${kbContext}\n`              : ''}
${extraKBContext ? `BRAIN/EXTRA KB [DigiEDU_ServiceDesk_BRAIN_KB]:\n${extraKBContext}\n` : ''}
${webKBContext   ? `WEB KB [DigiEDU_ServiceDesk_WEB_KB – enrichment]:\n${webKBContext}\n` : ''}

Kolo: ${round}. Buď praktický, konkrétny, akčný. Nie generický.`;
}

// ── KOLO 1 – prvá analýza problému ───────────────────────────

async function runRound1(caseState, kbContext, extraKBContext, webKBContext) {
  const catName = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const deviceInfo = caseState.device
    ? `\nZariadenie: ${caseState.device.name}\nP/N: ${caseState.device.pn}\nPopis: ${caseState.device.description}`
    : '';

  const userMsg = `Kategória: ${catName}
${deviceInfo}
Popis problému: ${caseState.problemText}

Vráť JSON v tomto presnom formáte:
{
  "analysis": {
    "what_it_means": "Stručný popis čo problém pravdepodobne znamená",
    "possible_causes": ["príčina 1", "príčina 2", "príčina 3"],
    "most_likely": "Najpravdepodobnejší scenár",
    "what_to_verify": ["bod 1", "bod 2", "bod 3"]
  },
  "main_recommendation": "POVINNÉ: Hlavná odporúčaná rada pre technika. Musí mať 500 až 1000 znakov. Musí byť konkrétna a šitá priamo na tento prípad. Obsah: prečo problém pravdepodobne nastal, čo je najdôležitejšie overiť ako prvé a prečo, aký je najpravdepodobnejší postup riešenia s vysvetlením logiky, na čo si dávať pozor pri diagnostike, aké riziká hrozia pri nesprávnom postupe. Nie generický text.",
  "steps": [
    "Krok 1: ...",
    "Krok 2: ...",
    "Krok 3: ...",
    "Krok 4: ...",
    "Krok 5: ..."
  ],
  "questions": [
    "Diagnostická otázka 1?",
    "Diagnostická otázka 2?",
    "Diagnostická otázka 3?",
    "Diagnostická otázka 4?",
    "Diagnostická otázka 5?"
  ],
  "quick_tips": [
    "Rýchly tip 1",
    "Rýchly tip 2",
    "Rýchly tip 3",
    "Rýchly tip 4",
    "Rýchly tip 5"
  ],
  "problem_summary": "Jednoriadkové zhrnutie problému",
  "cross_categories": []
}`;

  const sys = buildSystemPrompt(caseState.category, 1, kbContext, extraKBContext, webKBContext);

  try {
    const { text: raw, usage } = await callClaudeAPI(sys, userMsg, { callType: 'round1' });
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed, raw, usage };
    return { success: true, data: buildDemoRound1(caseState), raw, usage, demo: true };
  } catch (err) {
    console.warn('Claude API nedostupné, používam demo:', err.message);
    return { success: true, data: buildDemoRound1(caseState), demo: true, usage: null };
  }
}

// ── KOLO 2 – hlbšia analýza so spätnou väzbou ────────────────

async function runRound2(caseState, kbContext, extraKBContext, webKBContext) {
  const catName = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const deviceInfo = caseState.device
    ? `Zariadenie: ${caseState.device.name} (P/N: ${caseState.device.pn})\n` : '';

  const tipsSummary = (caseState.quickTips || []).map(
    t => `- ${t.tip}: ${t.state === 'helped' ? '✅ Pomohlo' : t.state === 'failed' ? '❌ Nepomohlo' : '○ Neskúšané'}`
  ).join('\n');

  const userMsg = `Kategória: ${catName}
${deviceInfo}Pôvodný problém: ${caseState.problemText}

Prvá analýza: ${caseState.round1Output?.problem_summary || ''}

Quick tipy – výsledky:
${tipsSummary}

Nové informácie od technika:
${caseState.techNotes || 'Žiadne nové informácie'}

Na základe všetkých informácií vytvor DETAILNEJŠIU druhú analýzu. Nezopakuj genericky to isté.
Zohľadni čo fungovalo, čo nie, a nové info.

Vráť JSON:
{
  "refined_analysis": "POVINNÉ: Detailná hlboká analýza 500 až 1000 znakov. Vysvetli čo naznačujú výsledky quick tipov, čo nové informácie menia v pohľade na problém, prečo sa zužuje okruh príčin práve na tento scenár, aký je logický sled ďalších krokov a prečo. Priamo použiteľná pre technika.",
  "key_finding": "Hlavný záver z nových informácií – jedna veta",
  "refined_steps": [
    "Konkrétny krok 1",
    "Konkrétny krok 2",
    "Konkrétny krok 3"
  ],
  "most_likely_solution": "Najpravdepodobnejšie riešenie na základe všetkých informácií",
  "what_to_avoid": ["Čo ďalej neskúšať"],
  "escalation_signal": "Kedy eskalovať ak toto nepomôže",
  "cross_categories": [],
  "suggested_tags": ["tag1", "tag2", "tag3"]
}`;

  const sys = buildSystemPrompt(caseState.category, 2, kbContext, extraKBContext, webKBContext);

  try {
    const { text: raw, usage } = await callClaudeAPI(sys, userMsg, { callType: 'round2' });
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed, raw, usage };
    return { success: true, data: buildDemoRound2(caseState), demo: true, usage };
  } catch (err) {
    console.warn('Claude API nedostupné:', err.message);
    return { success: true, data: buildDemoRound2(caseState), demo: true, usage: null };
  }
}

// ── KB záznam – AI generovanie ────────────────────────────────

async function generateKBEntry(caseState) {
  const catName = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const helped = (caseState.quickTips || []).filter(t => t.state === 'helped').map(t => t.tip);
  const failed = (caseState.quickTips || []).filter(t => t.state === 'failed').map(t => t.tip);

  const deviceInfo = caseState.device
    ? `Zariadenie: ${caseState.device.name} (P/N: ${caseState.device.pn})` : '';

  const ks     = CONFIG.KB_SETS?.[caseState.category];
  const kbSet  = ks?.folder || `DigiEDU_ServiceDesk_${caseState.category}_KB`;
  const recPfx = ks?.record_prefix || caseState.category;
  const userMsg = `Vytvor KB záznam pre uzatvorený prípad podľa DigiEDU KB štandardu (02_GLOBAL_SCHEMA.json).
Kategória: ${catName} | KB set: ${kbSet} | ID prefix: ${recPfx}
${deviceInfo}
Problém: ${caseState.problemText}
Stav: ${caseState.status}
Čo pomohlo (quick tipy): ${helped.join(', ') || 'nič z tipov'}
Čo nepomohlo: ${failed.join(', ') || 'nič z tipov'}
Reálne riešenie: ${caseState.actualFix || 'neuvedené'}
Poznámky technika: ${caseState.techNotes || 'žiadne'}
Dôvod eskalácie: ${caseState.escalationReason || 'N/A'}

Vráť JSON v tomto PRESNOM formáte (všetky polia povinné):
{
  "record_type": "issue_resolution",
  "kb_set": "${kbSet}",
  "title": "Výstižný názov problému (krátky, max 100 znakov)",
  "problem_summary": "Jednoriadkové zhrnutie problému",
  "professional_article": "POVINNÉ 300-1000 znakov: Profesionálny článok – pomenuj problém, odlíš hypotézy, popíš overenia, odporúčaný postup, zakonči laickým zhrnutím. Bez marketingových viet.",
  "layman_summary": "Zrozumiteľné zhrnutie pre bežného používateľa (1-2 vety)",
  "root_causes": ["hlavná príčina 1", "možná príčina 2", "možná príčina 3"],
  "diagnostic_questions": ["diagnostická otázka 1?", "diagnostická otázka 2?", "diagnostická otázka 3?"],
  "hotfixes": ["rýchly fix 1", "rýchly fix 2", "rýchly fix 3"],
  "generated_user_questions": ["otázka používateľa 1?", "otázka používateľa 2?", "otázka používateľa 3?"],
  "generated_answers": ["odpoveď 1", "odpoveď 2", "odpoveď 3"],
  "faq_items": [
    {"question": "FAQ otázka 1?", "answer": "FAQ odpoveď 1"},
    {"question": "FAQ otázka 2?", "answer": "FAQ odpoveď 2"},
    {"question": "FAQ otázka 3?", "answer": "FAQ odpoveď 3"},
    {"question": "FAQ otázka 4?", "answer": "FAQ odpoveď 4"},
    {"question": "FAQ otázka 5?", "answer": "FAQ odpoveď 5"}
  ],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "synonyms": ["synonymum1", "synonymum2", "synonymum3"],
  "related_kb_sets": [],
  "priority": "low|medium|high|critical",
  "confidence_score": 0.85,
  "change_note": "Prvý záznam vytvorený z prípadu"
}`;

  const sys = `Si knowledge base kurátor pre DigiEDU helpdesk.
Generuješ KB záznamy v slovenčine. Odpovedáš iba validným JSON.`;

  try {
    const { text: raw } = await callClaudeAPI(sys, userMsg, { callType: 'kb_gen' });
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed };
  } catch (err) {
    console.warn('KB generovanie cez API zlyhalo:', err.message);
  }
  return { success: true, data: buildDemoKBEntry(caseState), demo: true };
}

// ── EXTRA KB – spracovanie externého obsahu ───────────────────

async function processExtraKBContent(rawContent) {
  const sys = `Si knowledge base kurátor pre DigiEDU.
Spracúvaš externý obsah a konvertuješ ho na štruktúrovanú EXTRA KB.
Odpovedáš iba validným JSON.`;

  const userMsg = `Naštuduj tento externý obsah a vytvor z neho EXTRA KB záznamy:

${rawContent.slice(0, 8000)}

Vráť JSON:
{
  "entries": [
    {
      "entry_id": "EXTRA-001",
      "topic": "Téma záznamu",
      "content": "Obsah – poznatky, postupy, informácie",
      "tags": ["tag1", "tag2"],
      "source": "Externý dokument",
      "language": "sk"
    }
  ]
}`;

  try {
    const { text: raw } = await callClaudeAPI(sys, userMsg);
    const parsed = parseAIJson(raw);
    if (parsed?.entries) return { success: true, entries: parsed.entries };
  } catch (err) {
    console.warn('EXTRA KB spracovanie zlyhalo:', err.message);
  }
  return { success: false, entries: [] };
}



// ── Gramatická oprava záverečného textu (Úloha 5) ────────────

async function runGrammarCorrection(text, category, status) {
  if (!text || text.length < 5) return { success: false, corrected: text };

  const statusLabel = {
    resolved: 'vyriešený prípad – záverečné vyjadrenie čo fungovalo',
    unresolved: 'nevyriešený prípad – popis čo ostalo otvorené',
    escalated: 'eskalovaný prípad – dôvod eskalácie v čistej forme'
  };

  const catName = (CONFIG.CATEGORIES[category] || {}).name || category;
  const context = statusLabel[status] || 'uzatvorenie prípadu';

  const sys = `Si jazykový korektor pre DigiEDU helpdesk.
Oprav gramatiku a sformuluj text do ucelenej vety/odstavca.
Kontext: ${catName}, ${context}.
Odpovedáš iba opraveným textom, bez úvodu, bez vysvetlenia, bez JSON.`;

  const userMsg = `Oprav a sformuluj tento text technika do profesionálnej formy:

"${text}"

Požiadavky:
- Oprav pravopis a gramatiku
- Sformuluj do ucelenej vety/odstavca
- Zachovaj technický obsah a fakty
- Kontext: ${context}
- Jazyk: slovenčina`;

  try {
    const { text: corrected, usage } = await callClaudeAPI(sys, userMsg, {
      callType: 'grammar',
      estimatedInputTokens: 300
    });
    return { success: true, corrected: corrected.trim(), usage };
  } catch (err) {
    console.warn('Gramatická oprava zlyhala:', err.message);
    return { success: false, corrected: text };
  }
}

// ── Demo fallback výstupy ─────────────────────────────────────

function buildDemoRound1(cs) {
  const cat = cs.category;
  const demos = {
    HW: {
      analysis: {
        what_it_means: 'Hardvérový problém môže súvisieť s ovládačmi, fyzickým poškodením alebo konfiguráciou zariadenia.',
        possible_causes: ['Zastaraný alebo poškodený ovládač', 'Fyzické poškodenie komponentu', 'Nesprávna konfigurácia v BIOS/UEFI'],
        most_likely: 'Najčastejšou príčinou u školských zariadení DigiEDU sú zastaralé ovládače alebo nesprávna konfigurácia po aktualizácii OS.',
        what_to_verify: ['Verzia ovládača v Správcovi zariadení', 'Fyzický stav konektora/kábla', 'Nastavenia v BIOS', 'Posledná úspešná konfigurácia']
      },
      main_recommendation: 'Hardvérové problémy so zariadeniami DigiEDU majú najčastejšie korene v konflikte ovládačov po aktualizácii Windows alebo v poškodenom fyzickom prepojení. Ako prvý krok odporúčam otvoriť Správcu zariadení (devmgmt.msc) a skontrolovať, či sa pri dotknutom zariadení nezobrazuje žltý výkričník – tento príznak jednoznačne ukazuje na problém s ovládačom. Ak áno, kliknite pravým tlačidlom a zvoľte Aktualizovať ovládač. Ak aktualizácia nepomôže, stiahnite ovládač priamo zo stránky výrobcu podľa presného modelu. Pri fyzických komponentoch (USB, HDMI) vždy skontrolujte viditeľné poškodenie konektora a skúste iný port. Dôležité: pri zariadeniach DigiEDU so zárukou nevykonávajte fyzický zásah do vnútra – môže to porušiť záručné podmienky. Ak diagnostika nevedie k výsledku do 20 minút, prípad eskalujte na L2 s kompletnou dokumentáciou.',
      steps: [
        'Krok 1: Otvorte Správcu zariadení (devmgmt.msc) a skontrolujte žlté výkričníky',
        'Krok 2: Aktualizujte alebo preinštalujte príslušný ovládač',
        'Krok 3: Reštartujte zariadenie a overte stav',
        'Krok 4: Skontrolujte fyzické prepojenia a káble',
        'Krok 5: Vykonajte diagnostiku zariadenia cez nástroj výrobcu'
      ],
      questions: [
        'Kedy presne sa problém prvýkrát objavil – po aktualizácii, páde alebo spontánne?',
        'Zobrazuje sa chybová správa? Ak áno, aký je presný text?',
        'Bolo zariadenie nedávno presunuté alebo fyzicky manipulované?',
        'Funguje zariadenie správne na inom počítači/porte?',
        'Bol nainštalovaný nejaký nový softvér alebo aktualizácia pred problémom?'
      ],
      quick_tips: [
        'Reštartovať zariadenie a skúsiť znovu',
        'Odpojiť a znovu pripojiť zariadenie / kábel',
        'Skúsiť iný USB/HDMI port',
        'Spustiť Poradcu pri riešení problémov (troubleshooter)',
        'Overiť zariadenie na inom počítači'
      ],
      problem_summary: 'Hardvérový problém s ' + (cs.device?.name || 'zariadením'),
      cross_categories: []
    },
    '365': {
      analysis: {
        what_it_means: 'Problém s Microsoft 365 môže súvisieť s licenciou, autentifikáciou alebo konfiguráciou klienta.',
        possible_causes: ['Expirovaná alebo nepriradenosť licencie A3', 'Problém s autentifikáciou cez Entra ID', 'Poškodený profil alebo cache Office'],
        most_likely: 'Najčastejší problém v školskom prostredí je s priradením licencie A3 v Microsoft 365 Admin Center alebo s Entra ID autentifikáciou.',
        what_to_verify: ['Stav licencie v Admin Center', 'Prihlásenie do portal.office.com', 'Verzia Office klienta', 'Entra ID / conditional access politiky']
      },
      main_recommendation: 'Problémy s Microsoft 365 v školskom prostredí DigiEDU sú najčastejšie spôsobené nesprávnym priradením licencie A3 alebo výpadkom autentifikácie cez Entra ID. Prvý krok diagnostiky by mal byť overenie, či sa používateľ vôbec dokáže prihlásiť na portal.office.com – ak áno, problém je klientský (inštalácia, cache, profil), ak nie, problém je na strane licencie alebo identity. V Microsoft 365 Admin Center skontrolujte sekciu Používatelia, či má daný účet priradenú platnú licenciu A3 a či nie je účet zablokovaný. Entra ID Sign-in logs ukážu presný dôvod zlyhania vrátane Conditional Access politík. Pri klientských problémoch je Quick Repair zvyčajne rýchlejší než Online Repair. Pozor: ak problém postihuje viacerých používateľov naraz, overte status.office.com pred ďalšou diagnostikou – môže ísť o výpadok Microsoft služby.',
      steps: [
        'Krok 1: Prihláste sa na portal.office.com a overte stav účtu',
        'Krok 2: V Admin Center skontrolujte priradenie licencie A3 pre používateľa',
        'Krok 3: Spustite diagnostiku Sign-in logs v Entra ID',
        'Krok 4: Vykonajte Office repair (Quick Repair / Online Repair)',
        'Krok 5: Odhlásenie a opätovné prihlásenie do Office aplikácií'
      ],
      questions: [
        'Dostáva používateľ chybovú správu? Aký je presný text?',
        'Týka sa problém všetkých aplikácií M365 alebo len jednej?',
        'Funguje prístup cez webový prehliadač (office.com)?',
        'Bol účet nedávno vytvorený alebo zmenený?',
        'Vyskytuje sa problém na všetkých zariadeniach alebo len na jednom?'
      ],
      quick_tips: [
        'Odhlásiť a prihlásiť sa v Office aplikáciách',
        'Vymazať credentials v Windows Credential Manager',
        'Spustiť Office Quick Repair',
        'Overiť stav licencie na portal.office.com',
        'Reštartovať PC a skúsiť znovu'
      ],
      problem_summary: 'Problém s Microsoft 365 / Office aplikáciami',
      cross_categories: []
    },
    WIFI: {
      analysis: {
        what_it_means: 'WIFI problém môže byť na strane klienta, access pointu, DHCP alebo autentifikácie.',
        possible_causes: ['Problém s DHCP priradením IP', 'Nesprávna konfigurácia SSID / WPA2-Enterprise', 'Slabý signál alebo rušenie', 'Problém s ovládačom WiFi adaptéra'],
        most_likely: 'Najčastejší problém v školskej sieti je s autentifikáciou WPA2-Enterprise alebo DHCP v preplnenej sieti.',
        what_to_verify: ['IP adresa zariadenia (ipconfig)', 'Sila signálu', 'SSID ku ktorému sa pripája', 'Certifikát pre WPA-Enterprise']
      },
      main_recommendation: 'WiFi problémy v školskej sieti DigiEDU majú typicky tri úrovne: klient (zariadenie), sieťová infraštruktúra (AP, switch, DHCP) a autentifikácia (WPA2-Enterprise, certifikáty). Ako prvý krok spustite ipconfig /all a overte, či zariadenie dostáva IP adresu z DHCP – ak dostáva 169.254.x.x, DHCP nefunguje a problém je sieťový. Ak IP je správna ale internet nefunguje, spustite ping 8.8.8.8 a ping na default gateway. Školské siete s WPA2-Enterprise sú citlivé na platnosť certifikátov a systémový čas – overte čas a dátum na zariadení. Zabudnutie a opätovné prihlásenie na SSID rieši väčšinu klientských problémov. Ak problém nastáva len na určitom mieste, pravdepodobne ide o dosah AP. Skontrolujte, či rovnaký problém nepostihuje viac zariadení – ak áno, kontaktujte sieťového administrátora.',
      steps: [
        'Krok 1: Spustite ipconfig /all a zaznamenajte IP adresu a DNS',
        'Krok 2: Zabudnite sieť a pripojte sa znovu',
        'Krok 3: Skúste ping na default gateway a 8.8.8.8',
        'Krok 4: Skontrolujte silu signálu a vzdialenosť od AP',
        'Krok 5: Overte nastavenia WiFi ovládača v Správcovi zariadení'
      ],
      questions: [
        'Nedokáže sa pripojiť vôbec alebo sa odpojuje?',
        'Dostáva IP adresu (vidí DHCP pridelenie)?',
        'Funguje iné zariadenie na rovnakom mieste?',
        'Vyskytuje sa problém na konkrétnom SSID alebo na všetkých?',
        'Aká autentifikačná metóda je nakonfigurovaná (PSK / Enterprise)?'
      ],
      quick_tips: [
        'Vypnúť a zapnúť WiFi adaptér',
        'Reštartovať zariadenie',
        'Zabudnúť sieť a pripojiť sa znovu',
        'Spustiť: netsh wlan delete profile name=*',
        'Overiť čas a dátum – certifikáty sú citlivé'
      ],
      problem_summary: 'Problém s WiFi pripojením',
      cross_categories: []
    },
    ADMIN: {
      analysis: {
        what_it_means: 'Administratívny prípad si vyžaduje procesné alebo dokumentačné riešenie.',
        possible_causes: ['Chýbajúce dokumenty alebo schválenia', 'Procesná nejasnosť', 'Chyba v systéme alebo evidencii'],
        most_likely: 'Väčšina administratívnych prípadov vyžaduje overenie v systéme a súčinnosť so zodpovednou osobou.',
        what_to_verify: ['Stav žiadosti v systéme', 'Schvaľovací postup', 'Zodpovedná osoba']
      },
      main_recommendation: 'Administratívne prípady DigiEDU si vyžadujú systematický prístup s jasnou dokumentáciou každého kroku. Ako prvé overte stav prípadu v relevantnom systéme a identifikujte, v ktorej fáze procesu sa nachádza. Dôležité je zistiť, kto je aktuálne zodpovedná osoba a či bola informovaná. Zaznamenajte všetky doterajšie kroky vrátane dátumov a mien kontaktovaných osôb – táto dokumentácia je kľúčová pre prípadnú eskaláciu. Ak ide o záručný alebo majetkový prípad DigiEDU, overte dostupnosť potrebných dokladov (protokol o prevzatí, záručný list, inventárne číslo). Stanovte si interný deadline a pri absencii odpovede do 24 hodín automaticky eskalujte. Všetku komunikáciu veďte písomne pre prípadný audit a zachovajte kópie všetkej dokumentácie.',
      steps: [
        'Krok 1: Overte stav prípadu v relevantnom systéme',
        'Krok 2: Identifikujte zodpovednú osobu alebo oddelenie',
        'Krok 3: Zaznamenajte všetky doterajšie kroky s dátumami',
        'Krok 4: Komunikujte písomne s príslušnou stranou',
        'Krok 5: Zdokumentujte výsledok a archivujte'
      ],
      questions: [
        'Kedy presne nastal problém alebo bola podaná žiadosť?',
        'Aké kroky boli doteraz vykonané?',
        'Kto je zodpovedná osoba pre tento prípad?',
        'Existuje deadline alebo urgentnosť?',
        'Akú dokumentáciu máte k dispozícii?'
      ],
      quick_tips: [
        'Overiť stav v systéme',
        'Kontaktovať zodpovednú osobu',
        'Skontrolovať e-mailovú komunikáciu',
        'Overiť procesné dokumenty',
        'Eskalovať ak nie je reakcia do 24h'
      ],
      problem_summary: 'Administratívny prípad vyžadujúci procesné riešenie',
      cross_categories: []
    },
    OTHER: {
      analysis: {
        what_it_means: 'Problém nepatrí do štandardných kategórií a vyžaduje individuálny prístup.',
        possible_causes: ['Kombinácia viacerých faktorov', 'Neštandardná konfigurácia', 'Neznámy zdroj problému'],
        most_likely: 'Vyžaduje hlbšiu diagnostiku a prípadne eskaláciu na špecialistu.',
        what_to_verify: ['Presný popis problému', 'Kedy sa objavil', 'Reprodukovateľnosť', 'Dotknuté systémy']
      },
      main_recommendation: 'Pri neštandardných prípadoch DigiEDU, ktoré nezapadajú do bežných kategórií, je kľúčové systematické zdokumentovanie pred akýmkoľvek zásahom. Presne zaznamenajte symptómy, kedy a za akých podmienok nastávajú, a či je problém reprodukovateľný. Overte, či problém postihuje jedno zariadenie alebo viacero – to pomôže odlíšiť hardvérový defekt od systémovej alebo sieťovej príčiny. Skontrolujte systémové logy v Event Vieweri vo Windows (hľadajte chyby a varovania v časovom okne výskytu problému). Porovnajte stav dotknutého zariadenia s fungujúcim zariadením rovnakého typu. Ak sa nedarí identifikovať príčinu do 30 minút aktívnej diagnostiky, eskalujte na L2 alebo L3 s kompletnou dokumentáciou doterajšieho postupu vrátane všetkého skúšaného.',
      steps: [
        'Krok 1: Presne zdokumentujte symptómy a kedy nastávajú',
        'Krok 2: Overte reprodukovateľnosť problému',
        'Krok 3: Skontrolujte Event Viewer logy',
        'Krok 4: Porovnajte s fungujúcim zariadením rovnakého typu',
        'Krok 5: Zvážte eskaláciu ak problém pretrváva >30 min'
      ],
      questions: [
        'Vedeli by ste problém reprodukovať (zopakovať)?',
        'Kedy presne sa prvýkrát objavil?',
        'Týka sa viacerých používateľov alebo len jedného?',
        'Nastáva vždy alebo príležitostne?',
        'Boli vykonané nedávno nejaké zmeny v systéme?'
      ],
      quick_tips: [
        'Reštartovať všetky dotknuté systémy',
        'Skontrolovať Event Viewer logy',
        'Overiť nastavenia',
        'Porovnať s iným podobným prípadom',
        'Kontaktovať výrobcu / support'
      ],
      problem_summary: 'Neštandardný prípad vyžadujúci individuálnu diagnostiku',
      cross_categories: []
    }
  };
  return demos[cat] || demos.OTHER;
}

function buildDemoRound2(cs) {
  const helped = (cs.quickTips || []).filter(t => t.state === 'helped').map(t => t.tip);
  const failed = (cs.quickTips || []).filter(t => t.state === 'failed').map(t => t.tip);
  return {
    refined_analysis: `Na základe nových informácií od technika a výsledkov quick tipov ${
      helped.length ? `(pomohlo: ${helped.join(', ')})` : '(žiadny tip nepomohol)'
    } sa diagnostika výrazne zužuje. ${cs.techNotes ? 'Nové informácie od technika menia pohľad na príčinu a naznačujú konkrétnejší scenár. ' : ''}${
      helped.length
        ? `Skutočnosť, že "${helped[0]}" pomohlo, potvrdzuje, že problém má softvérovú alebo konfiguračnú povahu – nie hardvérovú. To znamená, že nie je potrebná fyzická výmena komponentu, ale dôkladné overenie nastavení a ich prípadná obnova do funkčného stavu. Odporúčam aplikovať tento postup dôsledne, overiť stabilitu po reštarte a sledovať, či sa problém neobjaví znovu. Ak sa problém vráti, je to signál hlbšieho systémového problému.`
        : `Keďže žiadny z quick tipov nepomohol, problém je pravdepodobne hlbší než bežná konfiguračná chyba. Je potrebné zvážiť buď hlbší systémový zásah (reinstallácia ovládačov, reset nastavení) alebo eskaláciu na L2/L3 techniku s kompletnou dokumentáciou toho, čo bolo skúšané a s akým výsledkom.`
    }`,
    key_finding: helped.length
      ? `Úspešný postup "${helped[0]}" naznačuje konfiguračnú/softvérovú príčinu.`
      : 'Problém vyžaduje hlbší zásah alebo eskaláciu – quick tipy nezabrali.',
    refined_steps: [
      helped.length
        ? `Krok 1: Aplikujte postup "${helped[0]}" dôsledne a overte úplný efekt`
        : 'Krok 1: Pripravte kompletný popis pre L2 eskaláciu',
      'Krok 2: Overte dlhodobú stabilitu po reštarte zariadenia',
      'Krok 3: Zdokumentujte kompletný postup vrátane výsledkov do KB záznamu',
      failed.length ? `(PRESKOČIŤ – nepomáha: ${failed.slice(0,2).join(', ')})` : 'Krok 4: Overte všetky súvisiace systémy'
    ].filter(Boolean),
    most_likely_solution: helped.length
      ? `Postup "${helped[0]}" je základom riešenia – aplikujte dôsledne a potvrďte stabilitu.`
      : 'Odporúčam eskaláciu na L2/L3 alebo kontakt s výrobcom.',
    what_to_avoid: failed,
    escalation_signal: 'Eskalujte ak problém pretrváva po ďalšom reštarte alebo ak sa objaví nová chybová správa.',
    cross_categories: [],
    suggested_tags: [cs.category.toLowerCase(), 'troubleshooting', 'digiedu']
  };
}

function buildDemoKBEntry(cs) {
  const cat = cs.category;
  const devName = cs.device?.name || 'zariadenie';
  return {
    title: `${cat} problém – ${devName}`,
    problem_summary: `${cat} problém – ${devName}: ${(cs.problemText || '').slice(0, 80)}`,
    professional_article: `Problém v kategórii ${cat} sa týka zariadenia ${devName}. Na základe diagnostiky boli identifikované možné príčiny: konfiguračná chyba, zastaralý ovládač alebo hardvérový defekt. Prvým krokom je overenie základnej funkčnosti – reštart zariadenia a kontrola logov. Ak problém pretrváva, odporúčame aktualizáciu ovládačov a kontrolu nastavení. V prípade hardvérovej príčiny je potrebná fyzická diagnostika alebo výmena komponentu. Zhrnutie pre používateľa: zariadenie bolo diagnostikované a bol navrhnutý postup riešenia.`,
    layman_summary: `Problém so zariadením ${devName} bol diagnostikovaný. Postupujte podľa odporúčaných krokov.`,
    root_causes: ['Konfiguračná alebo softvérová chyba', 'Zastaralý ovládač alebo firmware', 'Možný hardvérový defekt'],
    diagnostic_questions: ['Kedy sa problém prvýkrát objavil?', 'Boli vykonané nedávne zmeny v systéme?', 'Vyskytuje sa problém opakovane?'],
    hotfixes: ['Reštartovať zariadenie', 'Aktualizovať ovládače/firmware', 'Obnoviť predvolené nastavenia'],
    generated_user_questions: ['Ako vyriešiť tento problém?', 'Čo mám skontrolovať ako prvé?', 'Kedy mám kontaktovať techniku?'],
    generated_answers: ['Postupujte podľa diagnostického postupu v KB zázname.', 'Skontrolujte základné pripojenia a reštartujte zariadenie.', 'Ak problém pretrváva po 2 pokusoch o opravu, kontaktujte L2 techniku.'],
    faq_items: [
      { question: 'Ako riešiť tento problém?', answer: 'Postupujte podľa štandardného diagnostického postupu.' },
      { question: 'Čo skontrolovať ako prvé?', answer: 'Základná diagnostika: reštart, logy, stav zariadenia.' },
      { question: 'Kedy eskalovať prípad?', answer: 'Po 2 kolách diagnostiky bez výsledku.' },
      { question: 'Ako zdokumentovať prípad?', answer: 'Vyplňte všetky polia KB záznamu.' },
      { question: 'Existuje preventívne opatrenie?', answer: 'Áno, pravidelná údržba a aktualizácie.' }
    ],
    tags: [cat.toLowerCase(), 'digiedu', 'helpdesk', 'troubleshooting', devName.toLowerCase().replace(/\s+/g, '-')],
    keywords: [cat.toLowerCase(), 'diagnostika', 'riešenie', devName.toLowerCase(), 'helpdesk'],
    synonyms: ['problém', 'chyba', 'porucha'],
    related_kb_sets: [],
    priority: 'medium',
    confidence_score: 0.7,
    change_note: 'Demo záznam – bez API'
  };
}
