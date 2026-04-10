// ============================================================
// DigiEDU AI Assistant – Google Apps Script Backend
// Code.gs  |  Nasadiť ako Web App: Execute as = Me, Access = Anyone
// ============================================================

const FOLDER_ID = '1rJ6EPAq-qddOqGjTjUwm2lWNDdU0Ix0A';
const KB_FILENAME = 'MAIN_KB.json';

// ── CORS helper ──────────────────────────────────────────────
function _corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Načítanie MAIN_KB.json zo Drive ─────────────────────────
function _readMainKB() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files  = folder.getFilesByName(KB_FILENAME);

  if (!files.hasNext()) {
    // Súbor neexistuje – vytvor prázdny
    const empty = JSON.stringify({ version: '1.0', updated_at: new Date().toISOString(), entries: [] });
    folder.createFile(KB_FILENAME, empty, MimeType.PLAIN_TEXT);
    return { version: '1.0', updated_at: new Date().toISOString(), entries: [] };
  }

  const file    = files.next();
  const content = file.getBlob().getDataAsString();
  try {
    return JSON.parse(content);
  } catch (e) {
    return { version: '1.0', updated_at: new Date().toISOString(), entries: [] };
  }
}

// ── Zápis MAIN_KB.json na Drive ─────────────────────────────
function _writeMainKB(data) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files  = folder.getFilesByName(KB_FILENAME);
  const json   = JSON.stringify(data, null, 2);

  if (files.hasNext()) {
    files.next().setContent(json);
  } else {
    folder.createFile(KB_FILENAME, json, MimeType.PLAIN_TEXT);
  }
}

// ── GET – vráť celý MAIN_KB ──────────────────────────────────
function doGet(e) {
  try {
    const kb = _readMainKB();
    return ContentService
      .createTextOutput(JSON.stringify(kb))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── POST – inteligentný merge záznamu ───────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Podporuje aj batch (pole záznamov) aj single záznam
    const incoming = Array.isArray(payload) ? payload : [payload];

    const kb = _readMainKB();
    if (!Array.isArray(kb.entries)) kb.entries = [];

    let added   = 0;
    let updated = 0;

    for (const record of incoming) {
      if (!record.record_id && !record.entry_id) continue;
      const rid = record.record_id || record.entry_id;
      // Zosúlad obidve ID polia
      record.record_id = rid;
      record.entry_id  = rid;

      const idx = kb.entries.findIndex(e => e.record_id === rid || e.entry_id === rid);

      if (idx >= 0) {
        const existing = kb.entries[idx];
        // Prepíš len ak je incoming novší (podľa updated_at)
        const existDt  = new Date(existing.updated_at || 0);
        const newDt    = new Date(record.updated_at   || 0);
        if (newDt >= existDt) {
          kb.entries[idx] = record;
          updated++;
        }
      } else {
        kb.entries.push(record);
        added++;
      }
    }

    kb.updated_at = new Date().toISOString();
    _writeMainKB(kb);

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        added,
        updated,
        total: kb.entries.length
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
