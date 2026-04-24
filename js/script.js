// ═══════════════════════════════════════════════
// STATE & GLOBALS
// ═══════════════════════════════════════════════
let questions = [];
let selectedMode = null;
let currentQ = 0;
let examAnswers = {};
let flagged = new Set();
let timerInterval = null;
let totalSeconds = 0;
let originalTotalSeconds = 0;
let studyScore = 0;
let studyAnswered = false;
let studyResults = [];
let quizMode = null;
let timePerQuestion = 90;
let isPaused = false;
let allResults = [];
let activeFilter = 'all';
let useNegativeMarking = false;
let questionTimings = {};
let questionStartTime = 0;
let smartFilterTag = null;
let dailyGoal = 100;

let pomodoroInterval = null;
let pomodoroSeconds = 25 * 60;
let pomodoroRunning = false;
let pomodoroIsBreak = false;
const POMODORO_FOCUS = 25 * 60;
const POMODORO_BREAK = 5 * 60;

let flashcardDeck = [];
let flashcardIdx = 0;

let ocrFile = null;

let aiConfig = {
  provider: 'pollinations',
  apiKey: '',
  model: 'gemini-2.5-flash',
  pollinationsModel: 'openai'
};

// ═══════════════════════════════════════════════
// INDEXEDDB HELPERS
// ═══════════════════════════════════════════════
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MedQuizProDB', 3);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('banks')) db.createObjectStore('banks', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('analytics')) db.createObjectStore('analytics', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('srs')) db.createObjectStore('srs', { keyPath: 'qHash' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'folderName' });
      if (!db.objectStoreNames.contains('milestones')) db.createObjectStore('milestones', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(data);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ═══════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════
function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('show');
    if (id === 'bankModal') loadBankList();
    if (id === 'folderModal') loadFolderUI();
    if (id === 'ocrModal') {
      const ocrRes = document.getElementById('ocrResult');
      const ocrProg = document.getElementById('ocrProgress');
      const ocrBtn = document.getElementById('ocrConvertBtn');
      if (ocrRes) ocrRes.style.display = 'none';
      if (ocrProg) ocrProg.style.display = 'none';
      if (ocrBtn) ocrBtn.disabled = !ocrFile;
    }
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = newTheme === 'light' ? '☀️' : '🌙';
  localStorage.setItem('medquiz_theme', newTheme);
}

function onProviderChange() {
  const providerSelect = document.getElementById('providerSelect');
  if (!providerSelect) return;
  const provider = providerSelect.value;
  const pollConfig = document.getElementById('pollinationsConfig');
  const geminiConfig = document.getElementById('geminiConfig');
  if (pollConfig) pollConfig.style.display = provider === 'pollinations' ? 'block' : 'none';
  if (geminiConfig) geminiConfig.style.display = provider === 'gemini' ? 'block' : 'none';
}

function saveAIConfig() {
  const providerSelect = document.getElementById('providerSelect');
  const pollinationsModelSelect = document.getElementById('pollinationsModelSelect');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  if (providerSelect) aiConfig.provider = providerSelect.value;
  if (pollinationsModelSelect) aiConfig.pollinationsModel = pollinationsModelSelect.value;
  if (apiKeyInput) aiConfig.apiKey = apiKeyInput.value.trim();
  if (modelSelect) aiConfig.model = modelSelect.value;
  localStorage.setItem('medquiz_ai_config', JSON.stringify(aiConfig));
  updateAIStatus();
  closeModal('aiConfigModal');
  showToast(aiConfig.provider === 'pollinations' ? '✅ Pollinations AI enabled!' : (aiConfig.apiKey ? '✅ Gemini AI enabled!' : '⚠️ AI disabled (no Gemini key)'));
}

function updateAIStatus() {
  const status = document.getElementById('aiStatus');
  const text = document.getElementById('aiStatusText');
  if (!status || !text) return;
  if (aiConfig.provider === 'pollinations' || aiConfig.apiKey) {
    status.classList.add('connected');
    text.textContent = aiConfig.provider === 'pollinations' ? 'AI Ready (Free)' : 'AI Ready';
  } else {
    status.classList.remove('connected');
    text.textContent = 'AI Off';
  }
}

async function callAI(prompt) {
  const provider = aiConfig.provider || 'pollinations';
  if (provider === 'gemini') {
    if (!aiConfig.apiKey) throw new Error('Gemini API key not set. Click 🤖 to add one, or switch to Pollinations (free).');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
  }
  const model = aiConfig.pollinationsModel || 'openai';
  const url = 'https://text.pollinations.ai/openai';
  const body = {
    model: model,
    messages: [{ role: 'system', content: 'You are an expert medical educator and tutor. Provide clear, accurate, concise explanations.' }, { role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1024,
    private: true
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const simpleUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&private=true`;
      const simpleRes = await fetch(simpleUrl);
      if (!simpleRes.ok) throw new Error(`Pollinations API error: HTTP ${simpleRes.status}`);
      return await simpleRes.text();
    }
    const data = await res.json();
    if (data.choices && data.choices[0]) return data.choices[0].message?.content || data.choices[0].text || 'No response';
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) {
    try {
      const simpleUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&private=true`;
      const simpleRes = await fetch(simpleUrl);
      if (!simpleRes.ok) throw new Error(`Pollinations API error: HTTP ${simpleRes.status}`);
      return await simpleRes.text();
    } catch (e2) { throw new Error(`AI request failed: ${e.message}`); }
  }
}

// ═══════════════════════════════════════════════
// SAMPLE & STORAGE (Home page)
// ═══════════════════════════════════════════════
function loadSample() {
  const sample = [
    { "question": "A body recovered from a river shows fine froth at mouth and nostrils. Which finding most strongly supports antemortem drowning?", "options": ["Cutis anserina", "Washerwoman hands", "Fine persistent froth in airways", "Water in stomach"], "correct_option": "Fine persistent froth in airways", "explanation": "Fine, persistent froth indicates active respiration in water. Other findings are less specific.", "difficulty": 3, "subject": "Forensic Medicine", "topic": "Asphyxial Deaths", "tags": ["PYQ", "HYT"] },
    { "question": "Which best describes rigor mortis?", "options": ["Postmortem cooling", "Muscle stiffening due to ATP depletion", "Skin discoloration", "Soft tissue decomposition"], "correct_option": "Muscle stiffening due to ATP depletion", "explanation": "Rigor mortis is postmortem muscle stiffening from ATP depletion, beginning 2-6 hours after death.", "difficulty": 2, "subject": "Forensic Medicine", "topic": "Postmortem Changes", "tags": ["HYT"] },
    { "question": "The 'café au lait' appearance of blood in CO poisoning is due to:", "options": ["Carboxyhemoglobin", "Methemoglobin", "Sulfhemoglobin", "Oxyhemoglobin"], "correct_option": "Carboxyhemoglobin", "explanation": "CO binds hemoglobin with 240x affinity forming carboxyhemoglobin, giving cherry-red color.", "difficulty": 3, "subject": "Forensic Medicine", "topic": "Poisoning", "tags": ["PYQ"] }
  ];
  const input = document.getElementById('jsonInput');
  if (input) {
    input.value = JSON.stringify(sample, null, 2);
    showToast('✅ Sample questions loaded!');
  }
}

function loadFromStorage() {
  const saved = localStorage.getItem('medquiz_last_json');
  if (saved) {
    const input = document.getElementById('jsonInput');
    if (input) {
      input.value = saved;
      showToast('💾 Last session loaded');
    }
  } else showToast('⚠️ No saved session found');
}

function clearInput() {
  const input = document.getElementById('jsonInput');
  if (input) input.value = '';
  const parseStatus = document.getElementById('parseStatus');
  if (parseStatus) parseStatus.style.display = 'none';
  const qPreview = document.getElementById('qPreview');
  if (qPreview) qPreview.style.display = 'none';
  const modeSelector = document.getElementById('modeSelector');
  if (modeSelector) modeSelector.style.display = 'none';
  const startSection = document.getElementById('startSection');
  if (startSection) startSection.style.display = 'none';
  const timerConfig = document.getElementById('timerConfig');
  if (timerConfig) timerConfig.classList.remove('show');
  const scoringConfig = document.getElementById('scoringConfig');
  if (scoringConfig) scoringConfig.classList.remove('show');
  const smartFilters = document.getElementById('smartFilters');
  if (smartFilters) smartFilters.style.display = 'none';
  const retakeCard = document.getElementById('retakeModeCard');
  if (retakeCard) retakeCard.style.display = 'none';
  questions = [];
  selectedMode = null;
  smartFilterTag = null;
}

// ═══════════════════════════════════════════════
// CSV/EXCEL UPLOAD
// ═══════════════════════════════════════════════
function triggerCSVUpload() {
  const input = document.getElementById('csvFileInput');
  if (input) input.click();
}

function handleCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      const converted = rows.map((row, i) => ({
        question: row.question || row.Question || '',
        options: [row.option_a || row.OptionA || row['Option A'] || '', row.option_b || row.OptionB || row['Option B'] || '', row.option_c || row.OptionC || row['Option C'] || '', row.option_d || row.OptionD || row['Option D'] || '', row.option_e || row.OptionE || row['Option E'] || ''].filter(Boolean),
        correct_option: row.correct_option || row.CorrectOption || row['Correct Option'] || '',
        explanation: row.explanation || row.Explanation || '',
        subject: row.subject || row.Subject || '',
        topic: row.topic || row.Topic || '',
        difficulty: parseInt(row.difficulty || row.Difficulty) || null,
        tags: (row.tags || row.Tags || '').toString().split(/[,;]/).map(t => t.trim()).filter(Boolean),
        image_url: row.image_url || row.ImageURL || ''
      })).filter(q => q.question && q.options.length >= 2 && q.correct_option);
      if (converted.length === 0) { showToast('⚠️ No valid questions found in file'); return; }
      const input = document.getElementById('jsonInput');
      if (input) {
        input.value = JSON.stringify(converted, null, 2);
        showToast(`✅ ${converted.length} questions imported from ${file.name}`);
        parseJSON();
      }
    } catch (err) {
      showToast('⚠️ Error reading file. Ensure it has columns: question, option_a-d, correct_option');
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// ═══════════════════════════════════════════════
// OCR
// ═══════════════════════════════════════════════
function setupOCRZone() {
  const zone = document.getElementById('ocrZone');
  if (!zone) return;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) { ocrFile = file; showOCRPreview(file); document.getElementById('ocrConvertBtn').disabled = false; }
  });
}

