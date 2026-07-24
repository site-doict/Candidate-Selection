import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_PASSWORD } from './config.js';

const supabase =
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE'
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusEl = document.getElementById('admin-status');
const exportButton = document.getElementById('export-csv-button');
const deleteAllButton = document.getElementById('delete-all-button');
const tableBody = document.getElementById('admin-candidate-body');
const detailsModal = document.getElementById('details-modal');
const detailsModalContent = document.getElementById('details-modal-content');

// Login
const adminLoginOverlay = document.getElementById('admin-login-overlay');
const adminShell = document.getElementById('admin-shell');
const adminLoginForm = document.getElementById('admin-login-form');
const adminPasswordInput = document.getElementById('admin-password-input');
const adminLoginError = document.getElementById('admin-login-error');
const adminLogoutButton = document.getElementById('admin-logout-button');

// Examiner management
const addExaminerForm = document.getElementById('add-examiner-form');
const examinerNameInput = document.getElementById('examiner-name-input');
const examinerDesignationInput = document.getElementById('examiner-designation-input');
const addExaminerStatusEl = document.getElementById('add-examiner-status');
const examinerManagementList = document.getElementById('examiner-management-list');

// Delete confirm modal
const deleteExaminerModal = document.getElementById('delete-examiner-modal');
const deleteExaminerMessage = document.getElementById('delete-examiner-message');
const deleteExaminerCancel = document.getElementById('delete-examiner-cancel');
const deleteExaminerConfirm = document.getElementById('delete-examiner-confirm');

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  candidates: [],
  sections: [],
  finalMarks: [],
  marks: [],
  examiners: [],
  examinerSections: [],
  expandedCandidateIds: new Set(),
  pendingDeleteExaminerId: null,
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function getRowValue(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return null;
}

function normalizeId(value) {
  return value === null || value === undefined ? null : String(value);
}

