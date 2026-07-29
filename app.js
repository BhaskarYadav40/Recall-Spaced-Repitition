'use strict';

/* =========================================================================
   FSRS-4.5 scheduling engine
   Formulas & default weights from the open-spaced-repetition project
   (open-spaced-repetition/awesome-fsrs wiki — "The Algorithm").
   Grades: 1 = Again/Relearn, 2 = Hard, 3 = Good, 4 = Easy.
   ========================================================================= */
const FSRS_W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
                1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;

function clampD(d) { return Math.min(10, Math.max(1, d)); }
function clampS(s) { return Math.max(0.01, s); }

function initStability(grade) { return clampS(FSRS_W[grade - 1]); }

function initDifficulty(grade) {
  return clampD(FSRS_W[4] - (grade - 3) * FSRS_W[5]);
}

function nextDifficulty(D, grade) {
  const d0_3 = FSRS_W[4];
  const dPrime = D - FSRS_W[6] * (grade - 3);
  return clampD(FSRS_W[7] * d0_3 + (1 - FSRS_W[7]) * dPrime);
}

function retrievability(elapsedDays, S) {
  if (S <= 0) return 0;
  return Math.pow(1 + FACTOR * (elapsedDays / S), DECAY);
}

function nextStabilityRecall(D, S, R, grade) {
  let bonus = 1;
  if (grade === 2) bonus = FSRS_W[15];
  if (grade === 4) bonus = FSRS_W[16];
  const sInc = Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) *
               (Math.exp(FSRS_W[10] * (1 - R)) - 1) * bonus + 1;
  return clampS(S * sInc);
}

function nextStabilityForget(D, S, R) {
  const s = FSRS_W[11] * Math.pow(D, -FSRS_W[12]) *
            (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - R));
  return clampS(s);
}

function intervalFromStability(S, requestedRetention) {
  const days = (S / FACTOR) * (Math.pow(requestedRetention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(days));
}

function previewIntervals(task, retention, today) {
  if (!task.reps || task.stability == null) {
    return [1, 2, 3, 4].map((g) => intervalFromStability(initStability(g), retention));
  }
  const elapsed = Math.max(0, daysBetween(task.lastReview, today));
  const R = retrievability(elapsed, task.stability);
  return [1, 2, 3, 4].map((g) => {
    const S2 = g === 1
      ? nextStabilityForget(task.difficulty, task.stability, R)
      : nextStabilityRecall(task.difficulty, task.stability, R, g);
    return intervalFromStability(S2, retention);
  });
}

function applyGrade(task, grade, retention, today) {
  if (!task.reps || task.stability == null) {
    task.difficulty = initDifficulty(grade);
    task.stability = initStability(grade);
  } else {
    const elapsed = Math.max(0, daysBetween(task.lastReview, today));
    const R = retrievability(elapsed, task.stability);
    const newD = nextDifficulty(task.difficulty, grade);
    const newS = grade === 1
      ? nextStabilityForget(task.difficulty, task.stability, R)
      : nextStabilityRecall(task.difficulty, task.stability, R, grade);
    task.difficulty = newD;
    task.stability = newS;
  }
  if (grade === 1) task.lapses = (task.lapses || 0) + 1;
  task.reps = (task.reps || 0) + 1;
  task.lastReview = today;
  const interval = intervalFromStability(task.stability, retention);
  task.dueDate = addDays(today, interval);
  task.state = grade === 1 ? 'relearning' : 'review';
}

/* =========================================================================
   Date utilities (all dates are local, plain YYYY-MM-DD strings)
   ========================================================================= */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function daysBetween(fromStr, toStr) {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1), b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}
function dueLabel(dueStr, today) {
  const diff = daysBetween(today, dueStr);
  if (diff === 0) return { text: 'Today', cls: 'is-today' };
  if (diff < 0) {
    const n = -diff;
    return { text: n === 1 ? 'Yesterday' : `${n} days ago`, cls: '' };
  }
  if (diff === 1) return { text: 'Tomorrow', cls: 'is-future' };
  const [y, m, d] = dueStr.split('-').map(Number);
  if (diff < 7) {
    return { text: new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' }), cls: 'is-future' };
  }
  return { text: new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), cls: 'is-future' };
}
function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function formatInterval(days) {
  return days === 1 ? '1 day' : `${days} days`;
}