function handleOCRUpload(event) {
  const file = event.target.files[0];
  if (file) { ocrFile = file; showOCRPreview(file); document.getElementById('ocrConvertBtn').disabled = false; }
}

function showOCRPreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('ocrPreviewImg');
    if (img) { img.src = e.target.result; img.classList.add('show'); }
  };
  reader.readAsDataURL(file);
}

async function runOCR() {
  if (!ocrFile) return;
  const progress = document.getElementById('ocrProgress');
  const progressText = document.getElementById('ocrProgressText');
  const result = document.getElementById('ocrResult');
  const btn = document.getElementById('ocrConvertBtn');
  if (progress) progress.style.display = 'block';
  if (result) result.style.display = 'none';
  if (btn) btn.disabled = true;
  try {
    if (progressText) progressText.textContent = 'Running OCR engine...';
    const worker = await Tesseract.recognize(ocrFile, 'eng', {
      logger: m => { if (m.status === 'recognizing text' && progressText) progressText.textContent = `Recognizing... ${Math.round(m.progress*100)}%`; }
    });
    const text = worker.data.text;
    if (progressText) progressText.textContent = 'Parsing with AI...';
    const prompt = `Extract all MCQs from this OCR text and return as valid JSON array. Each object: question, options (array of 4-5 strings), correct_option (exact match), explanation, subject, topic, difficulty (1-5), tags (array). Only output valid JSON, no other text. OCR text:\n\n${text}`;
    const aiResponse = await callAI(prompt);
    let json = aiResponse;
    const match = aiResponse.match(/\[[\s\S]*\]/);
    if (match) json = match[0];
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No questions detected');
    const input = document.getElementById('jsonInput');
    if (input) input.value = JSON.stringify(parsed, null, 2);
    if (result) { result.style.display = 'block'; result.innerHTML = `<div class="parse-status success">✅ ${parsed.length} questions extracted via OCR! JSON loaded. Close this modal and click "Load Questions".</div>`; }
    showToast(`✅ ${parsed.length} questions extracted!`);
  } catch (e) {
    if (result) { result.style.display = 'block'; result.innerHTML = `<div class="parse-status error">⚠️ OCR/parsing failed: ${e.message}. Try a clearer image or paste JSON manually.</div>`; }
  } finally {
    if (progress) progress.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
// JSON PARSING (Home)
// ═══════════════════════════════════════════════
function parseJSON() {
  const raw = document.getElementById('jsonInput').value.trim();
  const status = document.getElementById('parseStatus');
  if (!raw) { showStatus(status, 'error', '⚠️ Please paste your JSON questions first.'); return; }
  try {
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      if (typeof parsed === 'object' && parsed.question) parsed = [parsed];
      else throw new Error('JSON must be an array or single question object.');
    }
    const valid = [];
    const errors = [];
    parsed.forEach((q, i) => {
      if (!q.question) { errors.push(`Q${i+1}: Missing "question"`); return; }
      if (!q.options || !Array.isArray(q.options) || q.options.length < 2) { errors.push(`Q${i+1}: "options" must be array ≥2`); return; }
      if (!q.correct_option) { errors.push(`Q${i+1}: Missing "correct_option"`); return; }
      if (!q.options.includes(q.correct_option)) { errors.push(`Q${i+1}: correct_option not in options`); return; }
      valid.push(q);
    });
    if (valid.length === 0) { showStatus(status, 'error', `❌ No valid questions.\n${errors.join('\n')}`); return; }
    questions = valid;
    localStorage.setItem('medquiz_last_json', raw);
    let msg = `✅ ${valid.length} question${valid.length>1?'s':''} loaded!`;
    if (errors.length) msg += ` (${errors.length} skipped)`;
    showStatus(status, 'success', msg);
    renderPreview();
    const modeSelector = document.getElementById('modeSelector');
    if (modeSelector) modeSelector.style.display = 'block';
    document.getElementById('startSection').style.display = 'none';
    document.getElementById('timerConfig').classList.remove('show');
    document.getElementById('scoringConfig').classList.remove('show');
    document.getElementById('smartFilters').style.display = 'flex';
    const retakeCard = document.getElementById('retakeModeCard');
    if (retakeCard) retakeCard.style.display = hasRetakeData() ? 'block' : 'none';
    selectedMode = null;
    document.getElementById('examModeCard').classList.remove('selected');
    document.getElementById('studyModeCard').classList.remove('selected');
    if (retakeCard) retakeCard.classList.remove('selected');
    setTimeout(() => document.getElementById('modeSelector').scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  } catch (e) { showStatus(status, 'error', `❌ Invalid JSON: ${e.message}`); }
}

function showStatus(el, type, msg) {
  if (el) { el.className = `parse-status ${type}`; el.textContent = msg; el.style.display = 'block'; }
}

function renderPreview() {
  const preview = document.getElementById('qPreview');
  const chipList = document.getElementById('qChipList');
  const statsBar = document.getElementById('statsBar');
  const title = document.getElementById('qPreviewTitle');
  if (!preview) return;
  title.textContent = `${questions.length} Question${questions.length>1?'s':''} Ready`;
  chipList.innerHTML = '';
  questions.forEach((q, i) => {
    const chip = document.createElement('div');
    chip.className = 'q-chip';
    chip.textContent = `Q${i+1}: ${q.question.substring(0,50)}${q.question.length>50?'...':''}`;
    chipList.appendChild(chip);
  });
  const subjects = [...new Set(questions.map(q => q.subject).filter(Boolean))];
  const topics = [...new Set(questions.map(q => q.topic).filter(Boolean))];
  const withDiff = questions.filter(q => q.difficulty);
  const avgDiff = withDiff.length ? (withDiff.reduce((a, q) => a + q.difficulty, 0) / withDiff.length).toFixed(1) : '—';
  statsBar.innerHTML = `
    <div class="stat-item"><div class="stat-val">${questions.length}</div><div class="stat-lbl">Questions</div></div>
    <div class="stat-item"><div class="stat-val">${subjects.length||'—'}</div><div class="stat-lbl">Subjects</div></div>
    <div class="stat-item"><div class="stat-val">${topics.length||'—'}</div><div class="stat-lbl">Topics</div></div>
    <div class="stat-item"><div class="stat-val">${avgDiff}</div><div class="stat-lbl">Avg Diff</div></div>`;
  preview.style.display = 'block';
}

function toggleSmartFilter(tag, el) {
  if (smartFilterTag === tag) { smartFilterTag = null; el.classList.remove('active'); showToast('🔄 Filter removed — all questions'); }
  else {
    document.querySelectorAll('.smart-filter-chip[data-tag]').forEach(c => c.classList.remove('active'));
    smartFilterTag = tag;
    el.classList.add('active');
    const count = questions.filter(q => q.tags && q.tags.includes(tag)).length;
    showToast(`🔍 Filtered: ${count} questions tagged "${tag}"`);
  }
}

function resetSmartFilters() {
  smartFilterTag = null;
  document.querySelectorAll('.smart-filter-chip[data-tag]').forEach(c => c.classList.remove('active'));
  showToast('🔄 All questions shown');
}

function getFilteredQuestions() {
  if (!smartFilterTag) return questions;
  return questions.filter(q => q.tags && q.tags.includes(smartFilterTag));
}

// ═══════════════════════════════════════════════
// MODE & SCORING
// ═══════════════════════════════════════════════
function selectMode(mode) {
  selectedMode = mode;
  document.getElementById('examModeCard').classList.toggle('selected', mode === 'exam');
  document.getElementById('studyModeCard').classList.toggle('selected', mode === 'study');
  const retakeCard = document.getElementById('retakeModeCard');
  if (retakeCard) retakeCard.classList.toggle('selected', mode === 'retake');
  document.getElementById('startSection').style.display = 'block';
  document.getElementById('timerConfig').classList.toggle('show', mode === 'exam');
  document.getElementById('scoringConfig').classList.toggle('show', mode === 'exam');
  updateTimerDisplay();
}

function setTimerPreset(sec) { timePerQuestion = sec; document.querySelectorAll('.timer-preset').forEach(p => p.classList.remove('active')); if (event && event.target) event.target.classList.add('active'); document.getElementById('customMinutes').value = ''; updateTimerDisplay(); }
function setCustomTimer() {
  const min = parseInt(document.getElementById('customMinutes').value);
  if (!min || min < 1) { showToast('⚠️ Enter valid minutes'); return; }
  const qCount = getFilteredQuestions().length || questions.length;
  timePerQuestion = Math.round((min * 60) / qCount);
  document.querySelectorAll('.timer-preset').forEach(p => p.classList.remove('active'));
  updateTimerDisplay();
  showToast(`⏱️ Timer set: ${min} min total`);
}
function updateTimerDisplay() {
  const qCount = getFilteredQuestions().length || questions.length;
  const totalMin = Math.round((timePerQuestion * qCount) / 60);
  const el = document.getElementById('timerDisplay2');
  if (el) el.textContent = timePerQuestion === 0 ? 'Total: No limit' : `Total: ${totalMin} min`;
}
function toggleScoringModel() {
  useNegativeMarking = document.getElementById('negMarkingCheck').checked;
  const badge = document.getElementById('scoringBadge');
  if (badge) badge.style.display = useNegativeMarking ? 'inline' : 'none';
  showToast(useNegativeMarking ? '⚖️ +4/-1 Negative Marking ON' : '✅ Standard Scoring ON');
}

function startQuiz() {
  const filtered = getFilteredQuestions();
  if (!filtered.length && !(selectedMode === 'retake' && hasRetakeData())) { showToast('⚠️ No questions match the active filter!'); return; }
  if (!selectedMode) { showToast('⚠️ Please select a mode!'); return; }
  if (selectedMode === 'retake') { startRetake(); return; }
  if (filtered.length === 0) { showToast('⚠️ No questions match filter!'); return; }
  questions = filtered;
  quizMode = selectedMode;
  // Save state for next page
  localStorage.setItem('mq_questions', JSON.stringify(questions));
  localStorage.setItem('mq_mode', quizMode);
  localStorage.setItem('mq_timePerQuestion', timePerQuestion);
  localStorage.setItem('mq_useNegativeMarking', useNegativeMarking);
  // Redirect
  if (quizMode === 'exam') window.location.href = 'exam.html';
  else window.location.href = 'study.html';
}

// ═══════════════════════════════════════════════
// QUESTION BANK
// ═══════════════════════════════════════════════
async function saveToBank() {
  if (!questions.length) { showToast('⚠️ No questions loaded!'); return; }
  const nameInput = document.getElementById('bankNameInput');
  const name = nameInput.value.trim() || `Bank_${new Date().toISOString().slice(0,10)}`;
  await dbPut('banks', { name, questions: JSON.parse(JSON.stringify(questions)), savedAt: new Date().toISOString(), count: questions.length });
  nameInput.value = '';
  showToast(`💾 "${name}" saved to bank (${questions.length} Qs)`);
  loadBankList();
}

async function loadBankList() {
  const list = document.getElementById('bankList');
  if (!list) return;
  const banks = await dbGetAll('banks');
  if (banks.length === 0) { list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">No saved banks yet</div>'; return; }
  list.innerHTML = banks.map(b => `
    <div class="bank-item">
      <span class="bank-item-name">🏦 ${b.name}</span>
      <span class="bank-item-meta">${b.count} Qs · ${new Date(b.savedAt).toLocaleDateString()}</span>
      <div style="display:flex;gap:4px">
        <button class="btn btn-primary btn-xs" onclick="loadBank('${b.name}')">📥 Load</button>
        <button class="btn btn-red btn-xs" onclick="deleteBank('${b.name}')">🗑</button>
      </div>
    </div>`).join('');
}

async function loadBank(name) {
  const bank = await dbGet('banks', name);
  if (bank && bank.questions) {
    const input = document.getElementById('jsonInput');
    if (input) input.value = JSON.stringify(bank.questions, null, 2);
    closeModal('bankModal');
    showToast(`📥 Bank "${name}" loaded (${bank.questions.length} Qs)`);
    parseJSON();
  }
}

async function deleteBank(name) {
  await dbDelete('banks', name);
  showToast(`🗑 Bank "${name}" deleted`);
  loadBankList();
}

// ═══════════════════════════════════════════════
// FOLDERS
// ═══════════════════════════════════════════════
async function saveToFolder(qIdx) {
  const folderName = prompt('Enter folder name (e.g., "Tricky Syndromes"):');
  if (!folderName || !folderName.trim()) return;
  const folder = (await dbGet('folders', folderName.trim())) || { folderName: folderName.trim(), questions: [] };
  const q = questions[qIdx];
  if (!folder.questions.some(fq => fq.question === q.question)) {
    folder.questions.push({ ...q, savedAt: new Date().toISOString(), originalIdx: qIdx });
    await dbPut('folders', folder);
    showToast(`📁 Saved to "${folderName.trim()}"`);
  } else { showToast('⚠️ Already in that folder'); }
}

async function loadFolderUI() {
  const folderList = document.getElementById('folderList');
  const folderQuestions = document.getElementById('folderQuestions');
  if (!folderList) return;
  const folders = await dbGetAll('folders');
  if (folders.length === 0) { folderList.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No folders yet</span>'; folderQuestions.innerHTML = ''; return; }
  folderList.innerHTML = folders.map(f => `<span class="folder-chip" onclick="viewFolder('${f.folderName}')">📁 ${f.folderName} <span class="folder-count">${f.questions.length}</span></span>`).join('');
  if (folders[0]) viewFolderContent(folders[0], folderQuestions);
}
function viewFolder(name) { const container = document.getElementById('folderQuestions'); dbGet('folders', name).then(f => { if (f) viewFolderContent(f, container); }); }
function viewFolderContent(folder, container) {
  if (folder.questions.length === 0) { container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-muted)">Empty folder</div>'; return; }
  container.innerHTML = folder.questions.map((q, i) => `<div class="bank-item"><span style="font-size:11px;flex:1;min-width:100px">Q: ${q.question.substring(0,50)}...</span><button class="btn btn-red btn-xs" onclick="removeFromFolder('${folder.folderName}',${i})">✕</button></div>`).join('');
}
async function removeFromFolder(folderName, idx) { const folder = await dbGet('folders', folderName); if (folder) { folder.questions.splice(idx, 1); await dbPut('folders', folder); loadFolderUI(); showToast('Removed from folder'); } }
async function createFolder() { const name = document.getElementById('newFolderName').value.trim(); if (!name) { showToast('⚠️ Enter a folder name'); return; } const existing = await dbGet('folders', name); if (!existing) { await dbPut('folders', { folderName: name, questions: [] }); showToast(`📁 Folder "${name}" created`); } else showToast('⚠️ Folder already exists'); document.getElementById('newFolderName').value = ''; loadFolderUI(); }

// ═══════════════════════════════════════════════
// EXAM MODE (used on exam.html)
// ═══════════════════════════════════════════════
function startExam() {
  currentQ = 0;
  examAnswers = {};
  flagged = new Set();
  questionTimings = {};
  questionStartTime = Date.now();
  totalSeconds = timePerQuestion * questions.length;
  originalTotalSeconds = totalSeconds;
  isPaused = false;
  const scoringBadge = document.getElementById('scoringBadge');
  if (scoringBadge) scoringBadge.style.display = useNegativeMarking ? 'inline' : 'none';
  // UI update
  document.getElementById('examScreen').classList.add('active');
  renderExamQuestion();
  renderNavGrid();
  if (timePerQuestion > 0) { startTimer(); document.getElementById('timerBox').style.display = 'flex'; }
  else document.getElementById('timerBox').style.display = 'none';
  document.getElementById('navBtnCount').textContent = `Nav (${questions.length})`;
  document.getElementById('perQuestionTimer').style.display = 'flex';
  updatePerQuestionTimer();
}

function startTimer() {
  clearInterval(timerInterval);
  const display = document.getElementById('timerDisplay');
  display.textContent = formatTime(totalSeconds);
  display.className = 'timer-display';
  timerInterval = setInterval(() => {
    if (isPaused) return;
    totalSeconds--;
    display.textContent = formatTime(totalSeconds);
    updatePerQuestionTimer();
    const pct = totalSeconds / originalTotalSeconds;
    if (totalSeconds <= 60) display.className = 'timer-display danger';
    else if (pct <= 0.25) display.className = 'timer-display warning';
    if (totalSeconds <= 0) { clearInterval(timerInterval); openModal('timeUpModal'); }
  }, 1000);
}

function updatePerQuestionTimer() {
  const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
  const el = document.getElementById('perQuestionTimer');
  if (el) el.textContent = `Q-Time: ${elapsed}s`;
}

function togglePause() { if (timePerQuestion === 0) return; isPaused = !isPaused; document.getElementById('pauseOverlay').classList.toggle('show', isPaused); }

function renderExamQuestion() {
  const q = questions[currentQ];
  recordQuestionTiming();
  questionStartTime = Date.now();
  updatePerQuestionTimer();
  const meta = document.getElementById('examQuestionMeta');
  meta.innerHTML = '';
  if (q.subject) meta.innerHTML += `<span class="meta-tag subject">📚 ${q.subject}</span>`;
  if (q.topic) meta.innerHTML += `<span class="meta-tag topic">📌 ${q.topic}</span>`;
  if (q.difficulty) meta.innerHTML += `<span class="meta-tag difficulty">⭐ ${getDifficultyLabel(q.difficulty)}</span>`;
  if (q.tags) q.tags.forEach(t => meta.innerHTML += `<span class="meta-tag tag">${t}</span>`);
  const img = document.getElementById('examQuestionImage');
  if (q.image_url) { img.src = q.image_url; img.classList.add('show'); img.onerror = () => img.classList.remove('show'); } else img.classList.remove('show');
  document.getElementById('examQNumber').textContent = `Question ${currentQ+1} of ${questions.length}`;
  document.getElementById('examQuestionText').textContent = q.question;
  const optList = document.getElementById('examOptionsList');
  optList.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  q.options.forEach((opt, i) => {
    const selected = examAnswers[currentQ] === opt;
    const div = document.createElement('div');
    div.className = `option-item${selected?' selected':''}`;
    div.innerHTML = `<div class="option-letter">${letters[i]}</div><div class="option-text">${opt}</div>`;
    div.onclick = () => selectExamOption(opt, div);
    optList.appendChild(div);
  });
  document.getElementById('flagBtn').classList.toggle('active', flagged.has(currentQ));
  document.getElementById('examPrevBtn').disabled = currentQ === 0;
  document.getElementById('examNextBtn').disabled = currentQ === questions.length - 1;
  const answered = Object.keys(examAnswers).length;
  document.getElementById('examProgressText').textContent = `Question ${currentQ+1} of ${questions.length}`;
  document.getElementById('examAnsweredText').textContent = `${answered} Answered · ${flagged.size} Flagged`;
  document.getElementById('examProgressBar').style.width = `${((currentQ+1)/questions.length)*100}%`;
  updateNavGrid();
}

function recordQuestionTiming() {
  if (questionStartTime && currentQ < questions.length) {
    const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
    if (!questionTimings[currentQ]) questionTimings[currentQ] = 0;
    questionTimings[currentQ] += elapsed;
  }
}

function selectExamOption(opt, el) {
  document.querySelectorAll('#examOptionsList .option-item').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  examAnswers[currentQ] = opt;
  updateNavGrid();
  document.getElementById('examAnsweredText').textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`;
}

function clearAnswer() {
  if (examAnswers[currentQ] !== undefined) { delete examAnswers[currentQ]; document.querySelectorAll('#examOptionsList .option-item').forEach(o => o.classList.remove('selected')); updateNavGrid(); document.getElementById('examAnsweredText').textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`; showToast('✖ Answer cleared'); }
}

function examNavigate(dir) {
  const next = currentQ + dir;
  if (next >= 0 && next < questions.length) { currentQ = next; renderExamQuestion(); }
}

function toggleFlag() {
  if (flagged.has(currentQ)) { flagged.delete(currentQ); document.getElementById('flagBtn').classList.remove('active'); }
  else { flagged.add(currentQ); document.getElementById('flagBtn').classList.add('active'); }
  updateNavGrid();
  document.getElementById('examAnsweredText').textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`;
}

function renderNavGrid() {
  ['navGrid', 'mobileNavGrid'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = '';
    questions.forEach((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.textContent = i + 1;
      btn.onclick = () => { currentQ = i; renderExamQuestion(); closeMobileNav(); };
      grid.appendChild(btn);
    });
  });
  updateNavGrid();
}

function updateNavGrid() {
  ['navGrid', 'mobileNavGrid'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.querySelectorAll('.nav-btn').forEach((btn, i) => {
      btn.className = 'nav-btn';
      if (i === currentQ) btn.classList.add('current');
      if (examAnswers[i] !== undefined) btn.classList.add('answered');
      if (flagged.has(i)) btn.classList.add('flagged');
    });
  });
}

function showSubmitModal() {
  const answered = Object.keys(examAnswers).length;
  const unanswered = questions.length - answered;
  let body = `You have answered <strong>${answered}</strong> of <strong>${questions.length}</strong> questions.`;
  if (unanswered > 0) body += `<br><span style="color:var(--accent-red)">⚠️ ${unanswered} unanswered.</span>`;
  if (flagged.size > 0) body += `<br><span style="color:var(--accent-yellow)">🚩 ${flagged.size} flagged.</span>`;
  const submitModalBody = document.getElementById('submitModalBody');
  if (submitModalBody) submitModalBody.innerHTML = body;
  openModal('submitModal');
}

function submitExam() {
  recordQuestionTiming();
  clearInterval(timerInterval);
  closeModal('submitModal');
  closeModal('timeUpModal');
  // compute results
  let correct = 0, wrong = 0, skipped = 0;
  allResults = [];
  questions.forEach((q, i) => {
    const ua = examAnswers[i];
    const isCorrect = ua === q.correct_option;
    if (!ua) skipped++;
    else if (isCorrect) correct++;
    else wrong++;
    allResults.push({ q, userAnswer: ua || null, correct: !!ua && isCorrect, index: i, timeSpent: questionTimings[i] || 0 });
  });
  saveAnalyticsData(correct+wrong);
  updateMilestone(correct+wrong);
  localStorage.setItem('mq_results', JSON.stringify(allResults));
  localStorage.setItem('mq_useNegativeMarking', useNegativeMarking); // save for results page
  window.location.href = 'results.html';
}

function toggleMobileNav() { document.getElementById('mobileNavOverlay').classList.add('show'); }
function closeMobileNav() { document.getElementById('mobileNavOverlay').classList.remove('show'); }

// ═══════════════════════════════════════════════
// STUDY MODE
// ═══════════════════════════════════════════════
function startStudy() {
  currentQ = 0;
  studyScore = 0;
  studyAnswered = false;
  studyResults = [];
  renderStudyQuestion();
}

function renderStudyQuestion() {
  const q = questions[currentQ];
  studyAnswered = false;
  document.getElementById('resultFeedback').style.display = 'none';
  document.getElementById('explanationBox').classList.remove('show');
  document.getElementById('studyNextBtn').style.display = 'none';
  document.getElementById('studyFinishBtn').style.display = 'none';
  document.getElementById('aiExplainPanel').classList.remove('show');
  document.getElementById('aiPromptChips').style.display = 'none';
  if (aiConfig.provider === 'pollinations' || aiConfig.apiKey) document.getElementById('aiExplainBtn').style.display = 'inline-flex';
  else document.getElementById('aiExplainBtn').style.display = 'none';
  const meta = document.getElementById('studyQuestionMeta');
  meta.innerHTML = '';
  if (q.subject) meta.innerHTML += `<span class="meta-tag subject">📚 ${q.subject}</span>`;
  if (q.topic) meta.innerHTML += `<span class="meta-tag topic">📌 ${q.topic}</span>`;
  if (q.difficulty) meta.innerHTML += `<span class="meta-tag difficulty">⭐ ${getDifficultyLabel(q.difficulty)}</span>`;
  if (q.blooms_level) meta.innerHTML += `<span class="meta-tag difficulty">🧠 ${getBloomsLabel(q.blooms_level)}</span>`;
  if (q.tags) q.tags.forEach(t => meta.innerHTML += `<span class="meta-tag tag">${t}</span>`);
  const img = document.getElementById('studyQuestionImage');
  if (q.image_url) { img.src = q.image_url; img.classList.add('show'); img.onerror = () => img.classList.remove('show'); } else img.classList.remove('show');
  document.getElementById('studyQNumber').textContent = `Question ${currentQ+1} of ${questions.length}`;
  document.getElementById('studyQuestionText').textContent = q.question;
  document.getElementById('studyProgressText').textContent = `Question ${currentQ+1} of ${questions.length}`;
  document.getElementById('studyScoreText').textContent = `Score: ${studyScore}/${currentQ}`;
  document.getElementById('studyProgressBar').style.width = `${(currentQ/questions.length)*100}%`;
  const optList = document.getElementById('studyOptionsList');
  optList.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  q.options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'option-item';
    div.innerHTML = `<div class="option-letter">${letters[i]}</div><div class="option-text">${opt}</div><div class="option-icon"></div>`;
    div.onclick = () => selectStudyOption(opt, div);
    optList.appendChild(div);
  });
}

function selectStudyOption(opt, el) {
  if (studyAnswered) return;
  studyAnswered = true;
  const q = questions[currentQ];
  const isCorrect = opt === q.correct_option;
  document.querySelectorAll('#studyOptionsList .option-item').forEach((item, i) => {
    item.classList.add('disabled');
    if (q.options[i] === q.correct_option) { item.classList.add('correct'); item.querySelector('.option-icon').textContent = '✅'; }
    else if (q.options[i] === opt && !isCorrect) { item.classList.add('wrong'); item.querySelector('.option-icon').textContent = '❌'; }
  });
  const feedback = document.getElementById('resultFeedback');
  if (isCorrect) { studyScore++; feedback.className = 'result-feedback correct-feedback'; feedback.innerHTML = '✅ Correct! Well done.'; }
  else { feedback.className = 'result-feedback wrong-feedback'; feedback.innerHTML = `❌ Incorrect. Correct: <strong style="margin-left:6px">${q.correct_option}</strong>`; }
  feedback.style.display = 'flex';
  document.getElementById('explanationText').textContent = q.explanation || 'No explanation provided.';
  document.getElementById('explanationBox').classList.add('show');
  document.getElementById('aiPromptChips').style.display = 'flex';
  studyResults.push({ q, userAnswer: opt, correct: isCorrect, explanation: q.explanation });
  if (currentQ < questions.length - 1) document.getElementById('studyNextBtn').style.display = 'inline-flex';
  else document.getElementById('studyFinishBtn').style.display = 'inline-flex';
  document.getElementById('studyScoreText').textContent = `Score: ${studyScore}/${currentQ+1}`;
  updateSRSData(q, isCorrect);
}

async function getAIExplanation(mode) {
  const q = questions[currentQ];
  const panel = document.getElementById('aiExplainPanel');
  const content = document.getElementById('aiExplainContent');
  const btn = document.getElementById('aiExplainBtn');
  panel.classList.add('show');
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div>AI is thinking...</div>';
  btn.disabled = true;
  let extra = '';
  if (mode === 'stepbystep') extra = 'Provide a detailed step-by-step breakdown of the reasoning process.';
  if (mode === 'mnemonic') extra = 'Create a memorable mnemonic or memory aid for the correct answer and key concept.';
  if (mode === 'contrast') extra = 'Explain why the correct answer is right AND specifically why the second-best option is wrong. Contrast them clearly.';
  if (mode === 'clinical') extra = 'Relate this to real clinical practice. Give a clinical pearl or bedside tip.';
  try {
    const prompt = `You are an expert medical educator. ${extra} Explain this MCQ:\nQuestion: ${q.question}\nOptions: ${q.options.join(', ')}\nCorrect: ${q.correct_option}\nExisting: ${q.explanation||'None'}\nKeep it concise (under 250 words), plain text.`;
    const response = await callAI(prompt);
    content.textContent = response;
  } catch (e) { content.innerHTML = `<span style="color:var(--accent-red)">⚠️ ${e.message}</span>`; } finally { btn.disabled = false; }
}

function studyNext() { currentQ++; renderStudyQuestion(); }

function finishStudy() {
  allResults = studyResults.map((r, i) => ({ ...r, index: i, timeSpent: 0 }));
  localStorage.setItem('mq_results', JSON.stringify(allResults));
  saveAnalyticsData(studyResults.length);
  updateMilestone(studyResults.length);
  window.location.href = 'results.html';
}

// ═══════════════════════════════════════════════
// SRS
// ═══════════════════════════════════════════════
async function updateSRSData(q, isCorrect) {
  const qHash = hashQuestion(q.question);
  let card = await dbGet('srs', qHash) || { qHash, question: q.question, answer: q.correct_option, explanation: q.explanation, interval: 1, repetitions: 0, easeFactor: 2.5, nextReview: new Date().toISOString(), lastCorrect: false };
  if (isCorrect) { card.repetitions++; card.interval = card.repetitions === 1 ? 1 : card.repetitions === 2 ? 6 : Math.round(card.interval * card.easeFactor); card.easeFactor = Math.max(1.3, card.easeFactor + 0.1); }
  else { card.repetitions = 0; card.interval = 1; card.easeFactor = Math.max(1.3, card.easeFactor - 0.2); }
  card.lastCorrect = isCorrect;
  card.nextReview = new Date(Date.now() + card.interval * 86400000).toISOString();
  await dbPut('srs', card);
}
function hashQuestion(q) { let hash = 0; for (let i = 0; i < q.length; i++) { hash = ((hash << 5) - hash) + q.charCodeAt(i); hash |= 0; } return 'q_' + Math.abs(hash); }

// ═══════════════════════════════════════════════
// POMODORO
// ═══════════════════════════════════════════════
function togglePomodoroWidget() {
  const widget = document.getElementById('pomodoroWidget');
  const toggle = document.getElementById('pomodoroToggle');
  const showing = widget.classList.contains('show');
  if (showing) { widget.classList.remove('show'); toggle.classList.remove('hidden'); }
  else { widget.classList.add('show'); toggle.classList.add('hidden'); }
}
function setPomodoroPreset(min) { pomodoroSeconds = min * 60; pomodoroIsBreak = false; updatePomodoroDisplay(); document.getElementById('pomoLabel').textContent = 'FOCUS'; }
function updatePomodoroDisplay() { document.getElementById('pomoTime').textContent = formatTime(pomodoroSeconds); }
function startPomodoro() {
  if (pomodoroRunning) { clearInterval(pomodoroInterval); pomodoroRunning = false; document.getElementById('pomoStartBtn').textContent = '▶ Start'; return; }
  pomodoroRunning = true;
  document.getElementById('pomoStartBtn').textContent = '⏸ Pause';
  pomodoroInterval = setInterval(() => {
    pomodoroSeconds--;
    updatePomodoroDisplay();
    if (pomodoroSeconds <= 0) {
      clearInterval(pomodoroInterval);
      pomodoroRunning = false;
      document.getElementById('pomoStartBtn').textContent = '▶ Start';
      if (!pomodoroIsBreak) { pomodoroSeconds = POMODORO_BREAK; pomodoroIsBreak = true; document.getElementById('pomoLabel').textContent = 'BREAK'; showToast('🍅 Focus done! Take a 5-min break.'); }
      else { pomodoroSeconds = POMODORO_FOCUS; pomodoroIsBreak = false; document.getElementById('pomoLabel').textContent = 'FOCUS'; showToast('☕ Break over! Ready to focus?'); }
      updatePomodoroDisplay();
    }
  }, 1000);
}
function resetPomodoro() { clearInterval(pomodoroInterval); pomodoroRunning = false; pomodoroSeconds = POMODORO_FOCUS; pomodoroIsBreak = false; document.getElementById('pomoStartBtn').textContent = '▶ Start'; document.getElementById('pomoLabel').textContent = 'FOCUS'; updatePomodoroDisplay(); }

// ═══════════════════════════════════════════════
// MILESTONE
// ═══════════════════════════════════════════════
async function loadDailyGoal() {
  const saved = localStorage.getItem('medquiz_daily_goal');
  if (saved) dailyGoal = parseInt(saved);
  const input = document.getElementById('dailyGoalInput');
  if (input) input.value = dailyGoal;
  updateMilestoneBar();
}
function setDailyGoal() {
  const val = parseInt(document.getElementById('dailyGoalInput').value);
  if (!val || val < 1) { showToast('⚠️ Enter a valid goal'); return; }
  dailyGoal = val;
  localStorage.setItem('medquiz_daily_goal', val);
  updateMilestoneBar();
  showToast(`🎯 Daily goal set: ${val} questions`);
}
async function updateMilestone(answeredToday = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await dbGet('milestones', today) || { date: today, answered: 0 };
  if (answeredToday > 0) { existing.answered += answeredToday; await dbPut('milestones', existing); }
  updateMilestoneBar();
}
async function updateMilestoneBar() {
  const bar = document.getElementById('milestoneBar');
  if (!bar) return;
  const today = new Date().toISOString().slice(0, 10);
  const existing = await dbGet('milestones', today) || { date: today, answered: 0 };
  const answered = existing.answered || 0;
  const pct = Math.min(100, Math.round((answered / dailyGoal) * 100));
  bar.classList.add('show');
  document.getElementById('milestoneText').textContent = `${answered} / ${dailyGoal} Questions Today`;
  document.getElementById('milestoneFill').style.width = `${pct}%`;
  if (pct >= 100) document.getElementById('milestoneFill').style.background = 'var(--gradient-primary)';
  else document.getElementById('milestoneFill').style.background = 'var(--gradient-success)';
}

// ═══════════════════════════════════════════════
// ANALYTICS HEATMAP
// ═══════════════════════════════════════════════
async function saveAnalyticsData(countAnswered) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await dbGet('analytics', today) || { date: today, questionsAnswered: 0, quizzes: 0 };
  existing.questionsAnswered += countAnswered;
  existing.quizzes += 1;
  await dbPut('analytics', existing);
}
function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const days = 84;
  const today = new Date();
  grid.innerHTML = '';
  (async () => {
    const analytics = await dbGetAll('analytics');
    const dateMap = {};
    analytics.forEach(a => { dateMap[a.date] = a.questionsAnswered || 0; });
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = dateMap[key] || 0;
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (count >= 50) cell.classList.add('l4');
      else if (count >= 25) cell.classList.add('l3');
      else if (count >= 10) cell.classList.add('l2');
      else if (count >= 1) cell.classList.add('l1');
      cell.title = `${key}: ${count} questions`;
      grid.appendChild(cell);
    }
  })();
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function formatTime(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function getDifficultyLabel(d) {
  const map = { 1:'Easy', 2:'Easy+', 3:'Medium', 4:'Hard', 5:'Very Hard' }; return map[d] || `Diff ${d}`;
}
function getBloomsLabel(b) {
  const map = { 1:'Remember', 2:'Understand', 3:'Apply', 4:'Analyze', 5:'Evaluate', 6:'Create' }; return map[b] || `Bloom ${b}`;
}

// ═══════════════════════════════════════════════
// RESULTS PAGE (used on results.html)
// ═══════════════════════════════════════════════
function showResults() {
  const resultsData = localStorage.getItem('mq_results');
  if (!resultsData) { window.location.href = 'index.html'; return; }
  allResults = JSON.parse(resultsData);
  useNegativeMarking = localStorage.getItem('mq_useNegativeMarking') === 'true';
  let correct = 0, wrong = 0, skipped = 0;
  allResults.forEach(r => {
    if (!r.userAnswer) skipped++;
    else if (r.correct) correct++;
    else wrong++;
  });
  const total = allResults.length;
  const pct = Math.round((correct / total) * 100);
  // render
  const badge = document.getElementById('resultModeBadge');
  badge.className = 'mode-badge exam';
  badge.textContent = '⏱ Exam Mode'; // could be study but okay
  const circumference = 427;
  const offset = circumference - (pct / 100) * circumference;
  setTimeout(() => { document.getElementById('ringFill').style.strokeDashoffset = offset; }, 100);
  document.getElementById('scorePercent').textContent = `${pct}%`;
  let title = pct >= 90 ? '🏆 Outstanding!' : pct >= 80 ? '🎉 Excellent!' : pct >= 60 ? '👍 Good Job!' : pct >= 40 ? '📈 Keep Practicing' : '💪 More Practice Needed';
  document.getElementById('resultsTitle').textContent = title;
  document.getElementById('resultsSubtitle').textContent = `You scored ${correct} out of ${total} questions correctly`;
  if (useNegativeMarking) {
    const rawScore = correct * 4 - wrong * 1;
    const maxScore = total * 4;
    document.getElementById('resultsSubtitle').textContent += ` · NEET Score: ${rawScore}/${maxScore}`;
  }
  document.getElementById('resultsStats').innerHTML = `
    <div class="result-stat-card"><div class="stat-icon">✅</div><div class="stat-number" style="color:var(--accent-green)">${correct}</div><div class="stat-name">Correct</div></div>
    <div class="result-stat-card"><div class="stat-icon">❌</div><div class="stat-number" style="color:var(--accent-red)">${wrong}</div><div class="stat-name">Wrong</div></div>
    <div class="result-stat-card"><div class="stat-icon">⏭</div><div class="stat-number" style="color:var(--text-muted)">${skipped}</div><div class="stat-name">Skipped</div></div>
    <div class="result-stat-card"><div class="stat-icon">📊</div><div class="stat-number" style="color:var(--accent)">${pct}%</div><div class="stat-name">Score</div></div>`;
  document.getElementById('printDate').textContent = `Generated on ${new Date().toLocaleString()}`;
  const aiAssessBtn = document.getElementById('aiAssessBtn');
  if (aiAssessBtn) aiAssessBtn.style.display = (aiConfig.provider === 'pollinations' || aiConfig.apiKey) ? 'inline-flex' : 'none';
  document.getElementById('aiAssessment').classList.remove('show');
  renderWeaknessResults();
  renderHeatmap();
  renderReviewItems();
  const retakeWrongBtn = document.getElementById('retakeWrongBtn');
  const wrongCount = allResults.filter(r => !r.correct || !r.userAnswer).length;
  if (retakeWrongBtn) retakeWrongBtn.style.display = wrongCount > 0 ? 'inline-flex' : 'none';
  if (wrongCount > 0) saveRetakeData(allResults.filter(r => !r.correct || !r.userAnswer));
  flashcardDeck = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
}

function renderWeaknessResults() {
  const dashboard = document.getElementById('weaknessDashboard');
  const content = document.getElementById('weaknessContent');
  const topicMap = {};
  allResults.forEach(r => {
    const topic = r.q.topic || 'Other';
    if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0 };
    topicMap[topic].total++;
    if (r.correct && r.userAnswer) topicMap[topic].correct++;
  });
  const entries = Object.entries(topicMap).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
  if (entries.length === 0) { dashboard.style.display = 'none'; return; }
  dashboard.style.display = 'block';
  content.innerHTML = entries.map(([topic, d]) => {
    const pct = Math.round((d.correct / d.total) * 100);
    const cls = pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad';
    return `
      <div class="weakness-item">
        <span class="weakness-name">${topic}</span>
        <div class="weakness-bar-bg"><div class="weakness-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="weakness-pct">${pct}%</span>
      </div>`;
  }).join('');
}

function renderReviewItems() {
  const container = document.getElementById('reviewItems');
  if (!container) return;
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const filtered = allResults.filter(r => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'correct') return r.correct && r.userAnswer;
    if (activeFilter === 'wrong') return !r.correct && r.userAnswer;
    if (activeFilter === 'skipped') return !r.userAnswer;
    return true;
  });
  if (filtered.length === 0) { container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No questions match this filter.</div>'; return; }
  filtered.forEach((r, displayIdx) => {
    const q = r.q; const ua = r.userAnswer; const isCorrect = r.correct; const isSkipped = !ua; const originalIdx = r.index;
    const item = document.createElement('div');
    item.className = `review-item ${isSkipped?'skipped-item':isCorrect?'correct-item':'wrong-item'}`;
    item.style.animationDelay = `${displayIdx*0.03}s`;
    const badgeClass = isSkipped ? 'badge-skipped' : isCorrect ? 'badge-correct' : 'badge-wrong';
    const badgeText = isSkipped ? 'Skipped' : isCorrect ? 'Correct' : 'Wrong';
    let metaHtml = '';
    if (q.subject) metaHtml += `<span class="meta-tag subject">📚 ${q.subject}</span>`;
    if (q.topic) metaHtml += `<span class="meta-tag topic">📌 ${q.topic}</span>`;
    if (q.difficulty) metaHtml += `<span class="meta-tag difficulty">⭐ ${getDifficultyLabel(q.difficulty)}</span>`;
    if (q.tags) q.tags.forEach(t => metaHtml += `<span class="meta-tag tag">${t}</span>`);
    let optHtml = '';
    q.options.forEach((opt, oi) => {
      let cls = ''; if (opt === q.correct_option) cls = 'r-correct'; else if (opt === ua && !isCorrect) cls = 'r-wrong';
      const icon = opt === q.correct_option ? '✅' : (opt === ua && !isCorrect ? '❌' : '');
      optHtml += `<div class="review-option ${cls}"><span style="font-weight:700;flex-shrink:0">${letters[oi]}.</span><span style="flex:1">${opt}</span>${icon?`<span>${icon}</span>`:''}</div>`;
    });
    item.innerHTML = `
      <div class="review-item-header"><div class="review-q-number">Q${originalIdx+1}</div><span class="review-status-badge ${badgeClass}">${isSkipped?'⏭':isCorrect?'✅':'❌'} ${badgeText}</span></div>
      ${metaHtml?`<div class="review-meta-tags">${metaHtml}</div>`:''}
      <div class="review-q-text">${q.question}</div>
      <div class="review-options">${optHtml}</div>
      ${ua&&!isCorrect?`<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Your: <strong style="color:var(--accent-red)">${ua}</strong> | Correct: <strong style="color:var(--accent-green)">${q.correct_option}</strong></div>`:''}
      ${isSkipped?`<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Correct: <strong style="color:var(--accent-green)">${q.correct_option}</strong></div>`:''}
      <div class="review-explanation"><div class="exp-label">💡 Explanation</div><p>${q.explanation||'None'}</p></div>
      ${r.timeSpent?`<div style="font-size:11px;color:var(--text-muted);margin-top:6px">⏱ Time spent: ${r.timeSpent}s</div>`:''}
      <div class="review-actions no-print">
        <button class="btn btn-ai btn-sm" onclick="getReviewAI(${originalIdx},this)">✨ AI Deep Dive</button>
        <button class="btn btn-ghost btn-sm" onclick="saveToFolder(${originalIdx})">📁 Save</button>
      </div>
      <div class="review-ai-response" id="reviewAI_${originalIdx}"><div class="review-ai-response-header">🤖 AI Analysis</div><div class="review-ai-response-body"></div></div>`;
    container.appendChild(item);
  });
}

function filterReview(f) { activeFilter = f; document.querySelectorAll('.review-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f)); renderReviewItems(); }

async function getReviewAI(idx, btn) {
  const q = questions.length ? questions[idx] : allResults.find(r => r.index === idx)?.q;
  if (!q) return;
  const ua = allResults.find(r => r.index === idx)?.userAnswer;
  const panel = document.getElementById(`reviewAI_${idx}`);
  if (!panel) return;
  const body = panel.querySelector('.review-ai-response-body');
  panel.classList.add('show');
  body.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Analyzing...</div>';
  btn.disabled = true;
  try {
    const prompt = `Explain why "${q.correct_option}" is correct${ua&&ua!==q.correct_option?` and why "${ua}" is wrong`:''}. Question: ${q.question}. Options: ${q.options.join(', ')}. Max 200 words, plain text.`;
    const response = await callAI(prompt);
    body.textContent = response;
  } catch (e) { body.innerHTML = `<span style="color:var(--accent-red)">⚠️ ${e.message}</span>`; } finally { btn.disabled = false; }
}

async function getAIAssessment() {
  const btn = document.getElementById('aiAssessBtn');
  const panel = document.getElementById('aiAssessment');
  const content = document.getElementById('aiAssessmentContent');
  panel.classList.add('show');
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div>AI is analyzing your performance...</div>';
  btn.disabled = true;
  const correct = allResults.filter(r => r.correct && r.userAnswer).length;
  const wrong = allResults.filter(r => !r.correct && r.userAnswer).length;
  const skipped = allResults.filter(r => !r.userAnswer).length;
  const wrongTopics = [...new Set(allResults.filter(r => !r.correct && r.userAnswer).map(r => r.q.topic).filter(Boolean))];
  try {
    const prompt = `Analyze this medical quiz performance: Score ${correct}/${allResults.length} (${Math.round(correct/allResults.length*100)}%), Wrong: ${wrong}, Skipped: ${skipped}, Weak topics: ${wrongTopics.join(', ')||'None'}. Provide: 1. Summary 2. Strengths 3. Weaknesses 4. Study tips 5. Motivation. Max 400 words, plain text.`;
    const response = await callAI(prompt);
    content.textContent = response;
  } catch (e) { content.innerHTML = `<span style="color:var(--accent-red)">⚠️ ${e.message}</span>`; } finally { btn.disabled = false; }
}

// ═══════════════════════════════════════════════
// RETAKE / WRONG
// ═══════════════════════════════════════════════
function hasRetakeData() { try { return !!localStorage.getItem('medquiz_retake_questions'); } catch(e) { return false; } }
function saveRetakeData(wrongResults) { const qs = wrongResults.map(r => r.q); localStorage.setItem('medquiz_retake_questions', JSON.stringify(qs)); }
function loadRetakeData() { const saved = localStorage.getItem('medquiz_retake_questions'); if (saved) { const retakeCard = document.getElementById('retakeModeCard'); if (retakeCard) retakeCard.style.display = 'block'; } }
function startRetake() {
  const saved = localStorage.getItem('medquiz_retake_questions');
  if (!saved) { showToast('⚠️ No retake data available. Complete a quiz first!'); return; }
  questions = JSON.parse(saved);
  if (!questions.length) { showToast('⚠️ No wrong questions to retake!'); return; }
  showToast(`🔄 Retake Mode: ${questions.length} questions from previous wrong/skipped`);
  localStorage.removeItem('medquiz_retake_questions');
  document.getElementById('retakeModeCard').style.display = 'none';
  useNegativeMarking = false;
  localStorage.setItem('mq_questions', JSON.stringify(questions));
  localStorage.setItem('mq_mode', 'exam');
  localStorage.setItem('mq_timePerQuestion', timePerQuestion || 90);
  localStorage.setItem('mq_useNegativeMarking', false);
  window.location.href = 'exam.html';
}
function retakeWrong() {
  const wrong = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
  if (wrong.length === 0) { showToast('✅ No wrong questions to retake!'); return; }
  questions = wrong;
  showToast(`🔄 Retaking ${wrong.length} wrong/skipped questions`);
  useNegativeMarking = false;
  localStorage.setItem('mq_questions', JSON.stringify(wrong));
  localStorage.setItem('mq_mode', 'exam');
  localStorage.setItem('mq_timePerQuestion', timePerQuestion || 90);
  localStorage.setItem('mq_useNegativeMarking', false);
  window.location.href = 'exam.html';
}

// ═══════════════════════════════════════════════
// FLASHCARDS
// ═══════════════════════════════════════════════
function openFlashcards() {
  if (flashcardDeck.length === 0) flashcardDeck = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
  if (flashcardDeck.length === 0) { showToast('⚠️ No flashcards to review!'); return; }
  flashcardIdx = 0;
  document.getElementById('flashcardOverlay').classList.add('show');
  document.getElementById('flashcard').classList.remove('flipped');
  renderFlashcard();
}
function renderFlashcard() {
  const q = flashcardDeck[flashcardIdx];
  document.getElementById('fcFront').textContent = q.question;
  document.getElementById('fcBack').innerHTML = `<strong>Answer:</strong> ${q.correct_option}<br><br>${q.explanation||''}`;
  document.getElementById('fcCounter').textContent = `${flashcardIdx+1}/${flashcardDeck.length}`;
  document.getElementById('flashcard').classList.remove('flipped');
}
function flipFlashcard() { document.getElementById('flashcard').classList.toggle('flipped'); }
function nextFlashcard() { if (flashcardIdx < flashcardDeck.length - 1) { flashcardIdx++; renderFlashcard(); } }
function prevFlashcard() { if (flashcardIdx > 0) { flashcardIdx--; renderFlashcard(); } }
function closeFlashcards() { document.getElementById('flashcardOverlay').classList.remove('show'); }

// ═══════════════════════════════════════════════
// DOWNLOAD RESULTS
// ═══════════════════════════════════════════════
function downloadResults() {
  const allAIResponses = [];
  document.querySelectorAll('.review-ai-response-body').forEach((el, i) => { if (el.textContent && !el.textContent.includes('Analyzing')) allAIResponses.push({ idx: i, text: el.textContent }); });
  const content = document.getElementById('resultsScreen').innerHTML;
  const style = document.querySelector('link[href="css/style.css"]').outerHTML;
  let aiSection = '';
  if (allAIResponses.length > 0) {
    aiSection = '<div style="page-break-before:always"><h2>🤖 AI Explanations</h2>' + allAIResponses.map(r => `<div style="margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:8px"><strong>Q${r.idx+1}:</strong><div style="margin-top:6px">${r.text}</div></div>`).join('') + '</div>';
  }
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MedQuiz Pro — Test Report</title>${style}</head><body><div id="resultsScreen" class="screen active" style="display:flex;flex-direction:column;min-height:100vh">${content}</div>${aiSection}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `MedQuiz_Report_${new Date().toISOString().slice(0,10)}.html`; a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Enhanced report downloaded!');
}

// ═══════════════════════════════════════════════
// NAVIGATION HELPERS
// ═══════════════════════════════════════════════
function confirmGoHome() {
  if (document.getElementById('examScreen')?.classList.contains('active') ||
      document.getElementById('studyScreen')?.classList.contains('active')) {
    openModal('confirmHomeModal');
  } else goHome();
}
function goHome() {
  clearInterval(timerInterval);
  isPaused = false;
  document.getElementById('pauseOverlay')?.classList.remove('show');
  // clear results? no, keep.
  window.location.href = 'index.html';
}

// ═══════════════════════════════════════════════
// PAGE INITIALIZATION
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Common theme/AI init
  const savedTheme = localStorage.getItem('medquiz_theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.textContent = '☀️';
  }
  const savedConfig = localStorage.getItem('medquiz_ai_config');
  if (savedConfig) { try { const loaded = JSON.parse(savedConfig); aiConfig = { ...aiConfig, ...loaded }; } catch(e) {} }
  const providerSelect = document.getElementById('providerSelect');
  if (providerSelect) providerSelect.value = aiConfig.provider || 'pollinations';
  const pollModel = document.getElementById('pollinationsModelSelect');
  if (pollModel) pollModel.value = aiConfig.pollinationsModel || 'openai';
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) apiKeyInput.value = aiConfig.apiKey || '';
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) modelSelect.value = aiConfig.model || 'gemini-2.5-flash';
  onProviderChange();
  updateAIStatus();

  // Page detections
  const isHome = !!document.getElementById('homeScreen');
  const isExam = !!document.getElementById('examScreen');
  const isStudy = !!document.getElementById('studyScreen');
  const isResults = !!document.getElementById('resultsScreen');

  if (isHome) {
    loadDailyGoal();
    updateMilestoneBar();
    loadRetakeData();
    renderHeatmap();
    setupOCRZone();
    // Show home screen
    document.getElementById('homeScreen').classList.add('active');
  } else if (isExam) {
    // Load exam data from localStorage
    const qData = localStorage.getItem('mq_questions');
    if (!qData) { window.location.href = 'index.html'; return; }
    questions = JSON.parse(qData);
    timePerQuestion = parseInt(localStorage.getItem('mq_timePerQuestion')) || 90;
    useNegativeMarking = localStorage.getItem('mq_useNegativeMarking') === 'true';
    quizMode = 'exam';
    startExam();
  } else if (isStudy) {
    const qData = localStorage.getItem('mq_questions');
    if (!qData) { window.location.href = 'index.html'; return; }
    questions = JSON.parse(qData);
    quizMode = 'study';
    startStudy();
  } else if (isResults) {
    showResults();
  }

  // Keyboard shortcuts (only for exam page)
  if (isExam) {
    document.addEventListener('keydown', function(e) {
      if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
      if (isPaused) return;
      if (e.key === 'ArrowLeft') examNavigate(-1);
      else if (e.key === 'ArrowRight') examNavigate(1);
      else if (e.key.toLowerCase() === 'f') toggleFlag();
      else if (e.key === ' ') { e.preventDefault(); togglePause(); }
      else if (['1','2','3','4','5','6'].includes(e.key)) {
        const idx = parseInt(e.key) - 1;
        const opts = document.querySelectorAll('#examOptionsList .option-item');
        if (opts[idx]) opts[idx].click();
      }
    });
  }

  // Register service worker (for offline caching)
  if ('serviceWorker' in navigator) {
    const swCode = `self.addEventListener('install', e => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim())); self.addEventListener('fetch', e => { e.respondWith( caches.match(e.request).then(r => r || fetch(e.request).then(resp => { const clone = resp.clone(); caches.open('medquiz-v1').then(c => c.put(e.request, clone)); return resp; }).catch(() => caches.match(e.request))) ); });`;
    const blob = new Blob([swCode], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }
});