function groupByCandidateSection(rows) {
  return rows.reduce((map, row) => {
    const key = `${normalizeId(row.candidate_id)}::${normalizeId(row.section_id)}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
    return map;
  }, new Map());
}

function getSectionsForCandidate(candidate) {
  return state.sections
    .filter((section) => section.post_type === candidate.post_applied)
    .sort((a, b) => Number(a.section_order ?? 0) - Number(b.section_order ?? 0));
}

function getFinalMarksMap() {
  const map = new Map();
  state.finalMarks.forEach((row) => {
    const candidateId = normalizeId(getRowValue(row, 'candidate_id'));
    const sectionId = normalizeId(getRowValue(row, 'section_id'));
    if (!candidateId || !sectionId) {
      return;
    }
    const key = `${candidateId}::${sectionId}`;
    map.set(key, row);
  });
  return map;
}

function getExaminerMap() {
  return new Map(state.examiners.map((examiner) => [normalizeId(examiner.id), examiner.name]));
}

function getSectionMap() {
  return new Map(state.sections.map((section) => [normalizeId(section.id), section]));
}

function computeCandidateSummary(candidate) {
  const sections = getSectionsForCandidate(candidate);
  const finalMarksMap = getFinalMarksMap();
  const marksByCandidateSection = groupByCandidateSection(state.marks);
  const summary = sections.map((section) => {
    const key = `${normalizeId(candidate.id)}::${normalizeId(section.id)}`;
    const finalMarkRow = finalMarksMap.get(key);
    const relatedMarks = marksByCandidateSection.get(key) ?? [];
    const finalScore = Number(getRowValue(finalMarkRow, 'final_score', 'score') ?? 0);
    const examinerCount = Number(
      getRowValue(finalMarkRow, 'examiner_count', 'count') ??
        new Set(relatedMarks.map((row) => normalizeId(row.examiner_id))).size,
    );
    return { section, finalScore, examinerCount, marks: relatedMarks };
  });

  const totalScore = summary.reduce((sum, item) => sum + Number(item.finalScore ?? 0), 0);
  const passMark = candidate.post_applied === 'supervisor' ? 80 : 70;
  const status = totalScore >= passMark ? 'Pass' : 'Fail';

  return { sections: summary, totalScore, passMark, status };
}

// ── Login / Logout ────────────────────────────────────────────────────────────
const SESSION_KEY = 'admin_authenticated';

function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === 'yes';
}

function showLoginOverlay() {
  adminLoginOverlay?.classList.remove('hidden');
  adminShell?.classList.add('hidden');
}

function showAdminShell() {
  adminLoginOverlay?.classList.add('hidden');
  adminShell?.classList.remove('hidden');
}

function handleLoginSubmit(event) {
  event.preventDefault();
  const entered = adminPasswordInput?.value ?? '';
  if (entered === ADMIN_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, 'yes');
    if (adminLoginError) adminLoginError.classList.add('hidden');
    if (adminPasswordInput) adminPasswordInput.value = '';
    showAdminShell();
    loadAdminData();
  } else {
    // Show error message when password does not match
    if (adminLoginError) {
      adminLoginError.textContent = 'ভুল পাসওয়ার্ড। আবার চেষ্টা করুন।';
      adminLoginError.classList.remove('hidden');
    }
    // Clear and focus the password field for another attempt
    if (adminPasswordInput) {
      adminPasswordInput.value = '';
      adminPasswordInput.focus();
    }
  }
}

function handleLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  showLoginOverlay();
}

// ── Examiner name helpers ─────────────────────────────────────────────────────
// Name stored as "Full Name — Designation" or just "Full Name"
function parseExaminerName(rawName) {
  const idx = rawName.indexOf(' — ');
  if (idx !== -1) {
    return { name: rawName.slice(0, idx), designation: rawName.slice(idx + 3) };
  }
  return { name: rawName, designation: null };
}

function getAssignedSectionIds(examinerId) {
  return new Set(
    state.examinerSections
      .filter((row) => normalizeId(row.examiner_id) === normalizeId(examinerId))
      .map((row) => normalizeId(row.section_id)),
  );
}

function getExaminerTotalMarks(examinerId) {
  const assignedIds = getAssignedSectionIds(examinerId);
  return state.sections
    .filter((section) => assignedIds.has(normalizeId(section.id)))
    .reduce((sum, section) => sum + Number(section.max_marks ?? 0), 0);
}

async function handleToggleExaminerSection(examinerId, sectionId, isChecked) {
  if (!supabase) return;

  if (isChecked) {
    const { error } = await supabase
      .from('examiner_sections')
      .upsert({ examiner_id: examinerId, section_id: sectionId }, { onConflict: 'examiner_id,section_id' });
    if (error) {
      console.error(error);
      alert('সেকশন যুক্ত করা যায়নি। আবার চেষ্টা করুন।');
      return;
    }
    state.examinerSections.push({ examiner_id: examinerId, section_id: sectionId });
  } else {
    const { error } = await supabase
      .from('examiner_sections')
      .delete()
      .eq('examiner_id', examinerId)
      .eq('section_id', sectionId);
    if (error) {
      console.error(error);
      alert('সেকশন সরানো যায়নি। আবার চেষ্টা করুন।');
      return;
    }
    state.examinerSections = state.examinerSections.filter(
      (row) => !(normalizeId(row.examiner_id) === normalizeId(examinerId) && normalizeId(row.section_id) === normalizeId(sectionId)),
    );
  }

  const totalEl = document.querySelector(`[data-total-marks-for="${examinerId}"]`);
  if (totalEl) {
    totalEl.textContent = `মোট মার্ক: ${getExaminerTotalMarks(examinerId)}`;
  }
}

function buildExaminerStoredName(name, designation) {
  const trimmedName = name.trim();
  const trimmedDesig = designation?.trim() ?? '';
  return trimmedDesig ? `${trimmedName} — ${trimmedDesig}` : trimmedName;
}

// ── Render Examiner Management List ──────────────────────────────────────────
function renderExaminerManagementList() {
  if (!examinerManagementList) return;
  examinerManagementList.innerHTML = '';

  if (!state.examiners.length) {
    examinerManagementList.innerHTML =
      '<div class="admin-empty">কোনো পরীক্ষক পাওয়া যায়নি। উপরের ফর্ম দিয়ে যোগ করুন।</div>';
    return;
  }

  const sortedSections = state.sections
    .slice()
    .sort((a, b) => Number(a.section_order ?? 0) - Number(b.section_order ?? 0));

  state.examiners.forEach((examiner) => {
    const { name, designation } = parseExaminerName(examiner.name);
    const assignedIds = getAssignedSectionIds(examiner.id);
    const totalMarks = getExaminerTotalMarks(examiner.id);

    const item = document.createElement('div');
    item.className = 'examiner-item examiner-item-expanded';
    item.innerHTML = `
      <div class="examiner-info">
        <strong class="examiner-name">${escapeHtml(name)}</strong>
        ${designation ? `<span class="examiner-designation">${escapeHtml(designation)}</span>` : ''}
        <span class="examiner-total-marks" data-total-marks-for="${escapeHtml(String(examiner.id))}">মোট মার্ক: ${totalMarks}</span>
      </div>
      <div class="examiner-section-checklist">
        ${sortedSections
          .map((section) => {
            const typeLabels = { practical: 'ব্যবহারিক', viva: 'মৌখিক', gpa: 'জিপিএ' };
            const typeLabel = typeLabels[section.section_type] ?? section.section_type;
            return `
          <label class="examiner-section-check-row post-${escapeHtml(section.post_type)}">
            <input
              type="checkbox"
              data-examiner-id="${escapeHtml(String(examiner.id))}"
              data-section-id="${escapeHtml(String(section.id))}"
              ${assignedIds.has(normalizeId(section.id)) ? 'checked' : ''}
            />
            <span class="post-tag post-tag-${escapeHtml(section.post_type)}">${escapeHtml(section.post_type)}</span>
            <span class="type-tag type-tag-${escapeHtml(section.section_type)}">${escapeHtml(typeLabel)}</span>
            <span class="section-check-name">${escapeHtml(section.section_name)}</span>
            <span class="section-check-marks">পূর্ণমান: ${escapeHtml(section.max_marks ?? '—')}</span>
          </label>`;
          })
          .join('')}
      </div>
      <button
        class="action-button danger examiner-delete-btn"
        type="button"
        data-examiner-id="${escapeHtml(String(examiner.id))}"
        data-examiner-name="${escapeHtml(examiner.name)}"
      >🗑 মুছুন</button>
    `;
    examinerManagementList.appendChild(item);
  });
}

// ── Add Examiner ──────────────────────────────────────────────────────────────
async function handleAddExaminer(event) {
  event.preventDefault();
  if (!supabase) return;

  const name = examinerNameInput?.value.trim() ?? '';
  const designation = examinerDesignationInput?.value.trim() ?? '';
  if (!name) return;

  const storedName = buildExaminerStoredName(name, designation);
  const submitBtn = document.getElementById('add-examiner-button');

  if (submitBtn) submitBtn.disabled = true;
  if (addExaminerStatusEl) {
    addExaminerStatusEl.textContent = 'যোগ করা হচ্ছে...';
    addExaminerStatusEl.classList.remove('hidden');
    addExaminerStatusEl.style.color = 'var(--muted)';
  }

  try {
    const { error } = await supabase.from('examiners').insert({ name: storedName });
    if (error) throw error;

    if (examinerNameInput) examinerNameInput.value = '';
    if (examinerDesignationInput) examinerDesignationInput.value = '';
    if (addExaminerStatusEl) {
      addExaminerStatusEl.textContent = '✓ পরীক্ষক সফলভাবে যোগ হয়েছে।';
      addExaminerStatusEl.style.color = '#0d7a38';
    }

    // Refresh examiner list
    const { data } = await supabase
      .from('examiners')
      .select('id, name')
      .order('name', { ascending: true });
    state.examiners = data ?? [];
    renderExaminerManagementList();

    setTimeout(() => {
      if (addExaminerStatusEl) addExaminerStatusEl.classList.add('hidden');
    }, 3000);
  } catch (err) {
    console.error(err);
    if (addExaminerStatusEl) {
      addExaminerStatusEl.textContent = '⚠ যোগ করতে ব্যর্থ হয়েছে। আবার চেষ্টা করুন।';
      addExaminerStatusEl.style.color = '#b21f1f';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ── Delete Examiner Modal ─────────────────────────────────────────────────────
function showDeleteExaminerModal(examinerId, examinerRawName) {
  state.pendingDeleteExaminerId = examinerId;
  const { name, designation } = parseExaminerName(examinerRawName);
  if (deleteExaminerMessage) {
    deleteExaminerMessage.textContent = designation
      ? `"${name} (${designation})" কে পরীক্ষক তালিকা থেকে মুছে ফেলা হবে।`
      : `"${name}" কে পরীক্ষক তালিকা থেকে মুছে ফেলা হবে।`;
  }
  deleteExaminerModal?.classList.remove('hidden');
  deleteExaminerModal?.setAttribute('aria-hidden', 'false');
}

function hideDeleteExaminerModal() {
  state.pendingDeleteExaminerId = null;
  deleteExaminerModal?.classList.add('hidden');
  deleteExaminerModal?.setAttribute('aria-hidden', 'true');
  if (deleteExaminerConfirm) {
    deleteExaminerConfirm.disabled = false;
    deleteExaminerConfirm.textContent = 'হ্যাঁ, মুছুন';
  }
}

async function handleConfirmDeleteExaminer() {
  const examinerId = state.pendingDeleteExaminerId;
  if (!examinerId || !supabase) {
    hideDeleteExaminerModal();
    return;
  }

  if (deleteExaminerConfirm) {
    deleteExaminerConfirm.disabled = true;
    deleteExaminerConfirm.textContent = 'মুছছে...';
  }

  try {
    // Delete marks linked to this examiner
    const { error: marksError } = await supabase
      .from('marks')
      .delete()
      .eq('examiner_id', examinerId);
    if (marksError) {
      console.error('Marks deletion error:', marksError);
      alert('এই পরীক্ষকের স্কোর রেকর্ড মুছতে ব্যর্থ হয়েছে। দয়া করে স্কোর ম্যানুয়ালি মুছে আবার চেষ্টা করুন।');
      return;
    }

    // Delete response logs linked to this examiner (if any)
    const { error: logError } = await supabase
      .from('response_log')
      .delete()
      .eq('examiner_id', examinerId);
    if (logError) {
      console.error('Response log deletion error:', logError);
      // Continue even if logs cannot be deleted; they may not exist.
    }

    // Finally delete the examiner
    const { error } = await supabase.from('examiners').delete().eq('id', examinerId);
    if (error) throw error;

    const { data } = await supabase
      .from('examiners')
      .select('id, name')
      .order('name', { ascending: true });
    state.examiners = data ?? [];
    renderExaminerManagementList();
    setStatus('পরীক্ষক সফলভাবে মুছে ফেলা হয়েছে।');
  } catch (err) {
    console.error(err);
    alert('পরীক্ষক মুছতে ব্যর্থ হয়েছে। Console দেখুন।');
  } finally {
    hideDeleteExaminerModal();
  }
}

// ── Render Candidate Table ────────────────────────────────────────────────────
function renderCandidateTable() {
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!state.candidates.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="admin-empty">No candidates found.</td></tr>';
    return;
  }

  state.candidates.forEach((candidate) => {
    const summary = computeCandidateSummary(candidate);
    const rowId = `candidate-${candidate.id}`;
    const detailsVisible = state.expandedCandidateIds.has(normalizeId(candidate.id));

    const candidateRow = document.createElement('tr');
    candidateRow.className = 'admin-row';
    candidateRow.innerHTML = `
      <td>${escapeHtml(candidate.roll_no)}</td>
      <td>${escapeHtml(candidate.name)}</td>
      <td>${escapeHtml(candidate.post_applied)}</td>
      <td>${escapeHtml(summary.totalScore)}</td>
      <td>${escapeHtml(summary.passMark)}</td>
      <td><span class="status-badge ${summary.status === 'Pass' ? 'status-pass' : 'status-fail'}">${escapeHtml(summary.status)}</span></td>
      <td><button class="action-button admin-inline-button" type="button" data-toggle-details="${escapeHtml(candidate.id)}">${detailsVisible ? 'Hide details' : 'Expand'}</button></td>
    `;

    const detailsRow = document.createElement('tr');
    detailsRow.className = `admin-details-row${detailsVisible ? '' : ' hidden'}`;
    detailsRow.id = rowId;

    const sectionMarkup = summary.sections.length
      ? summary.sections
          .map(
            ({ section, finalScore, examinerCount }) => `
          <div class="section-summary-row">
            <div>
              <strong>${escapeHtml(section.section_name)}</strong>
              <small>${escapeHtml(section.section_type)}</small>
            </div>
            <div class="section-score-box">${escapeHtml(finalScore)}</div>
            <div class="section-count-box">${escapeHtml(examinerCount)} examiner(s)</div>
          </div>
        `,
          )
          .join('')
      : '<div class="admin-empty">No matching sections found.</div>';

    detailsRow.innerHTML = `
      <td colspan="7">
        <div class="admin-details-card">
          <div class="admin-details-top">
            <div>
              <strong>Section results</strong>
              <div class="admin-muted">Total: ${escapeHtml(summary.totalScore)} | Pass mark: ${escapeHtml(summary.passMark)}</div>
            </div>
            <button class="action-button admin-inline-button" type="button" data-open-marks="${escapeHtml(candidate.id)}">বিস্তারিত দেখুন</button>
          </div>
          <div class="admin-section-list">${sectionMarkup}</div>
        </div>
      </td>
    `;

    tableBody.append(candidateRow, detailsRow);
  });
}

// ── Details Modal ─────────────────────────────────────────────────────────────
function renderMarksModal(candidateId) {
  const candidate = state.candidates.find((item) => String(item.id) === String(candidateId));
  if (!candidate || !detailsModalContent) {
    return;
  }

  const sections = getSectionsForCandidate(candidate);
  const examinerMap = getExaminerMap();
  const sectionMap = getSectionMap();
  const marksByCandidateSection = groupByCandidateSection(state.marks);

  const html = sections.length
    ? sections
        .map((section) => {
          const key = `${normalizeId(candidate.id)}::${normalizeId(section.id)}`;
          const marks = marksByCandidateSection.get(key) ?? [];
          const rows = marks.length
            ? marks
                .map(
                  (mark) => `
              <tr>
                <td>${escapeHtml(examinerMap.get(normalizeId(mark.examiner_id)) ?? mark.examiner_id)}</td>
                <td>${escapeHtml(sectionMap.get(normalizeId(mark.section_id))?.section_name ?? '')}</td>
                <td>${escapeHtml(getRowValue(mark, 'score'))}</td>
                <td>${escapeHtml(getRowValue(mark, 'method'))}</td>
                <td>${escapeHtml(getRowValue(mark, 'updated_at'))}</td>
              </tr>
            `,
                )
                .join('')
            : '<tr><td colspan="5">No marks recorded for this section.</td></tr>';

          return `
          <section class="modal-section">
            <h3>${escapeHtml(section.section_name)}</h3>
            <div class="admin-muted">${escapeHtml(section.section_type)} | final score: ${escapeHtml(getRowValue(state.finalMarks.find((row) => String(row.candidate_id) === String(candidate.id) && String(row.section_id) === String(section.id)), 'final_score', 'score') ?? 0)}</div>
            <div class="admin-table-wrap modal-table-wrap">
              <table class="admin-table modal-table">
                <thead>
                  <tr>
                    <th>Examiner</th>
                    <th>Section</th>
                    <th>Score</th>
                    <th>Method</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>
        `;
        })
        .join('')
    : '<div class="admin-empty">No sections available for this candidate.</div>';

  detailsModalContent.innerHTML = `
    <div class="modal-candidate-summary">
      <strong>${escapeHtml(candidate.roll_no)} | ${escapeHtml(candidate.name)} | ${escapeHtml(candidate.post_applied)}</strong>
    </div>
    ${html}
  `;

  detailsModal.classList.remove('hidden');
  detailsModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  if (!detailsModal) {
    return;
  }
  detailsModal.classList.add('hidden');
  detailsModal.setAttribute('aria-hidden', 'true');
}

function toggleCandidateDetails(candidateId) {
  const candidateKey = String(candidateId);
  if (state.expandedCandidateIds.has(candidateKey)) {
    state.expandedCandidateIds.delete(candidateKey);
  } else {
    state.expandedCandidateIds.add(candidateKey);
  }
  renderCandidateTable();
}

// ── CSV Export ────────────────────────────────────────────────────────────────
function downloadCsv(text) {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `admin-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildCsv() {
  const sectionHeaders = state.sections
    .sort((a, b) => Number(a.section_order ?? 0) - Number(b.section_order ?? 0))
    .flatMap((section) => [
      `${section.section_name} final_score`,
      `${section.section_name} examiner_count`,
    ]);

  const headers = ['roll_no', 'name', 'post_applied', 'pass_mark', 'total_score', 'status', ...sectionHeaders];
  const rows = [headers.map(csvEscape).join(',')];

  state.candidates.forEach((candidate) => {
    const summary = computeCandidateSummary(candidate);
    const sectionMap = new Map(
      summary.sections.map(({ section, finalScore, examinerCount }) => [
        String(section.id),
        { finalScore, examinerCount },
      ]),
    );
    const row = [
      candidate.roll_no,
      candidate.name,
      candidate.post_applied,
      summary.passMark,
      summary.totalScore,
      summary.status,
      ...state.sections
        .sort((a, b) => Number(a.section_order ?? 0) - Number(b.section_order ?? 0))
        .flatMap((section) => {
          const data = sectionMap.get(String(section.id));
          return [data?.finalScore ?? 0, data?.examinerCount ?? 0];
        }),
    ];
    rows.push(row.map(csvEscape).join(','));
  });

  return rows.join('\n');
}

// Helper to show the custom FINAL WARNING modal
function showFinalWarningModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('final-warning-modal');
    const cancelBtn = document.getElementById('final-warning-cancel');
    const okBtn = document.getElementById('final-warning-confirm');
    const cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
    };
    const onCancel = () => {
      hideFinalWarningModal();
      cleanup();
      resolve(false);
    };
    const onOk = () => {
      hideFinalWarningModal();
      cleanup();
      resolve(true);
    };
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('hidden');
    okBtn.focus();
  });
}

