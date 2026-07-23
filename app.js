import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const statusEl = document.getElementById('connection-status');
const screenLogin = document.getElementById('screen-login');
const screenCandidate = document.getElementById('screen-candidate');
const screenSections = document.getElementById('screen-sections');
const examinerListEl = document.getElementById('examiner-list');
const candidateRollForm = document.getElementById('candidate-roll-form');
const rollNoInput = document.getElementById('roll-no-input');
const candidateMatchCard = document.getElementById('candidate-match-card');
const candidateNameEl = document.getElementById('candidate-name');
const candidatePostEl = document.getElementById('candidate-post');
const newCandidateForm = document.getElementById('new-candidate-form');
const newCandidateNameInput = document.getElementById('new-candidate-name');
const newCandidatePostSelect = document.getElementById('new-candidate-post');
const candidateSummaryEl = document.getElementById('candidate-summary');
const sectionListEl = document.getElementById('section-list');
const startButton = document.getElementById('start-button');
const screenEvaluation = document.getElementById('screen-evaluation');
const evaluationSummaryEl = document.getElementById('evaluation-summary');
const evaluationStatusEl = document.getElementById('evaluation-status');
const questionCardEl = document.getElementById('question-card');
const questionTextEl = document.getElementById('question-text');
const questionControlsEl = document.getElementById('question-controls');
const ratingGridEl = document.getElementById('rating-grid');
const directEntryToggle = document.getElementById('direct-entry-toggle');
const directEntryPanel = document.getElementById('direct-entry-panel');
const suggestedScoreInput = document.getElementById('suggested-score-input');
const scoreLabelEl = document.getElementById('score-label');
const scoreMethodText = document.getElementById('score-method-text');
const directScoreInput = document.getElementById('direct-score-input');
const lockSectionButton = document.getElementById('lock-section-button');
const nextCandidateButton = document.getElementById('next-candidate-button');

const storageKeys = {
  examinerId: 'evaluation_examiner_id',
  examinerName: 'evaluation_examiner_name',
  candidateId: 'evaluation_candidate_id',
  candidateRollNo: 'evaluation_candidate_roll_no',
  selectedSectionIds: 'evaluation_selected_section_ids',
};

const state = {
  examiners: [],
  candidate: null,
  sections: [],
  selectedSectionIds: [],
  activeSectionIndex: 0,
  activeSection: null,
  activeQuestion: null,
  activeDifficulty: 'easy',
  lastRating: null,
  directEntry: false,
  sectionResults: [],
};

const hasConfig =
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

const supabase = hasConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (statusEl) {
  statusEl.textContent = hasConfig ? 'Supabase configured' : 'Add Supabase credentials in config.js';
}

function showScreen(activeScreen) {
  [screenLogin, screenCandidate, screenSections].forEach((screen) => {
    if (!screen) {
      return;
    }
    screen.classList.toggle('active', screen === activeScreen);
    screen.classList.toggle('hidden', screen !== activeScreen);
  });
}

function setDisplay(element, shouldShow) {
  if (!element) {
    return;
  }
  element.classList.toggle('hidden', !shouldShow);
}

function readStoredValue(key) {
  return localStorage.getItem(key);
}

function writeStoredValue(key, value) {
  localStorage.setItem(key, value);
}

function clearStoredValue(key) {
  localStorage.removeItem(key);
}

function getStoredSelectedSections() {
  try {
    const rawValue = readStoredValue(storageKeys.selectedSectionIds);
    return rawValue ? JSON.parse(rawValue) : [];
  } catch {
    return [];
  }
}

function saveSelectedSections(sectionIds) {
  writeStoredValue(storageKeys.selectedSectionIds, JSON.stringify(sectionIds));
}

function clearEvaluationState() {
  state.activeSectionIndex = 0;
  state.activeSection = null;
  state.activeQuestion = null;
  state.activeDifficulty = 'easy';
  state.lastRating = null;
  state.directEntry = false;
  state.sectionResults = [];

  if (directEntryToggle) {
    directEntryToggle.checked = false;
  }

  if (directEntryPanel) {
    directEntryPanel.classList.add('hidden');
  }

  if (questionControlsEl) {
    questionControlsEl.classList.remove('hidden');
  }

  if (lockSectionButton) {
    lockSectionButton.classList.remove('hidden');
    lockSectionButton.disabled = false;
  }

  if (nextCandidateButton) {
    nextCandidateButton.classList.add('hidden');
  }

  if (evaluationStatusEl) {
    evaluationStatusEl.textContent = '';
  }
}