/* =========================================================================
   Storage
   ========================================================================= */
const DB_KEY = 'recall_db_v1';
const PALETTE = ['#dd9a44', '#4a90d9', '#5cb56a', '#c9c9cc', '#a480e0', '#3fb8af', '#e3789a', '#8fbf5f'];
let db;

function defaultDB() {
  return {
    version: 1,
    onboarded: false,
    settings: { requestedRetention: 0.9, reminderEnabled: false, reminderTime: '09:00', theme: 'system', lastReminderDate: null, sortBy: 'due' },
    projects: [],
    tasks: []
  };
}
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) { db = defaultDB(); return; }
    const parsed = JSON.parse(raw);
    db = Object.assign(defaultDB(), parsed);
    db.settings = Object.assign(defaultDB().settings, parsed.settings || {});
    db.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    db.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (e) {
    db = defaultDB();
  }
}
function saveDB() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* storage full/unavailable */ }
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function createProject(name) {
  const p = { id: uid(), name: name.trim(), color: PALETTE[db.projects.length % PALETTE.length] };
  db.projects.push(p);
  return p;
}
function findOrCreateProject(name) {
  const existing = db.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return existing || createProject(name);
}
function getDueTasks() {
  const today = todayStr();
  return db.tasks.filter((t) => t.dueDate <= today);
}

/* =========================================================================
   DOM refs
   ========================================================================= */
const $ = (id) => document.getElementById(id);
const onboardingEl = $('onboarding');
const appEl = $('app');
const bottomNav = $('bottomNav');
const todoList = $('todoList');
const tasksList = $('tasksList');
const projectDropdown = $('projectDropdown');
const projectDropdownLabel = $('projectDropdownLabel');
const ringSegments = $('ringSegments');
const ringTotal = $('ringTotal');
const profileStats = $('profileStats');
const toastEl = $('toast');

let currentTab = 'todo';
let activeFilter = null;
let currentRatingTaskId = null;
let formMode = 'create';
let formEditingTaskId = null;
let formSelectedProjectId = null;
let formStartDate = todayStr();
let justPickedProject = false;

const STAT_COLORS = { unseen: '#8f8d92', learning: '#dd9a44', developing: '#5cb56a', mastered: '#4a90d9' };
const SORT_ORDER = ['due', 'name', 'project'];
const SORT_LABELS = { due: 'due date', name: 'name', project: 'project' };

/* =========================================================================
   Toast
   ========================================================================= */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, 2200);
}

/* =========================================================================
   Sheets
   ========================================================================= */
function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-open'));
}
function closeSheet(id) {
  const el = $(id);
  el.classList.remove('is-open');
  setTimeout(() => { el.hidden = true; }, 260);
}
['ratingBackdrop', 'taskFormBackdrop'].forEach((id) => {
  $(id).addEventListener('click', (e) => { if (e.target === $(id)) closeSheet(id); });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('ratingBackdrop').hidden) closeSheet('ratingBackdrop');
  if (!$('taskFormBackdrop').hidden) closeSheet('taskFormBackdrop');
});

/* =========================================================================
   Rendering: task rows
   ========================================================================= */
