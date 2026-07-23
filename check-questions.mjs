const SUPABASE_URL = 'https://cgkjrvzruixqptzjdrqt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SoTTOLpWI9E2NNpYz6jN7A_maiSYwHL';

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

  return response.json();
}

async function checkQuestions() {
  console.log('=== Checking Sections ===');
  const sections = await supabaseFetch('sections?select=id,section_name,post_type&order=section_name.asc');
  console.log(`Found ${sections.length} sections:`);
  sections.forEach(s => console.log(`  - [${s.post_type}] ${s.section_name} (ID: ${s.id})`));

  console.log('\n=== Checking Questions ===');
  const questions = await supabaseFetch('questions?select=id,section_id,difficulty,question_text&order=section_id');
  console.log(`Found ${questions.length} questions:`);
  questions.forEach(q => console.log(`  - Section ID: ${q.section_id} | ${q.difficulty} | ${q.question_text.substring(0, 50)}...`));

  console.log('\n=== Questions by Section ===');
  const sectionMap = new Map(sections.map(s => [s.id, s.section_name]));
  const questionsBySection = {};
  questions.forEach(q => {
    const sectionName = sectionMap.get(q.section_id) || 'Unknown';
    if (!questionsBySection[sectionName]) {
      questionsBySection[sectionName] = [];
    }
    questionsBySection[sectionName].push(q);
  });

  Object.entries(questionsBySection).forEach(([sectionName, qs]) => {
    console.log(`\n${sectionName}: ${qs.length} questions`);
    qs.forEach(q => console.log(`  - ${q.difficulty}: ${q.question_text}`));
  });

  console.log('\n=== Checking specific section ID ===');
  const targetSectionId = 'b21fecdb-4881-48e6-849f-33ba307693e0';
  const targetSectionQuestions = await supabaseFetch(`questions?section_id=eq.${targetSectionId}&select=*`);
  console.log(`Questions for section ID ${targetSectionId}:`, targetSectionQuestions.length);
  if (targetSectionQuestions.length > 0) {
    targetSectionQuestions.forEach(q => console.log(`  - ${q.difficulty}: ${q.question_text}`));
  }

  console.log('\n=== Fixing: Copying questions from supervisor to counter for ALL sections ===');
  
  // Group sections by name
  const sectionsByName = new Map();
  sections.forEach(s => {
    if (!sectionsByName.has(s.section_name)) {
      sectionsByName.set(s.section_name, []);
    }
    sectionsByName.get(s.section_name).push(s);
  });

  let totalUpdated = 0;

  for (const [sectionName, sectionList] of sectionsByName) {
    if (sectionList.length < 2) continue; // Skip sections that don't have both counter and supervisor
    
    const counterSection = sectionList.find(s => s.post_type === 'counter');
    const supervisorSection = sectionList.find(s => s.post_type === 'supervisor');
    
    if (!counterSection || !supervisorSection) continue;
    
    const counterQuestions = await supabaseFetch(`questions?section_id=eq.${counterSection.id}&select=*`);
    const supervisorQuestions = await supabaseFetch(`questions?section_id=eq.${supervisorSection.id}&select=*`);
    
    console.log(`\n${sectionName}:`);
    console.log(`  Counter (${counterSection.id}): ${counterQuestions.length} questions`);
    console.log(`  Supervisor (${supervisorSection.id}): ${supervisorQuestions.length} questions`);
    
    // If counter has no questions but supervisor does, copy them
    if (counterQuestions.length === 0 && supervisorQuestions.length > 0) {
      console.log(`  Copying ${supervisorQuestions.length} questions from supervisor to counter...`);
      
      for (const q of supervisorQuestions) {
        await supabaseFetch(`questions?id=eq.${q.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ section_id: counterSection.id })
        });
      }
      totalUpdated += supervisorQuestions.length;
      console.log(`  Updated ${supervisorQuestions.length} questions`);
    } else {
      console.log(`  No action needed`);
    }
  }

  console.log(`\n=== Total questions updated: ${totalUpdated} ===`);
}

checkQuestions().catch(console.error);