function setEvaluationStatus(message) {
  if (evaluationStatusEl) {
    evaluationStatusEl.textContent = message;
  }
}

function showEvaluationScreen() {
  renderCandidateSummary();
  renderSectionChecklist();
  showScreen(screenEvaluation);
}

function getSelectedSectionsInOrder() {
  return state.sections.filter((section) => state.selectedSectionIds.includes(section.id));
}

function getCurrentSection() {
  const sections = getSelectedSectionsInOrder();
  return sections[state.activeSectionIndex] ?? null;
}

function getExaminerId() {
  const value = readStoredValue(storageKeys.examinerId);
  return value || null;
}

function getCandidateId() {
  const value = readStoredValue(storageKeys.candidateId);
  return value || null;
}

function isPracticalSection(section) {
  return section?.section_type === 'practical';
}

async function practicalSectionAlreadyAssigned({ candidateId, sectionId, examinerId }) {
  const { data, error } = await supabase
    .from('marks')
    .select('examiner_id')
    .eq('candidate_id', candidateId)
    .eq('section_id', sectionId)
    .not('score', 'is', null);

  if (error) {
    throw error;
  }

  const existing = data ?? [];
  if (!existing.length) {
    return false;
  }

  return existing.some((row) => String(row.examiner_id) !== String(examinerId));
}

function getSuggestedScoreFromOutcome(outcome) {
  const maxMarks = Number(state.activeSection?.max_marks ?? 0);
  const difficulty = outcome.difficulty;
  const rating = outcome.rating;

  let percentage = 0;

  if (difficulty === 'easy' && rating === 'bad') {
    percentage = 25;
  } else if (difficulty === 'easy' && rating === 'average') {
    percentage = 30;
  } else if (difficulty === 'easy' && ['good', 'excellent'].includes(rating)) {
    percentage = 40;
  } else if (difficulty === 'medium' && ['bad', 'average'].includes(rating)) {
    percentage = 40;
  } else if (difficulty === 'medium' && ['good', 'excellent'].includes(rating)) {
    percentage = 70;
  } else if (difficulty === 'hard' && ['bad', 'average'].includes(rating)) {
    percentage = 70;
  } else if (difficulty === 'hard' && rating === 'good') {
    percentage = 90;
  } else if (difficulty === 'hard' && rating === 'excellent') {
    percentage = 100;
  }

  return Math.round((maxMarks * percentage) / 100);
}

function updateSuggestedScoreInput(score) {
  if (!suggestedScoreInput || !scoreLabelEl) {
    return;
  }

  const maxMarks = Number(state.activeSection?.max_marks ?? 0);
  suggestedScoreInput.value = String(score);
  scoreLabelEl.textContent = `প্রাপ্ত নম্বর (সর্বোচ্চ ${maxMarks})`;
}

function updateScoreForCurrentOutcome(difficulty, rating) {
  const score = getSuggestedScoreFromOutcome({ difficulty, rating });
  updateSuggestedScoreInput(score);
  return score;
}

function setDirectEntryMode(enabled) {
  state.directEntry = enabled;

  if (questionCardEl) {
    questionCardEl.classList.toggle('hidden', enabled);
  }

  if (directEntryPanel) {
    directEntryPanel.classList.toggle('hidden', !enabled);
  }

  if (questionControlsEl) {
    questionControlsEl.classList.toggle('hidden', enabled);
  }

  if (scoreMethodText) {
    scoreMethodText.textContent = enabled ? 'method: direct' : 'method: auto';
  }

  if (enabled && directScoreInput && suggestedScoreInput) {
    directScoreInput.value = suggestedScoreInput.value;
  }
}