function taskRowHTML(task, today) {
  const project = db.projects.find((p) => p.id === task.projectId);
  const color = project ? project.color : '#5f5d63';
  const pname = project ? project.name : 'No project';
  const due = dueLabel(task.dueDate, today);
  return `
    <div class="task-row" data-task-id="${task.id}">
      <div class="task-row-bar" style="background:${color}"></div>
      <div class="task-row-main">
        <button type="button" class="task-row-main-btn" data-task-id="${task.id}">
          <span class="task-row-title">${esc(task.name)}</span>
          <span class="task-row-sub">${esc(pname)}</span>
        </button>
      </div>
      <div class="task-row-right">
        <span class="task-row-due ${due.cls}">${due.text}</span>
        <button type="button" class="task-checkbox" data-task-id="${task.id}" aria-label="Review ${esc(task.name)}"></button>
      </div>
    </div>`;
}
function emptyStateHTML(title, body) {
  return `<div class="empty-state"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
}

function renderTodo() {
  const today = todayStr();
  const overdue = db.tasks.filter((t) => t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = db.tasks.filter((t) => t.dueDate === today);
  if (overdue.length === 0 && dueToday.length === 0) {
    todoList.innerHTML = db.tasks.length === 0
      ? emptyStateHTML('No topics yet', 'Tap + to add your first topic — Recall builds the review schedule automatically.')
      : emptyStateHTML("You're all caught up", 'Nothing due today. Check back tomorrow.');
    return;
  }
  let html = '';
  if (overdue.length) html += '<div class="list-section-label">Overdue</div>' + overdue.map((t) => taskRowHTML(t, today)).join('');
  if (dueToday.length) html += '<div class="list-section-label is-neutral">Today</div>' + dueToday.map((t) => taskRowHTML(t, today)).join('');
  todoList.innerHTML = html;
}

function sortTasks(list) {
  const mode = db.settings.sortBy || 'due';
  if (mode === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === 'project') return list.sort((a, b) => {
    const pa = (db.projects.find((p) => p.id === a.projectId) || {}).name || '';
    const pb = (db.projects.find((p) => p.id === b.projectId) || {}).name || '';
    return pa.localeCompare(pb) || a.dueDate.localeCompare(b.dueDate);
  });
  return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function renderTasks() {
  const today = todayStr();
  let list = db.tasks.slice();
  if (activeFilter) list = list.filter((t) => t.projectId === activeFilter);
  list = sortTasks(list);
  tasksList.innerHTML = list.length === 0
    ? (db.tasks.length === 0
      ? emptyStateHTML('No topics yet', 'Tap + to add your first topic.')
      : emptyStateHTML('Nothing here', 'No topics match this filter.'))
    : list.map((t) => taskRowHTML(t, today)).join('');
  const proj = activeFilter ? db.projects.find((p) => p.id === activeFilter) : null;
  projectDropdownLabel.textContent = proj ? proj.name : 'All Projects';
}

function handleListClick(e) {
  const cb = e.target.closest('.task-checkbox');
  if (cb) { openRatingSheet(cb.dataset.taskId); return; }
  const main = e.target.closest('.task-row-main-btn');
  if (main) { openTaskForm('edit', main.dataset.taskId); }
}
todoList.addEventListener('click', handleListClick);
tasksList.addEventListener('click', handleListClick);

/* =========================================================================
   Project filter dropdown
   ========================================================================= */
function renderProjectDropdown() {
  const items = [{ id: null, name: 'All Projects', color: null }].concat(db.projects);
  projectDropdown.innerHTML = items.map((p) => {
    const selected = activeFilter === p.id;
    const dot = p.color ? `<span class="dot" style="background:${p.color}"></span>` : '<span class="dot" style="background:transparent"></span>';
    const delBtn = p.id === null ? '' : `<button type="button" class="project-delete-btn" data-pid="${p.id}" aria-label="Delete ${esc(p.name)}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
    </button>`;
    return `<div class="project-dropdown-row">
      <button type="button" class="project-dropdown-item ${selected ? 'is-selected' : ''}" data-pid="${p.id === null ? '' : p.id}">${dot}${esc(p.name)}</button>
      ${delBtn}
    </div>`;
  }).join('');
}
function deleteProject(pid) {
  const proj = db.projects.find((p) => p.id === pid);
  if (!proj) return;
  const affected = db.tasks.filter((t) => t.projectId === pid).length;
  const msg = affected
    ? `Delete "${proj.name}"? Its ${affected} task${affected === 1 ? '' : 's'} will be deleted too.`
    : `Delete "${proj.name}"?`;
  if (!confirm(msg)) return;
  db.tasks = db.tasks.filter((t) => t.projectId !== pid);
  db.projects = db.projects.filter((p) => p.id !== pid);
  if (activeFilter === pid) activeFilter = null;
  saveDB();
  renderProjectDropdown();
  renderCurrentTab();
  toast('Project deleted');
}
$('projectDropdownBtn').addEventListener('click', () => {
  if (projectDropdown.hidden) { renderProjectDropdown(); projectDropdown.hidden = false; }
  else projectDropdown.hidden = true;
});
projectDropdown.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.project-delete-btn');
  if (delBtn) { deleteProject(delBtn.dataset.pid); return; }
  const item = e.target.closest('.project-dropdown-item');
  if (!item) return;
  activeFilter = item.dataset.pid || null;
  projectDropdown.hidden = true;
  renderTasks();
});
document.addEventListener('click', (e) => {
  if (!projectDropdown.hidden && !e.target.closest('#projectDropdown') && !e.target.closest('#projectDropdownBtn')) {
    projectDropdown.hidden = true;
  }
});
$('sortBtn').addEventListener('click', () => {
  let idx = SORT_ORDER.indexOf(db.settings.sortBy || 'due');
  idx = (idx + 1) % SORT_ORDER.length;
  db.settings.sortBy = SORT_ORDER[idx];
  saveDB();
  toast('Sorted by ' + SORT_LABELS[db.settings.sortBy]);
  renderTasks();
});
$('todoMenuBtn').addEventListener('click', openSettings);
$('tasksMenuBtn').addEventListener('click', openSettings);

/* =========================================================================
   Rating sheet
   ========================================================================= */
function openRatingSheet(taskId) {
  const t = db.tasks.find((x) => x.id === taskId);
  if (!t) return;
  currentRatingTaskId = taskId;
  $('ratingTaskName').textContent = t.name;
  const today = todayStr();
  const previews = previewIntervals(t, db.settings.requestedRetention, today);
  [1, 2, 3, 4].forEach((g, i) => { $('pill-' + g).textContent = formatInterval(previews[i]); });
  openSheet('ratingBackdrop');
}
$('ratingSheet').addEventListener('click', (e) => {
  const row = e.target.closest('.rating-row');
  if (!row) return;
  const grade = Number(row.dataset.grade);
  const t = db.tasks.find((x) => x.id === currentRatingTaskId);
  if (!t) return;
  applyGrade(t, grade, db.settings.requestedRetention, todayStr());
  saveDB();
  closeSheet('ratingBackdrop');
  renderCurrentTab();
  const label = dueLabel(t.dueDate, todayStr()).text;
  toast(`Next review: ${label}`);
});

/* =========================================================================
   Add / edit task sheet
   ========================================================================= */
const taskNameInput = $('taskNameInput');
const taskProjectInput = $('taskProjectInput');
const taskNotesInput = $('taskNotesInput');
const taskStartBtn = $('taskStartBtn');
const taskStartLabel = $('taskStartLabel');
const taskStartDate = $('taskStartDate');
const taskFormSubmit = $('taskFormSubmit');
const taskDeleteRow = $('taskDeleteRow');
const taskAlgoInfo = $('taskAlgoInfo');
const projectSuggestions = $('projectSuggestions');

function openTaskForm(mode, taskId) {
  formMode = mode;
  formEditingTaskId = taskId || null;
  taskAlgoInfo.hidden = true;
  taskStartBtn.hidden = false;
  taskStartDate.hidden = true;

  if (mode === 'create') {
    taskNameInput.value = '';
    taskNotesInput.value = '';
    taskProjectInput.value = '';
    formSelectedProjectId = null;
    formStartDate = todayStr();
    taskStartLabel.textContent = 'Start today';
    taskFormSubmit.textContent = 'Add Task';
    taskDeleteRow.hidden = true;
  } else {
    const t = db.tasks.find((x) => x.id === taskId);
    if (!t) return;
    taskNameInput.value = t.name;
    taskNotesInput.value = t.notes || '';
    const proj = db.projects.find((p) => p.id === t.projectId);
    taskProjectInput.value = proj ? proj.name : '';
    formSelectedProjectId = t.projectId;
    formStartDate = t.dueDate;
    taskFormSubmit.textContent = 'Save changes';
    taskDeleteRow.hidden = false;
    if (t.reps > 0) {
      taskStartBtn.hidden = true;
      const today = todayStr();
      taskAlgoInfo.hidden = false;
      taskAlgoInfo.innerHTML = `Next review: <strong>${esc(dueLabel(t.dueDate, today).text)}</strong> · Stability ${t.stability.toFixed(1)}d · Difficulty ${t.difficulty.toFixed(1)}/10 · Reviewed ${t.reps}×`;
    } else {
      taskStartLabel.textContent = formStartDate === todayStr() ? 'Start today' : formatDateLong(formStartDate);
    }
  }
  openSheet('taskFormBackdrop');
}
$('fabAddTodo').addEventListener('click', () => openTaskForm('create'));
$('fabAddTask').addEventListener('click', () => openTaskForm('create'));

taskStartBtn.addEventListener('click', () => {
  taskStartBtn.hidden = true;
  taskStartDate.hidden = false;
  taskStartDate.value = formStartDate;
  if (taskStartDate.showPicker) { try { taskStartDate.showPicker(); } catch (e) { /* unsupported */ } }
  else taskStartDate.focus();
});
taskStartDate.addEventListener('change', () => {
  formStartDate = taskStartDate.value || todayStr();
  taskStartDate.hidden = true;
  taskStartBtn.hidden = false;
  taskStartLabel.textContent = formStartDate === todayStr() ? 'Start today' : formatDateLong(formStartDate);
});
taskStartDate.addEventListener('blur', () => {
  setTimeout(() => { if (!taskStartDate.hidden) { taskStartDate.hidden = true; taskStartBtn.hidden = false; } }, 150);
});

function updateProjectSuggestions() {
  if (justPickedProject) { justPickedProject = false; return; }
  formSelectedProjectId = null;
  const q = taskProjectInput.value.trim().toLowerCase();
  const matches = (q ? db.projects.filter((p) => p.name.toLowerCase().includes(q)) : db.projects.slice()).slice(0, 8);
  let html = matches.map((p) => `<button type="button" class="project-suggestion" data-pid="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join('');
  const exact = db.projects.some((p) => p.name.toLowerCase() === q);
  if (q && !exact) {
    html += `<button type="button" class="project-suggestion is-create" data-create="1">+ Create "${esc(taskProjectInput.value.trim())}"</button>`;
  }
  projectSuggestions.innerHTML = html;
  projectSuggestions.hidden = !html;
}
taskProjectInput.addEventListener('input', updateProjectSuggestions);
taskProjectInput.addEventListener('focus', updateProjectSuggestions);
projectSuggestions.addEventListener('click', (e) => {
  const item = e.target.closest('.project-suggestion');
  if (!item) return;
  justPickedProject = true;
  if (item.classList.contains('is-create')) {
    const proj = createProject(taskProjectInput.value.trim());
    formSelectedProjectId = proj.id;
    taskProjectInput.value = proj.name;
  } else {
    const p = db.projects.find((x) => x.id === item.dataset.pid);
    if (p) { formSelectedProjectId = p.id; taskProjectInput.value = p.name; }
  }
  projectSuggestions.hidden = true;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#taskProjectInput') && !e.target.closest('#projectSuggestions')) projectSuggestions.hidden = true;
});

