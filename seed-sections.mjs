const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables first.');
  process.exit(1);
}

const CORE_SECTIONS = [
  { post_type: 'supervisor', section_name: 'মোবাইল/ট্যাব চালু, লক-আনলক ও অ্যাপে লগইন', max_marks: 5, section_type: 'practical', section_order: 1 },
  { post_type: 'supervisor', section_name: 'গুগল ম্যাপ ব্যবহার', max_marks: 10, section_type: 'practical', section_order: 2 },
  { post_type: 'supervisor', section_name: 'শিক্ষাগত যোগ্যতা (জিপিএ নম্বরের দ্বিগুণ)', max_marks: 10, section_type: 'gpa', section_order: 3 },
  { post_type: 'supervisor', section_name: 'নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ', max_marks: 10, section_type: 'practical', section_order: 4 },
  { post_type: 'supervisor', section_name: 'গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ', max_marks: 10, section_type: 'practical', section_order: 5 },
  { post_type: 'supervisor', section_name: 'দৈনিক রিপোর্ট প্রদান মানসিকতা ও দক্ষতা', max_marks: 10, section_type: 'viva', section_order: 6 },
  { post_type: 'supervisor', section_name: 'দলনেতৃত্ব ও যোগাযোগ সক্ষমতা', max_marks: 10, section_type: 'viva', section_order: 7 },
  { post_type: 'supervisor', section_name: 'জরুরি পরিস্থিতি বা ক্রাইসিস মোকাবেলা সক্ষমতা', max_marks: 10, section_type: 'viva', section_order: 8 },
  { post_type: 'supervisor', section_name: 'আচার, আচরণ ও মৌখিক প্রশ্নোত্তর', max_marks: 25, section_type: 'viva', section_order: 9 },

  { post_type: 'counter', section_name: 'মোবাইল/ট্যাব চালু, লক-আনলক ও অ্যাপে লগইন', max_marks: 10, section_type: 'practical', section_order: 1 },
  { post_type: 'counter', section_name: 'শিক্ষাগত যোগ্যতা (জিপিএ নম্বরের দ্বিগুণ)', max_marks: 10, section_type: 'gpa', section_order: 2 },
  { post_type: 'counter', section_name: 'গুগল ম্যাপ ব্যবহার', max_marks: 10, section_type: 'practical', section_order: 3 },
  { post_type: 'counter', section_name: 'নমুনা তথ্য সঠিকভাবে অ্যাপে প্রবেশ', max_marks: 10, section_type: 'practical', section_order: 4 },
  { post_type: 'counter', section_name: 'গুগল ম্যাপে জিও-ট্যাগিং ও বাড়ির ছবি তোলা ও সংযুক্তকরণ', max_marks: 10, section_type: 'practical', section_order: 5 },
  { post_type: 'counter', section_name: 'জরুরি পরিস্থিতি বা ক্রাইসিস মোকাবেলা সক্ষমতা', max_marks: 10, section_type: 'viva', section_order: 6 },
  { post_type: 'counter', section_name: 'ডেটার গুরুত্ব ও তথ্যের নিরাপত্তা বিষয়ক ধারণা', max_marks: 15, section_type: 'viva', section_order: 7 },
  { post_type: 'counter', section_name: 'আচার, আচরণ ও মৌখিক প্রশ্নোত্তর', max_marks: 25, section_type: 'viva', section_order: 8 },
];

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${errorText}`);
  }

  if (response.status === 204) {
    return [];
  }

  const bodyText = await response.text();
  if (!bodyText.trim()) {
    return [];
  }

  return JSON.parse(bodyText);
}

function keyOf(row) {
  return `${row.post_type}::${row.section_name}`;
}

async function main() {
  const existing = await supabaseFetch('sections?select=post_type,section_name');
  const existingKeys = new Set((existing ?? []).map(keyOf));

  const missing = CORE_SECTIONS.filter((row) => !existingKeys.has(keyOf(row)));

  if (!missing.length) {
    console.log('Sections already seeded. No new rows inserted.');
    return;
  }

  await supabaseFetch('sections', {
    method: 'POST',
    body: JSON.stringify(missing),
    headers: {
      Prefer: 'return=minimal',
    },
  });

  console.log(`Inserted ${missing.length} section row(s).`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});