async function loadExistingQuestionIdsForCandidateSection(candidateId, sectionId) {
  const { data, error } = await supabase
    .from('response_log')
    .select('question_id')
    .eq('candidate_id', candidateId)
    .eq('section_id', sectionId);

  if (error) {
    throw error;
  }

  return new Set((data ?? []).map((row) => row.question_id));
}

async function fetchNextQuestion(sectionId, difficulty, candidateId) {
  const usedQuestionIds = await loadExistingQuestionIdsForCandidateSection(candidateId, sectionId);

  const { data, error } = await supabase
    .from('questions')
    .select('id, section_id, difficulty, question_text')
    .eq('section_id', sectionId)
    .eq('difficulty', difficulty);

  if (error) {
    throw error;
  }

  const pool = (data ?? []).filter((question) => !usedQuestionIds.has(question.id));
  if (!pool.length) {
    return null;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchNextAvailableQuestion(sectionId, candidateId, difficultyOrder) {
  for (const difficulty of difficultyOrder) {
    const question = await fetchNextQuestion(sectionId, difficulty, candidateId);
    if (question) {
      return question;
    }
  }

  return null;
}

async function loadActiveQuestion() {
  if (!supabase || !state.activeSection || !state.candidate) {
    return;
  }

  const candidateId = getCandidateId();
  if (!candidateId) {
    return;
  }

  const sectionType = state.activeSection.section_type;
  const difficultyOrder = state.activeDifficulty === 'easy'
    ? ['easy']
    : state.activeDifficulty === 'medium'
      ? ['medium']
      : ['hard'];

  const question = await fetchNextAvailableQuestion(state.activeSection.id, candidateId, difficultyOrder);

  if (!question) {
    state.activeQuestion = null;
    if (questionTextEl) {
      questionTextEl.textContent = 'No unused question found for this difficulty.';
    }
    return;
  }

  state.activeQuestion = question;
  state.activeDifficulty = question.difficulty;
  if (questionTextEl) {
    questionTextEl.textContent = question.question_text;
  }

  if (sectionType === 'practical' || sectionType === 'viva') {
    setEvaluationStatus(`Section: ${state.activeSection.section_name} | Difficulty: ${question.difficulty}`);
  } else {
    setEvaluationStatus(`Section: ${state.activeSection.section_name}`);
  }
}

function moveToNextSectionOrFinish() {
  const selectedSections = getSelectedSectionsInOrder();
  state.activeSectionIndex += 1;

  if (state.activeSectionIndex >= selectedSections.length) {
    if (nextCandidateButton) {
      nextCandidateButton.classList.remove('hidden');
    }
    if (lockSectionButton) {
      lockSectionButton.classList.add('hidden');
    }
    if (questionControlsEl) {
      questionControlsEl.classList.add('hidden');
    }
    if (directEntryPanel) {
      directEntryPanel.classList.add('hidden');
    }
    if (questionTextEl) {
      questionTextEl.textContent = 'All selected sections completed.';
    }
    setEvaluationStatus('All sections finished.');
    return;
  }

  state.activeSection = selectedSections[state.activeSectionIndex];
  state.activeDifficulty = 'easy';
  state.lastRating = null;
  loadActiveQuestion();
}

function resetCandidateAndSectionState() {
  clearStoredValue(storageKeys.candidateId);
  clearStoredValue(storageKeys.candidateRollNo);
  clearStoredValue(storageKeys.selectedSectionIds);

  state.candidate = null;
  state.sections = [];
  state.selectedSectionIds = [];
  state.activeSectionIndex = 0;
  state.activeSection = null;
  state.activeQuestion = null;
  state.activeDifficulty = 'easy';
  state.lastRating = null;
  state.directEntry = false;
  state.sectionResults = [];

  if (rollNoInput) {
    rollNoInput.value = '';
  }
  if (newCandidateNameInput) {
    newCandidateNameInput.value = '';
  }
  if (newCandidatePostSelect) {
    newCandidatePostSelect.value = '';
  }
  if (candidateMatchCard) {
    candidateMatchCard.classList.add('hidden');
  }
  if (newCandidateForm) {
    newCandidateForm.classList.add('hidden');
  }

  renderCandidateSummary();
  renderSectionChecklist();
}

function renderExaminerList() {
  if (!examinerListEl) {
    return;
  }

  examinerListEl.innerHTML = '';

  if (!state.examiners.length) {
    examinerListEl.innerHTML = '<div class="value-box">No examiners found.</div>';
    return;
  }

  state.examiners.forEach((examiner) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button';
    button.textContent = examiner.name;
    button.addEventListener('click', () => {
      writeStoredValue(storageKeys.examinerId, String(examiner.id));
      writeStoredValue(storageKeys.examinerName, examiner.name);
      statusEl.textContent = `Logged in as ${examiner.name}`;
      showScreen(screenCandidate);
    });
    examinerListEl.appendChild(button);
  });
}

function renderCandidateSummary() {
  if (!candidateSummaryEl || !state.candidate) {
    return;
  }

  candidateSummaryEl.textContent = `${state.candidate.roll_no} | ${state.candidate.name} | ${state.candidate.post_applied}`;
}

function renderSectionChecklist() {
  if (!sectionListEl) {
    return;
  }

  sectionListEl.innerHTML = '';

  if (!state.sections.length) {
    sectionListEl.innerHTML = '<div class="value-box">No sections found for this post.</div>';
    return;
  }

  state.sections.forEach((section) => {
    const label = document.createElement('label');
    label.className = 'check-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(section.id);
    checkbox.checked = state.selectedSectionIds.includes(section.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (!state.selectedSectionIds.includes(section.id)) {
          state.selectedSectionIds.push(section.id);
        }
      } else {
        state.selectedSectionIds = state.selectedSectionIds.filter((id) => id !== section.id);
      }
      saveSelectedSections(state.selectedSectionIds);
    });

    const content = document.createElement('div');
    content.innerHTML = `<strong>${section.section_name}</strong><span>${section.section_type}</span>`;

    label.append(checkbox, content);
    sectionListEl.appendChild(label);
  });
}