taskFormSubmit.addEventListener('click', () => {
  const name = taskNameInput.value.trim();
  if (!name) { toast('Give the topic a name'); taskNameInput.focus(); return; }
  const projText = taskProjectInput.value.trim();
  let projectId = formSelectedProjectId;
  if (!projectId) {
    if (!projText) { toast('Pick or create a project'); taskProjectInput.focus(); return; }
    projectId = findOrCreateProject(projText).id;
  }
  if (formMode === 'create') {
    db.tasks.push({
      id: uid(), name, projectId, notes: taskNotesInput.value.trim(),
      createdAt: todayStr(), dueDate: formStartDate, state: 'new',
      reps: 0, lapses: 0, stability: null, difficulty: null, lastReview: null
    });
    toast('Task added');
  } else {
    const t = db.tasks.find((x) => x.id === formEditingTaskId);
    if (t) {
      t.name = name; t.projectId = projectId; t.notes = taskNotesInput.value.trim();
      if (!t.reps) t.dueDate = formStartDate;
      toast('Task updated');
    }
  }
  saveDB();
  closeSheet('taskFormBackdrop');
  renderCurrentTab();
});
$('taskDeleteBtn').addEventListener('click', () => {
  if (!formEditingTaskId) return;
  if (!confirm('Delete this task? This can\'t be undone.')) return;
  db.tasks = db.tasks.filter((t) => t.id !== formEditingTaskId);
  saveDB();
  closeSheet('taskFormBackdrop');
  renderCurrentTab();
  toast('Task deleted');
});

