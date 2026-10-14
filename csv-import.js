// csv-import.js — CSV parsing + row validation (spec §8)
// Small RFC-4180-ish parser: handles quotes, CRLF/LF, BOM.

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  out.push(cur);
  return out; // count includes the trailing field
}

// Returns { fatal } or { headers, rows } where rows = [{ rowNumber, values: {...}, errors: [] }]
function parseCsv(text) {
  text = stripBom(String(text)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return { fatal: 'File is empty' };
  const lines = text.split('\n');
  // detect unclosed quote on raw text
  let quotes = 0;
  for (const ch of text) if (ch === '"') quotes++;
  if (quotes % 2 !== 0) return { fatal: 'Malformed CSV: unclosed quote' };

  const headerCells = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const REQUIRED = ['question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct'];
  const OPTIONAL = ['position'];
  const missing = REQUIRED.filter(r => !headerCells.includes(r));
  if (missing.length) return { fatal: `Missing required header(s): ${missing.join(', ')}. Nothing was imported.` };
  const warnings = headerCells.filter(h => !REQUIRED.includes(h) && !OPTIONAL.includes(h));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue; // empty row: skipped silently
    const cells = parseCsvLine(raw).map(c => c.trim());
    const values = {};
    headerCells.forEach((h, idx) => { values[h] = cells[idx] !== undefined ? cells[idx] : ''; });
    const errors = [];
    if (cells.length !== headerCells.length)
      errors.push(`wrong column count (found ${cells.length}, expected ${headerCells.length})`);
    rows.push({ rowNumber: i + 1, values, errors });
  }
  if (rows.length > 500) return { fatal: 'Too many rows (max 500)' };
  return { headers: headerCells, rows, warnings };
}

// Row-level validation (spec §8.3) + duplicate check against DB.
// Returns { valid, skipped, errors, preview }
async function validateRows(pool, parsedRows, quizId) {
  const existing = new Set((await pool.query(
    'SELECT question_text FROM questions WHERE quiz_id=$1', [quizId])).rows.map(r => r.question_text.trim().toLowerCase()));
  const valid = [], skipped = [], errors = [];
  for (const r of parsedRows) {
    const v = r.values;
    const rowErrors = [...r.errors];
    const q = (v.question || '').trim();
    const choices = [v.choice_a, v.choice_b, v.choice_c, v.choice_d].map(c => (c || '').trim());
    const correct = (v.correct || '').trim().toUpperCase();

    if (!rowErrors.length) {
      if (q.length < 3 || q.length > 500) rowErrors.push('"question" must be 3-500 characters');
      for (let c = 0; c < 4; c++)
        if (choices[c].length < 1 || choices[c].length > 200) rowErrors.push(`"choice_${'abcd'[c]}" must be 1-200 characters`);
      if (!['A', 'B', 'C', 'D'].includes(correct)) rowErrors.push('"correct" must be A, B, C, or D');
      const lower = choices.map(c => c.toLowerCase());
      if (new Set(lower).size !== 4) rowErrors.push('duplicate choices within the row');
      if (v.position !== undefined && v.position !== '' && (!/^\d+$/.test(v.position) || +v.position < 1))
        rowErrors.push('"position" must be an integer >= 1');
    }

    if (rowErrors.length) {
      errors.push({ rowNumber: r.rowNumber, reason: rowErrors[0], allReasons: rowErrors });
      continue;
    }
    if (existing.has(q.toLowerCase())) {
      skipped.push({ rowNumber: r.rowNumber, reason: 'duplicate question text already in this quiz' });
      continue;
    }
    existing.add(q.toLowerCase());
    valid.push({
      rowNumber: r.rowNumber,
      question_text: q,
      choice_a: choices[0], choice_b: choices[1], choice_c: choices[2], choice_d: choices[3],
      correct_choice: correct.toLowerCase(),
      position: v.position ? +v.position : null,
    });
  }
  return {
    valid, skipped, errors,
    summary: { valid: valid.length, skipped: skipped.length, errors: errors.length },
    preview: valid.slice(0, 20),
    headerWarnings: parsedRows.warnings || [],
  };
}

module.exports = { parseCsv, validateRows };
