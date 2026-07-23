import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CSV_PATH = process.argv[2] ?? './questions-sample.csv';
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

const SECTION_NAME_ALIASES = new Map([
  ['গুগুল ম্যাপ ব্যবহার', 'গুগল ম্যাপ ব্যবহার'],
  ['নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ', 'নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ'],
  ['নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ (ডেটা এন্ট্রি)', 'নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ'],
  ['নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ (রি-চেক/যাচাই)', 'নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ'],
  ['গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ', 'গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ'],
  ['গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ', 'গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ'],
  ['গুগল ম্যাপে জিও-ট্যাগিং যাচাই ও বাড়ির ছবি', 'গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ'],
  ['ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারনা', 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা'],
  ['ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারনা', 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা'],
  ['ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা', 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা'],
  ['ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা', 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা'],
  ['আচার, আচরণ ও মৌখিক প্রশ্নোত্তর', 'আচার, আচরণ ও মৌখিক প্রশ্নোত্তর'],
  ['ইন্টারনেট, Google অ্যাকাউন্ট ও Play Store', 'মোবাইল/ট্যাব চালু, লক-আনলক ও অ্যাপে লগইন'],
  ['Chrome ব্রাউজার ও ফাইল ম্যানেজমেন্ট', 'মোবাইল/ট্যাব চালু, লক-আনলক ও অ্যাপে লগইন'],
  ['QR কোড, WhatsApp ও মোবাইল ব্যাংকিং', 'মোবাইল/ট্যাব চালু, লক-আনলক ও অ্যাপে লগইন'],
  ['নিরাপত্তা ও সাধারণ আইসিটি জ্ঞান (বোনাস)', 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা'],
]);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables first.');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }

      if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
      }

      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return dataRows
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? '').trim()])));
}

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

async function loadSections() {
  const sections = await supabaseFetch('sections?select=id,section_name&order=section_name.asc', {
    method: 'GET',
    headers: {
      Prefer: 'return=representation',
    },
  });

  return sections ?? [];
}

function canonicalSectionName(rawName) {
  const cleaned = String(rawName ?? '')
    .normalize('NFC')
    .trim()
    .replaceAll('বাড়ি', 'বাড়ি')
    .replaceAll('ধারনা', 'ধারণা');
  if (!cleaned) {
    return cleaned;
  }

  return SECTION_NAME_ALIASES.get(cleaned) ?? cleaned;
}

function normalizeDifficulty(rawDifficulty) {
  const value = String(rawDifficulty ?? '').trim().toLowerCase();
  if (!value) {
    return 'easy';
  }

  return VALID_DIFFICULTIES.has(value) ? value : 'easy';
}

async function insertQuestions(rows) {
  const sections = await loadSections();
  const sectionMap = new Map(sections.map((section) => [String(section.section_name).trim().toLowerCase(), section.id]));
  const unknownSections = new Map();

  const payload = rows.map((row, index) => {
    const sectionName = canonicalSectionName(row.section_name);
    const difficulty = normalizeDifficulty(row.difficulty);
    const questionText = String(row.question_text ?? '').trim();
    const sectionId = sectionMap.get(sectionName.toLowerCase());

    if (!sectionName || !difficulty || !questionText) {
      throw new Error(`Row ${index + 2} is missing one of: section_name, difficulty, question_text`);
    }

    if (!sectionId) {
      if (!unknownSections.has(sectionName)) {
        unknownSections.set(sectionName, []);
      }
      unknownSections.get(sectionName).push(index + 2);
      return null;
    }

    return {
      section_id: sectionId,
      difficulty,
      question_text: questionText,
    };
  });

  if (unknownSections.size) {
    const messageLines = ['Unknown section_name found. Add these sections first or update aliases:'];
    unknownSections.forEach((rowNumbers, name) => {
      messageLines.push(`- ${name} (rows: ${rowNumbers.join(', ')})`);
    });
    throw new Error(messageLines.join('\n'));
  }

  const filteredPayload = payload.filter(Boolean);

  await supabaseFetch('questions', {
    method: 'POST',
    body: JSON.stringify(filteredPayload),
    headers: {
      Prefer: 'return=minimal',
    },
  });
}

async function main() {
  const csvText = await fs.readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);

  if (!rows.length) {
    console.log('No CSV rows found.');
    return;
  }

  await insertQuestions(rows);
  console.log(`Inserted ${rows.length} question(s) from ${CSV_PATH}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});