/* =========================================================================
   Onboarding
   ========================================================================= */
let obIndex = 0;
function showObSlide(i) {
  obIndex = i;
  document.querySelectorAll('.ob-slide').forEach((s) => s.classList.toggle('is-active', Number(s.dataset.slide) === i));
  $('obDots').innerHTML = [0, 1, 2, 3].map((n) => `<span class="${n === i ? 'is-active' : ''}"></span>`).join('');
  $('obNext').textContent = i === 3 ? 'Get Started' : 'Next';
}
$('obNext').addEventListener('click', () => {
  if (obIndex < 3) showObSlide(obIndex + 1);
  else finishOnboarding();
});
$('obSlides').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const [name, projectName] = chip.dataset.example.split('|');
  const proj = findOrCreateProject(projectName);
  db.tasks.push({
    id: uid(), name, projectId: proj.id, notes: '', createdAt: todayStr(), dueDate: todayStr(),
    state: 'new', reps: 0, lapses: 0, stability: null, difficulty: null, lastReview: null
  });
  finishOnboarding();
});
function finishOnboarding() {
  db.onboarded = true;
  saveDB();
  onboardingEl.hidden = true;
  showApp();
}
function showOnboarding() {
  onboardingEl.hidden = false;
  showObSlide(0);
}

/* =========================================================================
   Navigation
   ========================================================================= */