async function loadExaminers() {
  if (!supabase) {
    state.examiners = [];
    renderExaminerList();
    return;
  }

  const { data, error } = await supabase
    .from('examiners')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    state.examiners = [];
  } else {
    state.examiners = data ?? [];
  }

  renderExaminerList();
}

async function findCandidateByRollNo(rollNo) {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id, roll_no, name, post_applied')
    .eq('roll_no', rollNo)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function loadSectionsForPost(postApplied) {
  if (!supabase) {
    state.sections = [];
    renderSectionChecklist();
    return;
  }

  const normalizedPost = String(postApplied ?? '').trim().toLowerCase();

  const { data, error } = await supabase
    .from('sections')
    .select('id, section_name, section_type, section_order, post_type')
    .eq('post_type', normalizedPost)
    .order('section_order', { ascending: true });

  if (error) {
    throw error;
  }

  let sections = data ?? [];

  // Fallback: if strict filter returns nothing, do a broader fetch and normalize in JS.
  if (!sections.length) {
    const fallback = await supabase
      .from('sections')
      .select('id, section_name, section_type, section_order, post_type')
      .order('section_order', { ascending: true });

    if (!fallback.error) {
      sections = (fallback.data ?? []).filter(
        (row) => String(row.post_type ?? '').trim().toLowerCase() === normalizedPost,
      );
    }
  }

  state.sections = sections;

  if (!state.sections.length && sectionListEl) {
    sectionListEl.innerHTML = `<div class="value-box">No sections found for post: ${normalizedPost || 'unknown'}</div>`;
  }

  renderSectionChecklist();
}

async function startEvaluationFlow() {
  const selectedSections = getSelectedSectionsInOrder();

  if (!selectedSections.length) {
    alert('কমপক্ষে একটি section select করুন।');
    return;
  }

  state.activeSectionIndex = 0;
  state.activeSection = selectedSections[0];
  state.activeDifficulty = 'easy';
  state.lastRating = null;
  state.sectionResults = [];
  saveSelectedSections(state.selectedSectionIds);
  showEvaluationScreen();
  await loadActiveQuestion();
}

function getCurrentMethod() {
  return state.directEntry ? 'direct' : 'auto';
}

async function insertResponseLogEntry({ candidateId, examinerId, sectionId, questionId, difficulty, rating }) {
  const { error } = await supabase.from('response_log').insert({
    candidate_id: candidateId,
    examiner_id: examinerId,
    section_id: sectionId,
    question_id: questionId,
    difficulty,
    rating,
  });

  if (error) {
    throw error;
  }
}

async function upsertMarkRecord({ candidateId, examinerId, sectionId, score, method }) {
  const { error } = await supabase
    .from('marks')
    .upsert(
      {
        candidate_id: candidateId,
        examiner_id: examinerId,
        section_id: sectionId,
        score,
        method,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'candidate_id,examiner_id,section_id' },
    );

  if (error) {
    throw error;
  }
}

async function handleRatingSelection(rating) {
  if (!supabase || !state.activeSection || !state.activeQuestion || !state.candidate) {
    return;
  }

  const candidateId = getCandidateId();
  const examinerId = getExaminerId();

  if (!candidateId || !examinerId) {
    alert('Examiner or candidate session missing.');
    return;
  }

  await insertResponseLogEntry({
    candidateId,
    examinerId,
    sectionId: state.activeSection.id,
    questionId: state.activeQuestion.id,
    difficulty: state.activeQuestion.difficulty,
    rating,
  });

  state.lastRating = rating;
  state.sectionResults.push({ difficulty: state.activeQuestion.difficulty, rating });

  const currentDifficulty = state.activeQuestion.difficulty;
  const isPass = rating === 'good' || rating === 'excellent';
  const currentIndex = ['easy', 'medium', 'hard'].indexOf(currentDifficulty);
  const nextDifficulty = ['easy', 'medium', 'hard'][currentIndex + 1] ?? null;

  if (currentDifficulty === 'hard') {
    updateScoreForCurrentOutcome(currentDifficulty, rating);
    setEvaluationStatus(`Final rating recorded for ${currentDifficulty}.`);
    return;
  }

  if (isPass && nextDifficulty) {
    state.activeDifficulty = nextDifficulty;
    const nextQuestion = await fetchNextAvailableQuestion(state.activeSection.id, candidateId, [nextDifficulty]);
    if (nextQuestion) {
      state.activeQuestion = nextQuestion;
      if (questionTextEl) {
        questionTextEl.textContent = nextQuestion.question_text;
      }
      setEvaluationStatus(`Moved to ${nextDifficulty}.`);
      return;
    }
  }

  updateScoreForCurrentOutcome(currentDifficulty, rating);
  setEvaluationStatus('Rating recorded. Ready to lock section.');
}

async function handleLockSection() {
  if (!supabase || !state.activeSection || !state.candidate) {
    return;
  }

  const candidateId = getCandidateId();
  const examinerId = getExaminerId();

  if (!candidateId || !examinerId) {
    alert('Examiner or candidate session missing.');
    return;
  }

  if (isPracticalSection(state.activeSection)) {
    const alreadyAssigned = await practicalSectionAlreadyAssigned({
      candidateId,
      sectionId: state.activeSection.id,
      examinerId,
    });

    if (alreadyAssigned) {
      alert('এই practical section-এ ইতোমধ্যে অন্য পরীক্ষক নম্বর দিয়েছেন। এই section-এ একজন পরীক্ষকই নম্বর দিতে পারবেন।');
      return;
    }
  }

  const scoreValue = state.directEntry
    ? Number(directScoreInput?.value ?? suggestedScoreInput?.value ?? 0)
    : Number(suggestedScoreInput?.value ?? 0);

  const method = getCurrentMethod();

  await upsertMarkRecord({
    candidateId,
    examinerId,
    sectionId: state.activeSection.id,
    score: Number.isFinite(scoreValue) ? scoreValue : 0,
    method,
  });

  state.sectionResults.push({ sectionId: state.activeSection.id, score: scoreValue, method });
  setEvaluationStatus('Section locked.');
  moveToNextSectionOrFinish();
}

function syncSuggestedScoreFromDirectInput() {
  if (!directScoreInput || !suggestedScoreInput) {
    return;
  }

  suggestedScoreInput.value = directScoreInput.value;
}

async function createCandidate({ rollNo, name, postApplied }) {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const { data, error } = await supabase
    .from('candidates')
    .insert({ roll_no: rollNo, name, post_applied: postApplied })
    .select('id, roll_no, name, post_applied')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function handleRollSubmit(event) {
  event.preventDefault();

  const rollNo = rollNoInput.value.trim();
  if (!rollNo) {
    return;
  }

  try {
    const candidate = await findCandidateByRollNo(rollNo);

    if (candidate) {
      state.candidate = candidate;
      writeStoredValue(storageKeys.candidateId, String(candidate.id));
      writeStoredValue(storageKeys.candidateRollNo, candidate.roll_no);
      candidateNameEl.textContent = candidate.name;
      candidatePostEl.textContent = candidate.post_applied;
      setDisplay(candidateMatchCard, true);
      setDisplay(newCandidateForm, false);
      await loadSectionsForPost(candidate.post_applied);
      renderCandidateSummary();
      showScreen(screenSections);
      return;
    }

    setDisplay(candidateMatchCard, false);
    setDisplay(newCandidateForm, true);
    newCandidateNameInput.focus();
  } catch (error) {
    console.error(error);
    candidateMatchCard.textContent = 'Could not load candidate.';
    setDisplay(candidateMatchCard, true);
  }
}

async function handleNewCandidateSubmit(event) {
  event.preventDefault();

  const candidateName = newCandidateNameInput.value.trim();
  const postApplied = newCandidatePostSelect.value;
  const rollNo = rollNoInput.value.trim();

  if (!candidateName || !postApplied || !rollNo) {
    return;
  }

  try {
    const candidate = await createCandidate({ rollNo, name: candidateName, postApplied });
    state.candidate = candidate;
    writeStoredValue(storageKeys.candidateId, String(candidate.id));
    writeStoredValue(storageKeys.candidateRollNo, candidate.roll_no);
    candidateNameEl.textContent = candidate.name;
    candidatePostEl.textContent = candidate.post_applied;
    await loadSectionsForPost(candidate.post_applied);
    renderCandidateSummary();
    showScreen(screenSections);
  } catch (error) {
    console.error(error);
    alert('Candidate create করা যায়নি. আবার চেষ্টা করুন।');
  }
}

function handleStartSections() {
  startEvaluationFlow().catch((error) => {
    console.error(error);
    alert('Section evaluation start করা যায়নি।');
  });
}

function handleNextCandidate() {
  resetCandidateAndSectionState();
  showScreen(screenCandidate);
}

function hydrateSession() {
  const storedExaminerId = readStoredValue(storageKeys.examinerId);
  const storedCandidateId = readStoredValue(storageKeys.candidateId);
  state.selectedSectionIds = getStoredSelectedSections();

  if (storedExaminerId) {
    showScreen(storedCandidateId ? screenSections : screenCandidate);
  } else {
    showScreen(screenLogin);
  }
}

async function bootstrap() {
  await loadExaminers();

  candidateRollForm?.addEventListener('submit', handleRollSubmit);
  newCandidateForm?.addEventListener('submit', handleNewCandidateSubmit);
  startButton?.addEventListener('click', handleStartSections);
  directEntryToggle?.addEventListener('change', () => setDirectEntryMode(Boolean(directEntryToggle.checked)));
  directScoreInput?.addEventListener('input', syncSuggestedScoreFromDirectInput);
  lockSectionButton?.addEventListener('click', () => {
    handleLockSection().catch((error) => {
      console.error(error);
      alert('Mark save করা যায়নি।');
    });
  });
  nextCandidateButton?.addEventListener('click', handleNextCandidate);

  ratingGridEl?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const rating = target.getAttribute('data-rating');
    if (!rating) {
      return;
    }

    handleRatingSelection(rating).catch((error) => {
      console.error(error);
      alert('Rating save করা যায়নি।');
    });
  });

  hydrateSession();

  if (state.selectedSectionIds.length && !candidateMatchCard?.classList.contains('hidden')) {
    saveSelectedSections(state.selectedSectionIds);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  if (statusEl) {
    statusEl.textContent = 'App initialization failed';
  }
});