function hideFinalWarningModal() {
  const modal = document.getElementById('final-warning-modal');
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.add('hidden');
}
// ── Load Admin Data ───────────────────────────────────────────────────────────
async function loadAdminData() {
  if (!supabase) {
    setStatus('Supabase not configured');
    return;
  }

  setStatus('Loading data');

  const [candidatesResult, sectionsResult, finalMarksResult, marksResult, examinersResult, examinerSectionsResult] = await Promise.all([
    supabase.from('candidates').select('*').order('roll_no', { ascending: true }),
    supabase.from('sections').select('*'),
    supabase.from('final_marks').select('candidate_id, section_id, final_score, examiner_count'),
    supabase.from('marks').select('candidate_id, examiner_id, section_id, score, method, updated_at'),
    supabase.from('examiners').select('id, name').order('name', { ascending: true }),
    supabase.from('examiner_sections').select('examiner_id, section_id'),
  ]);

  const errors = [
    candidatesResult.error,
    sectionsResult.error,
    finalMarksResult.error,
    marksResult.error,
    examinersResult.error,
    examinerSectionsResult.error,
  ].filter(Boolean);

  if (errors.length) {
    console.error(errors);
    setStatus('Failed to load data');
    return;
  }

  state.candidates = candidatesResult.data ?? [];
  state.sections = sectionsResult.data ?? [];
  state.finalMarks = finalMarksResult.data ?? [];
  state.marks = marksResult.data ?? [];
  state.examiners = examinersResult.data ?? [];
  state.examinerSections = examinerSectionsResult.data ?? [];

  renderCandidateTable();
  renderExaminerManagementList();
  setStatus(`Loaded ${state.candidates.length} candidates`);
}

