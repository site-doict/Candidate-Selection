import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE' && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const statusEl = document.getElementById('admin-status');
const exportButton = document.getElementById('export-csv-button');
const tableBody = document.getElementById('admin-candidate-body');
const detailsModal = document.getElementById('details-modal');
const detailsModalContent = document.getElementById('details-modal-content');

const state = {
  candidates: [],
  sections: [],
  finalMarks: [],
  marks: [],
  examiners: [],
  expandedCandidateIds: new Set(),
};

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

function groupByCandidate(rows, candidateKey = 'candidate_id') {
  return rows.reduce((map, row) => {
    const candidateId = normalizeId(row[candidateKey]);
    if (!candidateId) {
      return map;
    }
    if (!map.has(candidateId)) {
      map.set(candidateId, []);
    }
    map.get(candidateId).push(row);
    return map;
  }, new Map());
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
    const examinerCount = Number(getRowValue(finalMarkRow, 'examiner_count', 'count') ?? new Set(relatedMarks.map((row) => normalizeId(row.examiner_id))).size);

    return {
      section,
      finalScore,
      examinerCount,
      marks: relatedMarks,
    };
  });

  const totalScore = summary.reduce((sum, item) => sum + Number(item.finalScore ?? 0), 0);
  const passMark = candidate.post_applied === 'supervisor' ? 80 : 70;
  const status = totalScore >= passMark ? 'Pass' : 'Fail';

  return {
    sections: summary,
    totalScore,
    passMark,
    status,
  };
}

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
      ? summary.sections.map(({ section, finalScore, examinerCount }) => `
          <div class="section-summary-row">
            <div>
              <strong>${escapeHtml(section.section_name)}</strong>
              <small>${escapeHtml(section.section_type)}</small>
            </div>
            <div class="section-score-box">${escapeHtml(finalScore)}</div>
            <div class="section-count-box">${escapeHtml(examinerCount)} examiner(s)</div>
          </div>
        `).join('')
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
    ? sections.map((section) => {
        const key = `${normalizeId(candidate.id)}::${normalizeId(section.id)}`;
        const marks = marksByCandidateSection.get(key) ?? [];
        const rows = marks.length
          ? marks.map((mark) => `
              <tr>
                <td>${escapeHtml(examinerMap.get(normalizeId(mark.examiner_id)) ?? mark.examiner_id)}</td>
                <td>${escapeHtml(sectionMap.get(normalizeId(mark.section_id))?.section_name ?? '')}</td>
                <td>${escapeHtml(getRowValue(mark, 'score'))}</td>
                <td>${escapeHtml(getRowValue(mark, 'method'))}</td>
                <td>${escapeHtml(getRowValue(mark, 'updated_at'))}</td>
              </tr>
            `).join('')
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
      }).join('')
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

function downloadCsv(text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
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
    const sectionMap = new Map(summary.sections.map(({ section, finalScore, examinerCount }) => [String(section.id), { finalScore, examinerCount }]));
    const row = [
      candidate.roll_no,
      candidate.name,
      candidate.post_applied,
      summary.passMark,
      summary.totalScore,
      summary.status,
    ];

    state.sections
      .sort((a, b) => Number(a.section_order ?? 0) - Number(b.section_order ?? 0))
      .forEach((section) => {
        const item = sectionMap.get(String(section.id));
        row.push(item?.finalScore ?? '', item?.examinerCount ?? '');
      });

    rows.push(row.map(csvEscape).join(','));
  });

  return rows.join('\n');
}

async function loadAdminData() {
  if (!supabase) {
    setStatus('Add Supabase credentials in config.js');
    return;
  }

  setStatus('Loading data...');

  const [candidatesResult, sectionsResult, finalMarksResult, marksResult, examinersResult] = await Promise.all([
    supabase.from('candidates').select('id, roll_no, name, post_applied').order('roll_no', { ascending: true }),
    supabase.from('sections').select('id, post_type, section_name, max_marks, section_type, section_order').order('section_order', { ascending: true }),
    supabase.from('final_marks').select('*'),
    supabase.from('marks').select('candidate_id, examiner_id, section_id, score, method, updated_at'),
    supabase.from('examiners').select('id, name'),
  ]);

  const errors = [candidatesResult.error, sectionsResult.error, finalMarksResult.error, marksResult.error, examinersResult.error].filter(Boolean);
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

  renderCandidateTable();
  setStatus(`Loaded ${state.candidates.length} candidates`);
}

function registerEvents() {
  tableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

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

  exportButton?.addEventListener('click', () => {
    downloadCsv(buildCsv());
  });

  detailsModal?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-close-modal]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });
}

async function bootstrap() {
  registerEvents();
  await loadAdminData();
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Admin initialization failed');
});
