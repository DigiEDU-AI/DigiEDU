// ============================================================
// DigiEDU AI Assistant – Konfigurácia v3.0
// API kľúč je chránený XOR obfuskáciou (base64-encoded chunks)
// ============================================================

const CONFIG = {

  // ── Cloud ─────────────────────────────────────────────────
  GAS_URL:     'https://script.google.com/macros/s/AKfycbwdukKIsCHRZalAPvqjavRWH2f1uVOa-aaKj7OHeKkFQwcZZdeqfNs6RERy4wU_RW4/exec',
  FOLDER_ID:   '1rJ6EPAq-qddOqGjTjUwm2lWNDdU0Ix0A',
  KB_FILENAME: 'MAIN_KB.json',

  // ── Claude API kľúč – XOR obfuskovaný, 3 časti ───────────
  // Dekóduje sa iba za behu cez _resolveKey()
  _k: [
    ['NwJKCCsweD44Pm8BHXdnBSUDGQt8EREMMzVxV3x3',   'DigiEDU_HW_2026'],
    ['EA0DMTtUHxASBVlrZAN9I1JEAxkvPAYORA49V1NdERUCOQU=', 'ServiceDesk_365'],
    ['JwV1fzYVLQYfPGtFWUlqeicFfClsIQQTHiwpAGp2AA51PnI2EwJ4Jg43cg==', 'WIFI_ADMIN_v3!!']
  ],

  // Rekonštrukcia kľúča za behu (volá sa lazy, iba keď treba)
  _resolveKey() {
    if (this.__resolved) return this.__resolved;
    this.__resolved = this._k.map(([enc, seed]) => {
      const sb  = [...seed].map(c => c.charCodeAt(0));
      const raw = atob(enc);
      return [...raw].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ sb[i % sb.length])).join('');
    }).join('');
    return this.__resolved;
  },

  get API_KEY() { return this._resolveKey(); },

  API_URL:    'https://api.anthropic.com/v1/messages',
  MAX_TOKENS: 4096,

  // ── Modely ───────────────────────────────────────────────
  MODELS: {
    sonnet: { id: 'claude-sonnet-4-6',        label: 'Sonnet', input: 3.00,  output: 15.00 },
    haiku:  { id: 'claude-haiku-4-5-20251001', label: 'Haiku',  input: 0.80,  output: 4.00  }
  },
  ACTIVE_MODEL: 'haiku',
  get API_MODEL()             { return this.MODELS[this.ACTIVE_MODEL].id;     },
  get PRICE_INPUT_PER_MTOK()  { return this.MODELS[this.ACTIVE_MODEL].input;  },
  get PRICE_OUTPUT_PER_MTOK() { return this.MODELS[this.ACTIVE_MODEL].output; },
  get MODEL_LABEL()           { return this.MODELS[this.ACTIVE_MODEL].label;  },

  // ── Admin heslo – SHA-256 hash "PearlJam22" ──────────────
  ADMIN_PASSWORD_HASH: 'e74e7dd00b36e0e477e19c6985d5a3c6be048e4ce5c8fec4e8a0c47e013343ec',
  IMPORT_PASSWORD:     '1234',

  // ── Adaptívny retrieval pomer ─────────────────────────────
  KB_WEIGHT_MIN:  0.60,
  KB_WEIGHT_MID:  0.75,
  KB_WEIGHT_MAX:  0.90,
  KB_REGIME_MID:  30,
  KB_REGIME_MAX:  100,

  // ── Per-call USD limity ───────────────────────────────────
  COST_LIMITS: {
    round1:     0.005,
    round2:     0.008,
    grammar:    0.001,
    kb_gen:     0.005,
    web_search: 0.004
  },
  MAX_COST_ENABLED: true,

  // ── Kategórie (UI) ────────────────────────────────────────
  CATEGORIES: {
    HW:    { name: 'HW Problém',              icon: '🖥️',  color: '#3b82f6', prefix: 'HW'    },
    '365': { name: '365 Problém',             icon: '☁️',  color: '#8b5cf6', prefix: 'M365'  },
    WIFI:  { name: 'WIFI Problém',            icon: '📡',  color: '#10b981', prefix: 'WIFI'  },
    ADMIN: { name: 'Administratívny Problém', icon: '📋',  color: '#f59e0b', prefix: 'ADMIN' },
    OTHER: { name: 'Iný problém',             icon: '❓',  color: '#ef4444', prefix: 'INE'   }
  },
  CATEGORY_KEYS: ['HW', '365', 'WIFI', 'ADMIN', 'OTHER'],

  // ── KB sety (Drive mená) ──────────────────────────────────
  KB_SETS: {
    HW:    { folder: 'DigiEDU_ServiceDesk_HW_KB',    record_prefix: 'HW',    domain: 'hw'    },
    '365': { folder: 'DigiEDU_ServiceDesk_365_KB',   record_prefix: 'M365',  domain: '365'   },
    WIFI:  { folder: 'DigiEDU_ServiceDesk_WIFI_KB',  record_prefix: 'WIFI',  domain: 'wifi'  },
    ADMIN: { folder: 'DigiEDU_ServiceDesk_ADMIN_KB', record_prefix: 'ADMIN', domain: 'admin' },
    OTHER: { folder: 'DigiEDU_ServiceDesk_INE_KB',   record_prefix: 'INE',   domain: 'ine'   },
    WEB:   { folder: 'DigiEDU_ServiceDesk_WEB_KB',   record_prefix: 'WEB',   domain: 'web'   },
    EXTRA: { folder: 'DigiEDU_ServiceDesk_BRAIN_KB', record_prefix: 'BRAIN', domain: 'brain' }
  },

  // ── IndexedDB ─────────────────────────────────────────────
  DB_NAME:    'DigiEDU_KB',
  DB_VERSION: 4,
  DB_STORES: ['main_kb', 'pending_sync', 'meta', 'topic_coverage', 'system_changelog'],

  // ── WEB KB ───────────────────────────────────────────────
  WEB_KB_MAX_AGE_DAYS:   30,
  WEB_KB_MIN_SCORE:       2,
  WEB_SEARCH_MAX_TOKENS: 1500,
  WEB_DEDUP_THRESHOLD:   0.45,

  PROMOTION: { auto_min_trust: 0.85, review_min_trust: 0.65 },

  // ── Helpers ───────────────────────────────────────────────
  getRecordPrefix(cat) {
    return this.KB_SETS[cat]?.record_prefix || cat;
  },
  getCategoryFromRecord(rec) {
    const kbSet = rec.kb_set || '';
    const id    = (rec.record_id || rec.entry_id || '').toUpperCase();
    for (const [key, ks] of Object.entries(this.KB_SETS)) {
      if (kbSet === ks.folder || kbSet === key) return key;
    }
    if (id.startsWith('HW-'))                              return 'HW';
    if (id.startsWith('M365-') || id.startsWith('365-'))  return '365';
    if (id.startsWith('WIFI-'))                            return 'WIFI';
    if (id.startsWith('ADMIN-'))                           return 'ADMIN';
    if (id.startsWith('INE-'))                             return 'OTHER';
    if (id.startsWith('WEB-'))                             return 'WEB';
    if (id.startsWith('BRAIN-'))                           return 'EXTRA';
    return rec.category || 'OTHER';
  }
};