function showApp() {
  appEl.hidden = false;
  switchTab('todo');
}
function switchTab(tab) {
  currentTab = tab;
  ['todo', 'tasks', 'profile'].forEach((t) => { $('view-' + t).hidden = t !== tab; });
  $('view-settings').hidden = true;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === tab));
  bottomNav.hidden = false;
  renderCurrentTab();
}
function renderCurrentTab() {
  if (currentTab === 'todo') renderTodo();
  if (currentTab === 'tasks') renderTasks();
  if (currentTab === 'profile') renderProfile();
  updateDueCountCache();
  maybeCheckReminder();
}
bottomNav.addEventListener('click', (e) => {
  const b = e.target.closest('.nav-btn');
  if (b) switchTab(b.dataset.nav);
});
function openSettings() {
  $('view-' + currentTab).hidden = true;
  $('view-settings').hidden = false;
  bottomNav.hidden = true;
  renderSettings();
}
function closeSettingsView() {
  $('view-settings').hidden = true;
  $('view-' + currentTab).hidden = false;
  bottomNav.hidden = false;
}
$('settingsBtn').addEventListener('click', openSettings);
$('settingsBack').addEventListener('click', closeSettingsView);

/* =========================================================================
   Profile
   ========================================================================= */
function renderProfile() {
  const tasks = db.tasks;
  const unseen = tasks.filter((t) => !t.reps).length;
  const learning = tasks.filter((t) => t.reps && t.stability < 7).length;
  const developing = tasks.filter((t) => t.reps && t.stability >= 7 && t.stability < 30).length;
  const mastered = tasks.filter((t) => t.reps && t.stability >= 30).length;
  const total = tasks.length;
  ringTotal.textContent = total;

  const r = 82, circumference = 2 * Math.PI * r;
  let svg = '';
  if (total === 0) {
    svg = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#2a2a2e" stroke-width="20"/>`;
  } else {
    let offset = 0;
    [['unseen', unseen], ['learning', learning], ['developing', developing], ['mastered', mastered]].forEach(([key, n]) => {
      if (n <= 0) return;
      const len = circumference * (n / total);
      svg += `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${STAT_COLORS[key]}" stroke-width="20" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}"/>`;
      offset += len;
    });
  }
  ringSegments.innerHTML = svg;
  profileStats.innerHTML = `
    <div class="profile-stat"><b style="color:${STAT_COLORS.unseen}">${unseen}</b><span>Unseen</span></div>
    <div class="profile-stat"><b style="color:${STAT_COLORS.learning}">${learning}</b><span>Learning</span></div>
    <div class="profile-stat"><b style="color:${STAT_COLORS.developing}">${developing}</b><span>Developing</span></div>
    <div class="profile-stat"><b style="color:${STAT_COLORS.mastered}">${mastered}</b><span>Mastered</span></div>`;
}

/* =========================================================================
   Settings
   ========================================================================= */
