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
const logoutButton = document.getElementById('logout-button');
const backToSectionsButton = document.getElementById('back-to-sections-button');
const sectionNameDisplay = document.getElementById('section-name-display');
const maxMarksDisplay = document.getElementById('max-marks-display');
const difficultyBanner = document.getElementById('difficulty-banner');

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
  sectionHighestScore: null,
  sectionScoreAccum: 0,
};

const hasConfig =
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

const supabase = hasConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (statusEl) {
  statusEl.textContent = hasConfig ? 'Supabase configured' : 'Add Supabase credentials in config.js';
}

function showScreen(activeScreen) {
  [screenLogin, screenCandidate, screenSections, screenEvaluation].forEach((screen) => {
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
  state.sectionScoreAccum = 0;
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

// Each rating button's fraction of that stage's max share (matches data-score in index.html)
const RATING_FRACTIONS = { bad: 0.25, average: 0.5, good: 0.75, excellent: 1 };

// Split a section's max_marks across the 3 difficulty stages. Easy and medium
// each get an equal floor share; hard absorbs the remainder so the three
// shares always add up exactly to max_marks (e.g. 10 -> 3, 3, 4).
function getDifficultyShare(difficulty, maxMarks) {
  const total = Number(maxMarks) || 0;
  const base = Math.floor(total / 3);
  const shares = { easy: base, medium: base, hard: total - base * 2 };
  return shares[difficulty] ?? 0;
}

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

// Records the score for one stage (easy/medium/hard) and adds it to the
// section's running total, then reflects that total in the score input.
function recordStageScore(difficulty, rating) {
  const maxMarks = Number(state.activeSection?.max_marks ?? 0);
  const share = getDifficultyShare(difficulty, maxMarks);
  const fraction = RATING_FRACTIONS[rating] ?? 0;
  const stageScore = roundScore(share * fraction);

  state.sectionScoreAccum = roundScore((state.sectionScoreAccum ?? 0) + stageScore);
  updateSuggestedScoreInput(state.sectionScoreAccum);
  return state.sectionScoreAccum;
}

function highlightSelectedRating(rating) {
  if (!ratingGridEl) return;
  const buttons = ratingGridEl.querySelectorAll('.rating-button');
  buttons.forEach((btn) => {
    const isSelected = btn.getAttribute('data-rating') === rating;
    btn.classList.toggle('active', isSelected);
    if (isSelected) {
      btn.classList.remove('pulse-anim');
      void btn.offsetWidth;
      btn.classList.add('pulse-anim');
    }
  });
}

function clearRatingHighlights() {
  if (!ratingGridEl) return;
  const buttons = ratingGridEl.querySelectorAll('.rating-button');
  buttons.forEach((btn) => {
    btn.classList.remove('active', 'pulse-anim');
  });
}

function animateQuestionCard() {
  if (!questionCardEl) return;
  questionCardEl.classList.remove('card-anim');
  void questionCardEl.offsetWidth;
  questionCardEl.classList.add('card-anim');
}

function showDifficultyBanner(difficulty) {
  if (!difficultyBanner) return;

  const labels = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };
  const classes = { easy: 'pill-easy', medium: 'pill-medium', hard: 'pill-hard' };

  // Difficulty label shown once, directly before the word "প্রশ্ন"
  const difficultyLabel = document.getElementById('difficulty-label');
  if (difficultyLabel) {
    difficultyLabel.textContent = labels[difficulty] ?? '';
    difficultyLabel.className = 'difficulty-label ' + (classes[difficulty] ?? '');
  }

  // Tint the question card background to match the difficulty
  if (questionCardEl) {
    questionCardEl.classList.remove('difficulty-easy', 'difficulty-medium', 'difficulty-hard');
    if (difficulty) {
      questionCardEl.classList.add(`difficulty-${difficulty}`);
    }
  }

  // Hide original banner element (superseded by the difficulty label above)
  difficultyBanner.classList.add('hidden');
}



function updateSectionInfoBar() {
  const section = state.activeSection;
  if (!section) return;

  if (sectionNameDisplay) {
    sectionNameDisplay.textContent = section.section_name ?? '';
  }
  if (maxMarksDisplay) {
    const max = section.max_marks != null ? section.max_marks : '—';
    maxMarksDisplay.textContent = `পূর্ণমান: ${max}`;
  }
}

function animateScoreUpdate() {
  const scoreEditor = document.querySelector('.score-editor');
  if (!scoreEditor) return;
  scoreEditor.classList.remove('score-updated');
  void scoreEditor.offsetWidth;
  scoreEditor.classList.add('score-updated');
}

function updateSuggestedScoreInput(score) {
  if (!suggestedScoreInput || !scoreLabelEl) {
    return;
  }

  const maxMarks = Number(state.activeSection?.max_marks ?? 0);
  suggestedScoreInput.value = String(score);

  const highest = state.sectionHighestScore;
  if (highest != null) {
    scoreLabelEl.textContent = `প্রাপ্ত নম্বর (পূর্ণমান ${maxMarks} | এ যাবৎ সর্বোচ্চ ${highest})`;
  } else {
    scoreLabelEl.textContent = `প্রাপ্ত নম্বর (পূর্ণমান ${maxMarks})`;
  }

  animateScoreUpdate();
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

  let { data, error } = await supabase
    .from('questions')
    .select('id, section_id, difficulty, question_text')
    .eq('section_id', sectionId)
    .eq('difficulty', difficulty);

  if (error) {
    throw error;
  }

  // Fallback: If 0 questions for this exact section_id, look up sections with matching section_name
  if ((!data || !data.length) && state.activeSection?.section_name) {
    const { data: matchingSections } = await supabase
      .from('sections')
      .select('id')
      .eq('section_name', state.activeSection.section_name);

    if (matchingSections && matchingSections.length) {
      const sectionIds = matchingSections.map((s) => s.id);
      const res = await supabase
        .from('questions')
        .select('id, section_id, difficulty, question_text')
        .in('section_id', sectionIds)
        .eq('difficulty', difficulty);

      if (!res.error && res.data) {
        data = res.data;
      }
    }
  }

  const pool = (data ?? []).filter((question) => !usedQuestionIds.has(question.id));
  if (!pool.length) {
    return null;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchNextAvailableQuestion(sectionId, candidateId, difficultyOrder) {
  const allDifficulties = ['easy', 'medium', 'hard'];
  const orderToTry = [...new Set([...difficultyOrder, ...allDifficulties])];

  for (const difficulty of orderToTry) {
    const question = await fetchNextQuestion(sectionId, difficulty, candidateId);
    if (question) {
      return question;
    }
  }

  return null;
}

async function fetchHighestScoreForSection(sectionId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('marks')
      .select('score')
      .eq('section_id', sectionId)
      .not('score', 'is', null)
      .order('score', { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return null;
    return data[0].score;
  } catch {
    return null;
  }
}

async function loadActiveQuestion() {
  console.log('loadActiveQuestion called');

  if (!supabase || !state.activeSection || !state.candidate) {
    console.log('Missing required data for loading question');
    return;
  }

  const candidateId = getCandidateId();
  if (!candidateId) {
    console.log('No candidate ID found');
    return;
  }

  // Fetch the highest score any candidate has received in this section so far
  state.sectionHighestScore = await fetchHighestScoreForSection(state.activeSection.id);

  const sectionType = state.activeSection.section_type;

  if (sectionType === 'gpa') {
    state.activeQuestion = null;
    if (questionTextEl) {
      questionTextEl.textContent = 'GPA ভিত্তিক সেকশন: প্রাপ্ত নম্বর সরাসরি প্রবেশ করান।';
    }
    setDirectEntryMode(true);
    setEvaluationStatus(`Section: ${state.activeSection.section_name} (GPA)`);
    return;
  }

  if (directEntryToggle) {
    directEntryToggle.checked = false;
  }
  setDirectEntryMode(false);

  const difficultyOrder = state.activeDifficulty === 'easy'
    ? ['easy', 'medium', 'hard']
    : state.activeDifficulty === 'medium'
      ? ['medium', 'hard', 'easy']
      : ['hard', 'medium', 'easy'];

  const question = await fetchNextAvailableQuestion(state.activeSection.id, candidateId, difficultyOrder);

  console.log('Fetched question:', question);

  if (!question) {
    state.activeQuestion = null;
    if (questionTextEl) {
      questionTextEl.textContent = 'No unused question found for this section.';
    }
    return;
  }

  const prevDifficulty = state.activeDifficulty;
  state.activeQuestion = question;
  state.activeDifficulty = question.difficulty;

  clearRatingHighlights();
  animateQuestionCard();
  showDifficultyBanner(question.difficulty);
  updateSectionInfoBar();

  if (questionTextEl) {
    questionTextEl.textContent = question.question_text;
    console.log('Question text set to:', questionTextEl.textContent);
  }

  setEvaluationStatus(state.activeSection.section_name);

  console.log('Current screen state - checking if evaluation screen is visible');
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
  state.sectionScoreAccum = 0;
  updateSectionInfoBar();
  updateSuggestedScoreInput(0);
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
  state.sectionScoreAccum = 0;
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

// Examiner name is stored as "Full Name — Designation" or just "Full Name"
// (same encoding used by admin.js, since the examiners table has no separate
// designation column).
function parseExaminerName(rawName) {
  const raw = rawName ?? '';
  const idx = raw.indexOf(' — ');
  if (idx !== -1) {
    return { name: raw.slice(0, idx), designation: raw.slice(idx + 3) };
  }
  return { name: raw, designation: '' };
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
      const { name, designation } = parseExaminerName(examiner.name);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'examiner-button action-button';
      button.innerHTML = `<span class="examiner-name">${name}</span><span class="examiner-desig">${designation || ''}</span>`;
      button.addEventListener('click', () => {
        writeStoredValue(storageKeys.examinerId, String(examiner.id));
        writeStoredValue(storageKeys.examinerName, name);
        if (statusEl) {
          statusEl.textContent = `Logged in as ${name}`;
        }
        renderExaminerInfo(name, designation);
        showScreen(screenCandidate);
      });
      examinerListEl.appendChild(button);
  });
}

function renderExaminerInfo(name, designation) {
  const nameEl = document.getElementById('examiner-name');
  const desigEl = document.getElementById('examiner-desig');
  if (nameEl) nameEl.textContent = name;
  if (desigEl) desigEl.textContent = designation || '';
}



function renderCandidateSummary() {
  if (!state.candidate) {
    return;
  }

  const summaryText = `${state.candidate.roll_no} | ${state.candidate.name} | ${state.candidate.post_applied}`;

  if (candidateSummaryEl) {
    candidateSummaryEl.textContent = summaryText;
  }
  if (evaluationSummaryEl) {
    evaluationSummaryEl.textContent = summaryText;
  }
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
    const maxMarks = section.max_marks != null ? section.max_marks : '—';
    content.innerHTML = `<strong>${section.section_name}</strong><span>${section.section_type} • পূর্ণমান: ${maxMarks}</span>`;

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
    .select('id, section_name, max_marks, section_type, section_order, post_type')
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
      .select('id, section_name, max_marks, section_type, section_order, post_type')
      .order('section_order', { ascending: true });

    if (!fallback.error) {
      sections = (fallback.data ?? []).filter(
        (row) => String(row.post_type ?? '').trim().toLowerCase() === normalizedPost,
      );
    }
  }

  state.sections = sections;

  if (!state.selectedSectionIds || !state.selectedSectionIds.length) {
    state.selectedSectionIds = sections.map((s) => s.id);
    saveSelectedSections(state.selectedSectionIds);
  }

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
  state.sectionScoreAccum = 0;
  state.sectionResults = [];
  saveSelectedSections(state.selectedSectionIds);
  showEvaluationScreen();
  updateSectionInfoBar();
  updateSuggestedScoreInput(0);
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

  highlightSelectedRating(rating);

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
    recordStageScore(currentDifficulty, rating);
    setEvaluationStatus(`✓ [${rating.toUpperCase()}] recorded. Click ' lock section' to finish.`);
    return;
  }

  if (isPass && nextDifficulty) {
    state.activeDifficulty = nextDifficulty;
    const nextQuestion = await fetchNextAvailableQuestion(state.activeSection.id, candidateId, [nextDifficulty]);
    if (nextQuestion) {
      state.activeQuestion = nextQuestion;
      clearRatingHighlights();
      animateQuestionCard();
      showDifficultyBanner(nextDifficulty);
      if (questionTextEl) {
        questionTextEl.textContent = nextQuestion.question_text;
      }
      setEvaluationStatus(`✓ Saved (${rating}). Promoted to ${nextDifficulty} difficulty.`);
      return;
    }
  }

  recordStageScore(currentDifficulty, rating);
  setEvaluationStatus(`✓ Rating recorded (${rating}). Section score calculated.`);
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
    console.error('Full error:', error);
    if (error.message?.includes('duplicate') || error.status === 409 || error.code === '23505') {
      alert('এই Roll No. ইতিমধ্যেই ব্যবহৃত হয়েছে। অন্য Roll No. ব্যবহার করুন।');
    } else {
      alert('Candidate create করা যায়নি. আবার চেষ্টা করুন।');
    }
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

function handleLogout() {
  clearStoredValue(storageKeys.examinerId);
  clearStoredValue(storageKeys.examinerName);
  clearStoredValue(storageKeys.candidateId);
  clearStoredValue(storageKeys.candidateRollNo);
  clearStoredValue(storageKeys.selectedSectionIds);

  if (rollNoInput) rollNoInput.value = '';
  if (candidateNameEl) candidateNameEl.textContent = '';
  if (candidatePostEl) candidatePostEl.textContent = '';
  if (candidateMatchCard) candidateMatchCard.classList.add('hidden');
  if (newCandidateForm) newCandidateForm.classList.add('hidden');

  state.examiners = [];
  state.candidate = null;
  state.sections = [];
  state.selectedSectionIds = [];
  state.activeSectionIndex = 0;
  state.activeSection = null;
  state.activeQuestion = null;
  state.activeDifficulty = 'easy';
  state.lastRating = null;
  state.sectionScoreAccum = 0;
  state.directEntry = false;
  state.sectionResults = [];
  
  if (statusEl) {
    statusEl.textContent = hasConfig ? 'Supabase configured' : 'Add Supabase credentials in config.js';
  }
  
  showScreen(screenLogin);
  loadExaminers();
}

async function hydrateSession() {
  const storedExaminerId = readStoredValue(storageKeys.examinerId);
  const storedExaminerName = readStoredValue(storageKeys.examinerName);
  const storedCandidateId = readStoredValue(storageKeys.candidateId);
  const storedCandidateRollNo = readStoredValue(storageKeys.candidateRollNo);
  state.selectedSectionIds = getStoredSelectedSections();

  if (storedExaminerId) {
    if (statusEl && storedExaminerName) {
      statusEl.textContent = `Logged in as ${storedExaminerName}`;
    }

    if (storedExaminerName) {
      const matchedExaminer = state.examiners.find((examiner) => String(examiner.id) === String(storedExaminerId));
      const designation = matchedExaminer ? parseExaminerName(matchedExaminer.name).designation : '';
      renderExaminerInfo(storedExaminerName, designation);
    }

    if (storedCandidateRollNo || storedCandidateId) {
      try {
        let candidate = null;
        if (storedCandidateRollNo) {
          candidate = await findCandidateByRollNo(storedCandidateRollNo);
        }
        if (!candidate && storedCandidateId && supabase) {
          const { data } = await supabase
            .from('candidates')
            .select('id, roll_no, name, post_applied')
            .eq('id', storedCandidateId)
            .maybeSingle();
          candidate = data;
        }

        if (candidate) {
          state.candidate = candidate;
          if (candidateNameEl) candidateNameEl.textContent = candidate.name;
          if (candidatePostEl) candidatePostEl.textContent = candidate.post_applied;
          setDisplay(candidateMatchCard, true);
          await loadSectionsForPost(candidate.post_applied);
          renderCandidateSummary();
          showScreen(screenSections);
          return;
        }
      } catch (error) {
        console.error('Session rehydration failed:', error);
      }
    }

    showScreen(screenCandidate);
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
  logoutButton?.addEventListener('click', handleLogout);
  backToSectionsButton?.addEventListener('click', () => {
    clearEvaluationState();
    renderCandidateSummary();
    renderSectionChecklist();
    showScreen(screenSections);
  });

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

  await hydrateSession();

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