// ── Delete All Candidates ─────────────────────────────────────────────────────
async function deleteAllCandidates() {
  if (!supabase) {
    setStatus('Supabase not configured');
    return;
  }

  if (
    !confirm(
      'Are you sure you want to delete ALL candidates? This will also delete all marks, response logs, and final marks. This action cannot be undone!',
    )
  ) {
    return;
  }

  // Show custom FINAL WARNING modal
  const confirmed = await showFinalWarningModal();
  if (!confirmed) {
    return;
  }

  setStatus('Deleting all candidates...');

  try {
    await supabase.from('response_log').delete().gte('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('marks').delete().gte('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('final_marks').delete().gte('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await supabase
      .from('candidates')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      throw error;
    }

    await loadAdminData();
    setStatus('All candidates deleted successfully');
  } catch (error) {
    console.error(error);
    setStatus('Failed to delete candidates');
    alert('Failed to delete candidates. Check console for details.');
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
function registerEvents() {
  // Login / logout
  adminLoginForm?.addEventListener('submit', handleLoginSubmit);
  adminLogoutButton?.addEventListener('click', handleLogout);

  // Candidates table
  tableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const toggleId = target.getAttribute('data-toggle-details');
    if (toggleId) {
      toggleCandidateDetails(toggleId);
      return;
    }

    const openId = target.getAttribute('data-open-marks');
    if (openId) {
      renderMarksModal(openId);
    }
  });

  // CSV export & delete all
  exportButton?.addEventListener('click', () => {
    downloadCsv(buildCsv());
  });

  deleteAllButton?.addEventListener('click', () => {
    deleteAllCandidates().catch((error) => {
      console.error(error);
      setStatus('Failed to delete candidates');
    });
  });

  // Details modal close
  detailsModal?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[data-close-modal]')) closeModal();
  });

  // Add examiner form
  addExaminerForm?.addEventListener('submit', (e) => {
    handleAddExaminer(e).catch(console.error);
  });

  // Examiner list — delete button (delegated)
  examinerManagementList?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains('examiner-delete-btn')) {
      const id = target.getAttribute('data-examiner-id');
      const name = target.getAttribute('data-examiner-name');
      if (id && name) showDeleteExaminerModal(id, name);
    }
  });

  // Examiner list — section checkbox toggled (delegated)
  examinerManagementList?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const examinerId = target.getAttribute('data-examiner-id');
    const sectionId = target.getAttribute('data-section-id');
    if (!examinerId || !sectionId) return;
    handleToggleExaminerSection(examinerId, sectionId, target.checked).catch(console.error);
  });

  // Delete examiner modal buttons
  deleteExaminerCancel?.addEventListener('click', hideDeleteExaminerModal);
  deleteExaminerConfirm?.addEventListener('click', () => {
    handleConfirmDeleteExaminer().catch(console.error);
  });

  // Keyboard: Escape closes any open modal
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      hideDeleteExaminerModal();
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  registerEvents();

  if (isLoggedIn()) {
    showAdminShell();
    await loadAdminData();
  } else {
    showLoginOverlay();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Admin initialization failed');
});