function renderSettings() {
  $('reminderToggle').checked = !!db.settings.reminderEnabled;
  $('reminderTimeRow').hidden = !db.settings.reminderEnabled;
  $('reminderTime').value = db.settings.reminderTime || '09:00';
  $('retentionSlider').value = Math.round(db.settings.requestedRetention * 100);
  $('retentionValue').textContent = $('retentionSlider').value + '%';
  $('themeSelect').value = db.settings.theme || 'system';
  $('reminderHint').textContent = 'Recall checks for due topics the moment you open the app, and — on Android browsers that support it — opportunistically in the background too. A plain web app can\'t access the phone\'s exact-time alarm system the way an installed native app can, so background timing isn\'t guaranteed; opening Recall always catches you up instantly.';
}
$('reminderToggle').addEventListener('change', async () => {
  const toggle = $('reminderToggle');
  if (toggle.checked) {
    if (!('Notification' in window)) { toast('Notifications aren\'t supported here'); toggle.checked = false; return; }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notification permission denied'); toggle.checked = false; return; }
    db.settings.reminderEnabled = true;
    saveDB();
    $('reminderTimeRow').hidden = false;
    registerPeriodicSync();
    toast('Daily reminder on');
  } else {
    db.settings.reminderEnabled = false;
    saveDB();
    $('reminderTimeRow').hidden = true;
    toast('Daily reminder off');
  }
});
$('reminderTime').addEventListener('change', () => {
  db.settings.reminderTime = $('reminderTime').value;
  saveDB();
});
$('retentionSlider').addEventListener('input', () => {
  const v = $('retentionSlider').value;
  $('retentionValue').textContent = v + '%';
  db.settings.requestedRetention = Number(v) / 100;
  saveDB();
});
$('themeSelect').addEventListener('change', () => {
  db.settings.theme = $('themeSelect').value;
  saveDB();
  applyTheme();
});
$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `recall-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup downloaded');
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.tasks)) throw new Error('bad shape');
      if (!confirm('Replace all current data with this backup?')) return;
      db = Object.assign(defaultDB(), parsed);
      db.settings = Object.assign(defaultDB().settings, parsed.settings || {});
      saveDB();
      applyTheme();
      renderCurrentTab();
      toast('Data imported');
    } catch (err) {
      toast('That file doesn\'t look like a Recall backup');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$('resetBtn').addEventListener('click', () => {
  if (!confirm('Delete all projects and tasks? This can\'t be undone.')) return;
  db.tasks = [];
  db.projects = [];
  activeFilter = null;
  saveDB();
  renderCurrentTab();
  toast('All data cleared');
});

/* =========================================================================
   Theme
   ========================================================================= */
function applyTheme() {
  const mode = db.settings.theme || 'system';
  let resolved = mode;
  if (mode === 'system') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  if (resolved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (db.settings.theme === 'system') applyTheme();
  });
}

/* =========================================================================
   Reminders (best-effort — see settings hint for the honest explanation)
   ========================================================================= */
async function updateDueCountCache() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('recall-cache-v1');
    const body = JSON.stringify({ date: todayStr(), count: getDueTasks().length });
    await cache.put('./__due_count__', new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* best effort only */ }
}
async function fireNotification(count) {
  const body = count === 1 ? 'You have 1 topic due for review today.' : `You have ${count} topics due for review today.`;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Recall', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-reminder' });
      return;
    }
  } catch (e) { /* fall through */ }
  try { new Notification('Recall', { body, icon: 'icons/icon-192.png' }); } catch (e) { /* no permission / unsupported */ }
}
function maybeCheckReminder() {
  const s = db.settings;
  if (!s.reminderEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  if (s.lastReminderDate === today) return;
  const [hh, mm] = (s.reminderTime || '09:00').split(':').map(Number);
  const now = new Date();
  const scheduled = new Date();
  scheduled.setHours(hh, mm, 0, 0);
  if (now < scheduled) return;
  const dueCount = getDueTasks().length;
  if (dueCount <= 0) return;
  fireNotification(dueCount);
  s.lastReminderDate = today;
  saveDB();
}
async function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') {
        await reg.periodicSync.register('daily-reminder', { minInterval: 12 * 60 * 60 * 1000 });
      }
    } else if ('sync' in reg) {
      await reg.sync.register('daily-reminder');
    }
  } catch (e) { /* not supported on this browser — foreground catch-up still works */ }
}
setInterval(maybeCheckReminder, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderCurrentTab();
});

/* =========================================================================
   Service worker
   ========================================================================= */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* =========================================================================
   Init
   ========================================================================= */
function init() {
  loadDB();
  applyTheme();
  if (!db.onboarded) showOnboarding();
  else showApp();
  registerServiceWorker();
  if (db.settings.reminderEnabled) registerPeriodicSync();
}
init();
