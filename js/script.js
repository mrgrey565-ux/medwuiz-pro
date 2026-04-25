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

// Cleaned up AI config — purely Pollinations now
let aiConfig = {
  provider: 'pollinations',
  pollinationsModel: 'openai'
};

// ═══════════════════════════════════════════════
// PREMIUM HAPTIC FEEDBACK (MICRO-INTERACTIONS)
// ═══════════════════════════════════════════════
function vibrate(duration = 30) {
  // Gracefully fail if the browser/device doesn't support vibration
  if (navigator && navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

// ═══════════════════════════════════════════════
// PWA / ADD TO HOME SCREEN ENGINE
// ═══════════════════════════════════════════════
function initPWA() {
  // 1. Generate the premium gradient icon dynamically
  const canvas = document.createElement('canvas');
  canvas.width = 512; 
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // Create purple gradient matching landing page
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#6366f1'); // Indigo/Accent
  grad.addColorStop(1, '#a855f7'); // Purple
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  
  // Add Brain Logo
  ctx.font = '240px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🧠', 256, 280); // Slight offset to visually center the emoji
  
  const iconURL = canvas.toDataURL('image/png');

  // 2. Generate and inject Manifest dynamically
  const manifest = {
    name: "MedQuiz Pro",
    short_name: "MedQuiz",
    start_url: "./index.html",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [{ src: iconURL, sizes: "512x512", type: "image/png", purpose: "any maskable" }]
  };
  
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const manifestURL = URL.createObjectURL(manifestBlob);

  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = manifestURL;
  document.head.appendChild(link);

  // 3. Listen for the browser install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    showInstallBanner(iconURL);
  });
}

function showInstallBanner(iconUrl) {
  if(document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 16px; padding: 14px 18px; display: flex; align-items: center; gap: 14px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4); z-index: 9999; width: 90%; max-width: 380px;
    animation: chipFadeIn 0.6s cubic-bezier(0.16,1,0.3,1);
  `;
  
  banner.innerHTML = `
    <img src="${iconUrl}" style="width:46px;height:46px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);">
    <div style="flex:1">
      <div style="font-weight:700;font-size:15px;color:var(--text-primary);">MedQuiz Pro</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Add to Home Screen</div>
    </div>
    <button id="pwaInstallBtn" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;transition:transform 0.2s;">Install</button>
    <button id="pwaCloseBtn" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;padding:0 4px;margin-left:4px;">&times;</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwaInstallBtn').onclick = async () => {
    vibrate(30);
    banner.style.display = 'none';
    if (window.deferredInstallPrompt) {
      window.deferredInstallPrompt.prompt();
      const { outcome } = await window.deferredInstallPrompt.userChoice;
      window.deferredInstallPrompt = null;
    }
  };
  
  document.getElementById('pwaCloseBtn').onclick = () => {
    banner.remove();
  };
}

// ═══════════════════════════════════════════════
// INDEXEDDB HELPERS
// ═══════════════════════════════════════════════
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MedQuizProDB', 3);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('banks'))
        db.createObjectStore('banks', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('analytics'))
        db.createObjectStore('analytics', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('srs'))
        db.createObjectStore('srs', { keyPath: 'qHash' });
      if (!db.objectStoreNames.contains('folders'))
        db.createObjectStore('folders', { keyPath: 'folderName' });
      if (!db.objectStoreNames.contains('milestones'))
        db.createObjectStore('milestones', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(data);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = store.get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

// ═══════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════
function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function openModal(id) {
  vibrate(20); // Soft vibration for opening modals
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  el.classList.add('active');
  if (id === 'bankModal')   loadBankList();
  if (id === 'folderModal') loadFolderUI();
  if (id === 'ocrModal') {
    const ocrRes  = document.getElementById('ocrResult');
    const ocrProg = document.getElementById('ocrProgress');
    const ocrBtn  = document.getElementById('ocrConvertBtn');
    if (ocrRes)  ocrRes.style.display  = 'none';
    if (ocrProg) ocrProg.style.display = 'none';
    if (ocrBtn)  ocrBtn.disabled = !ocrFile;
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  el.classList.remove('active');
}

function toggleTheme() {
  vibrate(30); // Tactile feedback
  const isLight = document.body.classList.contains('light') ||
                  document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.body.classList.remove('light');
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('medquiz_theme', 'dark');
  } else {
    document.body.classList.add('light');
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('medquiz_theme', 'light');
  }
  updateThemeIcon();
}

function updateThemeIcon() {
  const isLight = document.body.classList.contains('light') ||
                  document.documentElement.getAttribute('data-theme') === 'light';
  const svg = document.getElementById('themeIconSvg');
  if (!svg) return;
  if (isLight) {
    svg.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    svg.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
}

// Stripped down to just Pollinations
function onProviderChange() {
  const pollConfig = document.getElementById('pollinationsConfig');
  const geminiConfig = document.getElementById('geminiConfig');
  if (pollConfig) pollConfig.style.display = 'block';
  if (geminiConfig) geminiConfig.style.display = 'none';
}

function saveAIConfig() {
  vibrate(30);
  const pollinationsModelSelect = document.getElementById('pollinationsModelSelect');
  aiConfig.provider = 'pollinations'; // Force pollinations
  if (pollinationsModelSelect) aiConfig.pollinationsModel = pollinationsModelSelect.value;
  
  localStorage.setItem('medquiz_ai_config', JSON.stringify(aiConfig));
  updateAIStatus();
  closeModal('aiConfigModal');
  showToast('Pollinations AI settings saved! (Free & Unlimited)');
}

function updateAIStatus() {
  const status = document.getElementById('aiStatus');
  const text   = document.getElementById('aiStatusText');
  if (!status || !text) return;
  // Always ready because pollinations requires no key
  status.classList.add('connected');
  text.textContent = 'AI Ready';
}

async function callAI(prompt) {
  // Purely Pollinations
  const model = aiConfig.pollinationsModel || 'openai';
  const url   = 'https://text.pollinations.ai/openai';
  const body  = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are an expert medical educator and tutor. Provide clear, accurate, concise explanations.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 1024,
    private: true
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const simpleUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&private=true`;
      const simpleRes = await fetch(simpleUrl);
      if (!simpleRes.ok) throw new Error(`Pollinations error: HTTP ${simpleRes.status}`);
      return await simpleRes.text();
    }
    const data = await res.json();
    if (data.choices && data.choices[0])
      return data.choices[0].message?.content || data.choices[0].text || 'No response';
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) {
    try {
      // Fallback simple GET request
      const simpleUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&private=true`;
      const simpleRes = await fetch(simpleUrl);
      if (!simpleRes.ok) throw new Error(`Pollinations error: HTTP ${simpleRes.status}`);
      return await simpleRes.text();
    } catch (e2) {
      throw new Error(`AI request failed: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════
// SAMPLE & STORAGE
// ═══════════════════════════════════════════════
function loadSample() {
  vibrate(30);
  const sample = [
    {
      question: "A body recovered from a river shows fine froth at mouth and nostrils. Which finding most strongly supports antemortem drowning?",
      options: ["Cutis anserina", "Washerwoman hands", "Fine persistent froth in airways", "Water in stomach"],
      correct_option: "Fine persistent froth in airways",
      explanation: "Fine persistent froth in the airways is the hallmark of antemortem drowning. It forms due to the churning of water with air and mucus during active respiratory movements. This froth is fine, white, and persistent — it does not disappear on drying. Cutis anserina (goose skin) and washerwoman hands are postmortem changes seen in prolonged water immersion and are not specific to drowning. Water in the stomach can be swallowed postmortem and is not reliable evidence of antemortem drowning.",
      difficulty: 3,
      subject: "Forensic Medicine",
      topic: "Asphyxial Deaths",
      tags: ["PYQ", "HYT"]
    },
    {
      question: "Which best describes the mechanism of rigor mortis?",
      options: ["Postmortem cooling of the body", "Muscle stiffening due to ATP depletion", "Skin discoloration from hemolysis", "Soft tissue decomposition by bacteria"],
      correct_option: "Muscle stiffening due to ATP depletion",
      explanation: "Rigor mortis is postmortem stiffening of muscles caused by ATP depletion after death. In life, ATP is required for the detachment of actin-myosin cross-bridges. After death, ATP production ceases, causing permanent actin-myosin binding and muscle rigidity. It begins 2-6 hours after death, becomes complete by 12 hours, and passes off by 48-72 hours as autolysis begins. Postmortem cooling is algor mortis. Skin discoloration is livor mortis. Decomposition is putrefaction.",
      difficulty: 2,
      subject: "Forensic Medicine",
      topic: "Postmortem Changes",
      tags: ["HYT"]
    },
    {
      question: "The cherry-red color of blood and tissues in carbon monoxide poisoning is due to formation of:",
      options: ["Carboxyhemoglobin", "Methemoglobin", "Sulfhemoglobin", "Oxyhemoglobin"],
      correct_option: "Carboxyhemoglobin",
      explanation: "Carbon monoxide (CO) binds to hemoglobin with an affinity 240 times greater than oxygen, forming carboxyhemoglobin (COHb). COHb is bright cherry-red in color, which imparts the characteristic cherry-red hue to the skin, mucous membranes, and internal organs. Methemoglobin is chocolate-brown (seen in nitrate/nitrite poisoning). Sulfhemoglobin is greenish. Oxyhemoglobin is the normal bright red form of hemoglobin seen in arterial blood.",
      difficulty: 3,
      subject: "Forensic Medicine",
      topic: "Poisoning",
      tags: ["PYQ"]
    }
  ];
  const input = document.getElementById('jsonInput');
  if (input) {
    input.value = JSON.stringify(sample, null, 2);
    if (typeof validateJSONLive === 'function') validateJSONLive();
    showToast('Sample questions loaded. Click Load Questions to begin.');
  }
}

function loadFromStorage() {
  vibrate(30);
  const saved = localStorage.getItem('medquiz_last_json');
  if (saved) {
    const input = document.getElementById('jsonInput');
    if (input) {
      input.value = saved;
      if (typeof validateJSONLive === 'function') validateJSONLive();
      showToast('Last session restored.');
    }
  } else {
    showToast('No saved session found.');
  }
}

function clearInput() {
  vibrate(40);
  const input = document.getElementById('jsonInput');
  if (input) input.value = '';
  _hideAllConfigSections();
  questions     = [];
  selectedMode  = null;
  smartFilterTag = null;
}

function _hideAllConfigSections() {
  const parseStatus = document.getElementById('parseStatus');
  if (parseStatus) { parseStatus.innerHTML = ''; parseStatus.style.display = 'none'; }

  const qPreview = document.getElementById('qPreview');
  if (qPreview) qPreview.style.display = 'none';

  const smartFilters = document.getElementById('smartFilters');
  if (smartFilters) smartFilters.style.display = 'none';

  const diffWrap = document.getElementById('difficultyMeterWrap');
  if (diffWrap) diffWrap.style.display = 'none';

  const configSection = document.getElementById('quizConfigSection');
  if (configSection) configSection.classList.remove('revealed');

  const retakeCard = document.getElementById('retakeModeCard');
  if (retakeCard) retakeCard.style.display = 'none';
}

// ═══════════════════════════════════════════════
// CSV / EXCEL UPLOAD
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
      const data      = new Uint8Array(e.target.result);
      const workbook  = XLSX.read(data, { type: 'array' });
      const sheet     = workbook.Sheets[workbook.SheetNames[0]];
      const rows      = XLSX.utils.sheet_to_json(sheet);
      const converted = rows.map(row => ({
        question:       row.question       || row.Question       || '',
        options: [
          row.option_a || row.OptionA || row['Option A'] || '',
          row.option_b || row.OptionB || row['Option B'] || '',
          row.option_c || row.OptionC || row['Option C'] || '',
          row.option_d || row.OptionD || row['Option D'] || ''
        ].filter(Boolean),
        correct_option: row.correct_option || row.CorrectOption  || row['Correct Option'] || '',
        explanation:    row.explanation    || row.Explanation    || '',
        subject:        row.subject        || row.Subject        || '',
        topic:          row.topic          || row.Topic          || '',
        difficulty:     parseInt(row.difficulty || row.Difficulty) || null,
        tags:           (row.tags || row.Tags || '').toString().split(/[,;]/).map(t => t.trim()).filter(Boolean),
        image_url:      row.image_url      || row.ImageURL       || ''
      })).filter(q => q.question && q.options.length >= 2 && q.correct_option);

      if (converted.length === 0) { showToast('No valid questions found in file.'); return; }
      const input = document.getElementById('jsonInput');
      if (input) {
        input.value = JSON.stringify(converted, null, 2);
        showToast(`${converted.length} questions imported from ${file.name}`);
        parseJSON();
      }
    } catch (err) {
      showToast('Error reading file. Ensure columns: question, option_a–d, correct_option.');
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// ═══════════════════════════════════════════════
// JSON PARSING
// ═══════════════════════════════════════════════
function parseJSON() {
  const rawInput = document.getElementById('jsonInput');
  const status   = document.getElementById('parseStatus');
  if (!rawInput) return;
  const raw = rawInput.value.trim();

  if (!raw) {
    vibrate(100); // Error vibration
    _showParseStatus(status, 'error', 'Please paste your JSON questions first.');
    return;
  }

  try {
    let parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      if (typeof parsed === 'object' && parsed.question) parsed = [parsed];
      else throw new Error('JSON must be an array or single question object.');
    }

    const valid  = [];
    const errors = [];

    parsed.forEach((q, i) => {
      if (!q.question) {
        errors.push(`Q${i + 1}: Missing "question"`);
        return;
      }
      if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
        errors.push(`Q${i + 1}: "options" must be an array with at least 2 items`);
        return;
      }
      if (!q.correct_option) {
        errors.push(`Q${i + 1}: Missing "correct_option"`);
        return;
      }
      if (!q.options.includes(q.correct_option)) {
        errors.push(`Q${i + 1}: correct_option does not match any option`);
        return;
      }
      valid.push(q);
    });

    if (valid.length === 0) {
      vibrate(100); // Error vibration
      _showParseStatus(status, 'error',
        `No valid questions found. ${errors.length} error(s): ${errors.slice(0, 3).join(' | ')}`
      );
      document.dispatchEvent(new CustomEvent('quizParseError'));
      return;
    }

    vibrate([30, 50, 30]); // Success double-buzz
    questions = valid;
    localStorage.setItem('medquiz_last_json', raw);

    let statusMsg = `${valid.length} question${valid.length > 1 ? 's' : ''} loaded successfully`;
    if (errors.length) statusMsg += ` (${errors.length} skipped)`;
    _showParseStatus(status, 'success', statusMsg);

    renderPreview();

    // Fire custom event — triggers revealQuizConfig() in index.html
    document.dispatchEvent(new CustomEvent('quizParsed', {
      detail: { count: valid.length, questions: valid }
    }));

    const smartFilters = document.getElementById('smartFilters');
    if (smartFilters) smartFilters.style.display = 'flex';

    const retakeCard = document.getElementById('retakeModeCard');
    if (retakeCard) retakeCard.style.display = hasRetakeData() ? 'block' : 'none';

    selectedMode = null;
    const examCard  = document.getElementById('examModeCard');
    const studyCard = document.getElementById('studyModeCard');
    if (examCard)   examCard.classList.remove('selected');
    if (studyCard)  studyCard.classList.remove('selected');
    if (retakeCard) retakeCard.classList.remove('selected');

    const startSection  = document.getElementById('startSection');
    const timerConfig   = document.getElementById('timerConfig');
    const scoringConfig = document.getElementById('scoringConfig');
    if (startSection)  startSection.style.display = 'none';
    if (timerConfig)   timerConfig.classList.remove('show');
    if (scoringConfig) scoringConfig.classList.remove('show');

  } catch (e) {
    vibrate(100);
    _showParseStatus(status, 'error', `Invalid JSON: ${e.message}`);
    document.dispatchEvent(new CustomEvent('quizParseError'));
  }
}

function _showParseStatus(el, type, msg) {
  if (!el) return;
  el.className     = `parse-status ${type}`;
  el.textContent   = msg;
  el.style.display = 'block';
  el.style.removeProperty('display');
}

function renderPreview() {
  const preview  = document.getElementById('qPreview');
  const chipList = document.getElementById('qChipList');
  const statsBar = document.getElementById('statsBar');
  const title    = document.getElementById('qPreviewTitle');
  if (!preview) return;

  if (chipList) { chipList.innerHTML = ''; chipList.style.display = 'none'; }
  if (title)    title.textContent = '';

  const subjects = [...new Set(questions.map(q => q.subject).filter(Boolean))];
  const topics   = [...new Set(questions.map(q => q.topic).filter(Boolean))];

  if (statsBar) {
    statsBar.innerHTML = `
      <div class="stat-item">
        <div class="stat-val">${questions.length}</div>
        <div class="stat-lbl">Questions</div>
      </div>
      <div class="stat-item">
        <div class="stat-val">${subjects.length || '—'}</div>
        <div class="stat-lbl">Subjects</div>
      </div>
      <div class="stat-item">
        <div class="stat-val">${topics.length || '—'}</div>
        <div class="stat-lbl">Topics</div>
      </div>`;
  }

  preview.style.display = 'block';
}

function toggleSmartFilter(tag, el) {
  vibrate(20);
  if (smartFilterTag === tag) {
    smartFilterTag = null;
    el.classList.remove('active');
    showToast('Filter removed — showing all questions.');
  } else {
    document.querySelectorAll('.smart-filter-chip[data-tag]').forEach(c => c.classList.remove('active'));
    smartFilterTag = tag;
    el.classList.add('active');
    const count = questions.filter(q => q.tags && q.tags.includes(tag)).length;
    showToast(`Filtered: ${count} question${count !== 1 ? 's' : ''} tagged "${tag}".`);
  }
}

function resetSmartFilters() {
  vibrate(20);
  smartFilterTag = null;
  document.querySelectorAll('.smart-filter-chip[data-tag]').forEach(c => c.classList.remove('active'));
  showToast('All questions shown.');
}

function getFilteredQuestions() {
  if (!smartFilterTag) return questions;
  return questions.filter(q => q.tags && q.tags.includes(smartFilterTag));
}

// ═══════════════════════════════════════════════
// SHUFFLE HELPERS
// ═══════════════════════════════════════════════
function _shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _applyShuffleAndTarget(qs) {
  let result = qs.slice();
  if (window._shuffleQuestions) result = _shuffleArray(result);
  if (window._shuffleOptions) {
    result = result.map(q => ({ ...q, options: _shuffleArray(q.options) }));
  }
  const target = window._questionTarget;
  if (target && Number.isInteger(target) && target > 0 && target < result.length) {
    result = result.slice(0, target);
  }
  return result;
}

// ═══════════════════════════════════════════════
// MODE & SCORING
// ═══════════════════════════════════════════════
function selectMode(mode) {
  vibrate(30);
  selectedMode = mode;

  const examCard   = document.getElementById('examModeCard');
  const studyCard  = document.getElementById('studyModeCard');
  const retakeCard = document.getElementById('retakeModeCard');

  if (examCard)   examCard.classList.toggle('selected',   mode === 'exam');
  if (studyCard)  studyCard.classList.toggle('selected',  mode === 'study');
  if (retakeCard) retakeCard.classList.toggle('selected', mode === 'retake');

  const startSection  = document.getElementById('startSection');
  const timerConfig   = document.getElementById('timerConfig');
  const scoringConfig = document.getElementById('scoringConfig');

  if (startSection)  startSection.style.display = 'block';
  if (timerConfig)   timerConfig.classList.toggle('show',   mode === 'exam');
  if (scoringConfig) scoringConfig.classList.toggle('show', mode === 'exam');

  updateTimerDisplay();
}

function setTimerPreset(sec) {
  vibrate(20);
  timePerQuestion = sec;
  document.querySelectorAll('.timer-preset').forEach(p => p.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  const customMin = document.getElementById('customMinutes');
  if (customMin) customMin.value = '';
  updateTimerDisplay();
}

function setCustomTimer() {
  vibrate(20);
  const minInput = document.getElementById('customMinutes');
  const min      = parseInt(minInput ? minInput.value : '');
  if (!min || min < 1) { showToast('Enter valid minutes.'); return; }
  const qCount    = getFilteredQuestions().length || questions.length;
  timePerQuestion = Math.round((min * 60) / qCount);
  document.querySelectorAll('.timer-preset').forEach(p => p.classList.remove('active'));
  updateTimerDisplay();
  showToast(`Timer set: ${min} min total.`);
}

function updateTimerDisplay() {
  const qCount   = getFilteredQuestions().length || questions.length;
  const totalMin = Math.round((timePerQuestion * qCount) / 60);
  const el       = document.getElementById('timerDisplay2');
  if (el) el.textContent = timePerQuestion === 0 ? 'Total: No limit' : `Total: ${totalMin} min`;
}

function toggleScoringModel() {
  vibrate(20);
  useNegativeMarking = document.getElementById('negMarkingCheck').checked;
  const badge = document.getElementById('scoringBadge');
  if (badge) badge.style.display = useNegativeMarking ? 'inline' : 'none';
  showToast(useNegativeMarking ? '+4 / -1 Negative Marking ON' : 'Standard Scoring ON');
}

function startQuiz() {
  vibrate(40);
  if (!selectedMode) { showToast('Please select a quiz mode first.'); return; }
  if (selectedMode === 'retake') { startRetake(); return; }

  let filtered = getFilteredQuestions();
  if (filtered.length === 0) { showToast('No questions match the active filter.'); return; }

  filtered  = _applyShuffleAndTarget(filtered);
  if (filtered.length === 0) { showToast('No questions available after applying settings.'); return; }

  questions = filtered;
  quizMode  = selectedMode;

  localStorage.setItem('mq_questions',          JSON.stringify(questions));
  localStorage.setItem('mq_mode',               quizMode);
  localStorage.setItem('mq_timePerQuestion',    timePerQuestion);
  localStorage.setItem('mq_useNegativeMarking', useNegativeMarking);

  if (quizMode === 'exam') window.location.href = 'exam.html';
  else                     window.location.href = 'study.html';
}

// ═══════════════════════════════════════════════
// QUESTION BANK
// ═══════════════════════════════════════════════
async function saveToBank() {
  vibrate(50);
  if (!questions.length) { showToast('No questions loaded!'); return; }
  const nameInput = document.getElementById('bankNameInput');
  const name = nameInput
    ? (nameInput.value.trim() || `Bank_${new Date().toISOString().slice(0, 10)}`)
    : `Bank_${new Date().toISOString().slice(0, 10)}`;
  await dbPut('banks', {
    name,
    questions: JSON.parse(JSON.stringify(questions)),
    savedAt:   new Date().toISOString(),
    count:     questions.length
  });
  if (nameInput) nameInput.value = '';
  showToast(`"${name}" saved (${questions.length} questions).`);
  loadBankList();
}

async function loadBankList() {
  const list = document.getElementById('bankList');
  if (!list) return;
  const banks = await dbGetAll('banks');
  if (banks.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">No saved banks yet.</div>';
    return;
  }
  list.innerHTML = banks.map(b => `
    <div class="bank-item">
      <span class="bank-item-name">${b.name}</span>
      <span class="bank-item-meta">${b.count} questions · ${new Date(b.savedAt).toLocaleDateString()}</span>
      <div style="display:flex;gap:4px">
        <button class="btn btn-primary btn-xs" onclick="loadBank('${b.name}')">Load</button>
        <button class="btn btn-red btn-xs"     onclick="deleteBank('${b.name}')">Delete</button>
      </div>
    </div>`).join('');
}

async function loadBank(name) {
  vibrate(40);
  const bank = await dbGet('banks', name);
  if (bank && bank.questions) {
    const input = document.getElementById('jsonInput');
    if (input) input.value = JSON.stringify(bank.questions, null, 2);
    closeModal('bankModal');
    showToast(`Bank "${name}" loaded (${bank.questions.length} questions).`);
    parseJSON();
  }
}

async function deleteBank(name) {
  vibrate(40);
  await dbDelete('banks', name);
  showToast(`Bank "${name}" deleted.`);
  loadBankList();
}

// ═══════════════════════════════════════════════
// FOLDERS
// ═══════════════════════════════════════════════
async function saveToFolder(qIdx) {
  const folderName = prompt('Enter folder name (e.g., "Tricky Syndromes"):');
  if (!folderName || !folderName.trim()) return;
  const folder = (await dbGet('folders', folderName.trim())) || {
    folderName: folderName.trim(), questions: []
  };
  const q = questions[qIdx];
  if (!q) return;
  if (!folder.questions.some(fq => fq.question === q.question)) {
    folder.questions.push({ ...q, savedAt: new Date().toISOString(), originalIdx: qIdx });
    await dbPut('folders', folder);
    vibrate(40);
    showToast(`Saved to "${folderName.trim()}".`);
  } else {
    showToast('Already in that folder.');
  }
}

async function loadFolderUI() {
  const folderList      = document.getElementById('folderList');
  const folderQuestions = document.getElementById('folderQuestions');
  if (!folderList) return;
  const folders = await dbGetAll('folders');
  if (folders.length === 0) {
    folderList.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No folders yet.</span>';
    if (folderQuestions) folderQuestions.innerHTML = '';
    return;
  }
  folderList.innerHTML = folders.map(f =>
    `<span class="folder-chip" onclick="viewFolder('${f.folderName}')">
      ${f.folderName}
      <span class="folder-count">${f.questions.length}</span>
    </span>`
  ).join('');
  if (folders[0]) viewFolderContent(folders[0], folderQuestions);
}

function viewFolder(name) {
  vibrate(20);
  const container = document.getElementById('folderQuestions');
  dbGet('folders', name).then(f => { if (f) viewFolderContent(f, container); });
}

function viewFolderContent(folder, container) {
  if (!container) return;
  if (folder.questions.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-muted)">Empty folder.</div>';
    return;
  }
  container.innerHTML = folder.questions.map((q, i) =>
    `<div class="bank-item">
      <span style="font-size:11px;flex:1;min-width:100px">${q.question.substring(0, 50)}...</span>
      <button class="btn btn-red btn-xs" onclick="removeFromFolder('${folder.folderName}', ${i})">Remove</button>
    </div>`
  ).join('');
}

async function removeFromFolder(folderName, idx) {
  vibrate(30);
  const folder = await dbGet('folders', folderName);
  if (folder) {
    folder.questions.splice(idx, 1);
    await dbPut('folders', folder);
    loadFolderUI();
    showToast('Removed from folder.');
  }
}

async function createFolder() {
  vibrate(40);
  const nameInput = document.getElementById('newFolderName');
  const name      = nameInput ? nameInput.value.trim() : '';
  if (!name) { showToast('Enter a folder name.'); return; }
  const existing = await dbGet('folders', name);
  if (!existing) {
    await dbPut('folders', { folderName: name, questions: [] });
    showToast(`Folder "${name}" created.`);
  } else {
    showToast('Folder already exists.');
  }
  if (nameInput) nameInput.value = '';
  loadFolderUI();
}

// ═══════════════════════════════════════════════
// EXAM MODE
// ═══════════════════════════════════════════════
function startExam() {
  currentQ             = 0;
  examAnswers          = {};
  flagged              = new Set();
  questionTimings      = {};
  questionStartTime    = Date.now();
  totalSeconds         = timePerQuestion * questions.length;
  originalTotalSeconds = totalSeconds;
  isPaused             = false;

  const scoringBadge = document.getElementById('scoringBadge');
  if (scoringBadge) scoringBadge.style.display = useNegativeMarking ? 'inline' : 'none';

  const examScreen = document.getElementById('examScreen');
  if (examScreen) examScreen.classList.add('active');

  renderExamQuestion();
  renderNavGrid();

  const timerBox = document.getElementById('timerBox');
  if (timePerQuestion > 0) {
    startTimer();
    if (timerBox) timerBox.style.display = 'flex';
  } else {
    if (timerBox) timerBox.style.display = 'none';
  }

  const navBtnCount = document.getElementById('navBtnCount');
  if (navBtnCount) navBtnCount.textContent = `Nav (${questions.length})`;

  const perQTimer = document.getElementById('perQuestionTimer');
  if (perQTimer) perQTimer.style.display = 'flex';
  updatePerQuestionTimer();
}

function startTimer() {
  clearInterval(timerInterval);
  const display = document.getElementById('timerDisplay');
  if (!display) return;
  display.textContent = formatTime(totalSeconds);
  display.className   = 'timer-display';
  timerInterval = setInterval(() => {
    if (isPaused) return;
    totalSeconds--;
    display.textContent = formatTime(totalSeconds);
    updatePerQuestionTimer();
    const pct = totalSeconds / originalTotalSeconds;
    if (totalSeconds <= 60)   display.className = 'timer-display danger';
    else if (pct <= 0.25)     display.className = 'timer-display warning';
    if (totalSeconds <= 0) {
      clearInterval(timerInterval);
      openModal('timeUpModal');
    }
  }, 1000);
}

function updatePerQuestionTimer() {
  const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
  const el      = document.getElementById('perQuestionTimer');
  if (el) el.textContent = `Q-Time: ${elapsed}s`;
}

function togglePause() {
  if (timePerQuestion === 0) return;
  isPaused = !isPaused;
  const overlay = document.getElementById('pauseOverlay');
  if (overlay) overlay.classList.toggle('show', isPaused);
}

function renderExamQuestion() {
  const q = questions[currentQ];
  if (!q) return;
  recordQuestionTiming();
  questionStartTime = Date.now();
  updatePerQuestionTimer();

  const meta = document.getElementById('examQuestionMeta');
  if (meta) {
    meta.innerHTML = '';
    if (q.subject)    meta.innerHTML += `<span class="meta-tag subject">${q.subject}</span>`;
    if (q.topic)      meta.innerHTML += `<span class="meta-tag topic">${q.topic}</span>`;
    if (q.difficulty) meta.innerHTML += `<span class="meta-tag difficulty">${getDifficultyLabel(q.difficulty)}</span>`;
    if (q.tags)       q.tags.forEach(t => meta.innerHTML += `<span class="meta-tag tag">${t}</span>`);
  }

  const img = document.getElementById('examQuestionImage');
  if (img) {
    if (q.image_url) {
      img.src = q.image_url; img.classList.add('show');
      img.onerror = () => img.classList.remove('show');
    } else {
      img.classList.remove('show');
    }
  }

  const examQNum  = document.getElementById('examQNumber');
  const examQText = document.getElementById('examQuestionText');
  if (examQNum)  examQNum.textContent  = `Question ${currentQ + 1} of ${questions.length}`;
  if (examQText) examQText.textContent = q.question;

  const optList = document.getElementById('examOptionsList');
  if (optList) {
    optList.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    q.options.forEach((opt, i) => {
      const selected = examAnswers[currentQ] === opt;
      const div      = document.createElement('div');
      div.className  = `option-item${selected ? ' selected' : ''}`;
      div.innerHTML  = `<div class="option-letter">${letters[i]}</div><div class="option-text">${opt}</div>`;
      div.onclick    = () => selectExamOption(opt, div);
      optList.appendChild(div);
    });
  }

  const flagBtn = document.getElementById('flagBtn');
  if (flagBtn) flagBtn.classList.toggle('active', flagged.has(currentQ));

  const prevBtn = document.getElementById('examPrevBtn');
  const nextBtn = document.getElementById('examNextBtn');
  if (prevBtn) prevBtn.disabled = currentQ === 0;
  if (nextBtn) nextBtn.disabled = currentQ === questions.length - 1;

  const answered = Object.keys(examAnswers).length;
  const examProgText   = document.getElementById('examProgressText');
  const examAnswText   = document.getElementById('examAnsweredText');
  const examProgBar    = document.getElementById('examProgressBar');
  if (examProgText) examProgText.textContent = `Question ${currentQ + 1} of ${questions.length}`;
  if (examAnswText) examAnswText.textContent = `${answered} Answered · ${flagged.size} Flagged`;
  if (examProgBar)  examProgBar.style.width  = `${((currentQ + 1) / questions.length) * 100}%`;

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
  const examAnswText = document.getElementById('examAnsweredText');
  if (examAnswText)
    examAnswText.textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`;
}

function clearAnswer() {
  if (examAnswers[currentQ] !== undefined) {
    delete examAnswers[currentQ];
    document.querySelectorAll('#examOptionsList .option-item').forEach(o => o.classList.remove('selected'));
    updateNavGrid();
    const examAnswText = document.getElementById('examAnsweredText');
    if (examAnswText)
      examAnswText.textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`;
    showToast('Answer cleared.');
  }
}

function examNavigate(dir) {
  const next = currentQ + dir;
  if (next >= 0 && next < questions.length) {
    currentQ = next;
    renderExamQuestion();
  }
}

function toggleFlag() {
  if (flagged.has(currentQ)) {
    flagged.delete(currentQ);
    const flagBtn = document.getElementById('flagBtn');
    if (flagBtn) flagBtn.classList.remove('active');
  } else {
    flagged.add(currentQ);
    const flagBtn = document.getElementById('flagBtn');
    if (flagBtn) flagBtn.classList.add('active');
  }
  updateNavGrid();
  const examAnswText = document.getElementById('examAnsweredText');
  if (examAnswText)
    examAnswText.textContent = `${Object.keys(examAnswers).length} Answered · ${flagged.size} Flagged`;
}

function renderNavGrid() {
  ['navGrid', 'mobileNavGrid'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = '';
    questions.forEach((_, i) => {
      const btn       = document.createElement('button');
      btn.className   = 'nav-btn';
      btn.textContent = i + 1;
      btn.onclick     = () => { currentQ = i; renderExamQuestion(); closeMobileNav(); };
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
      if (i === currentQ)               btn.classList.add('current');
      if (examAnswers[i] !== undefined) btn.classList.add('answered');
      if (flagged.has(i))               btn.classList.add('flagged');
    });
  });
}

function showSubmitModal() {
  const answered   = Object.keys(examAnswers).length;
  const unanswered = questions.length - answered;
  let body = `You have answered <strong>${answered}</strong> of <strong>${questions.length}</strong> questions.`;
  if (unanswered > 0) body += `<br><span style="color:var(--accent-red)">${unanswered} unanswered.</span>`;
  if (flagged.size  > 0) body += `<br><span style="color:var(--accent-yellow)">${flagged.size} flagged.</span>`;
  const submitModalBody = document.getElementById('submitModalBody');
  if (submitModalBody) submitModalBody.innerHTML = body;
  openModal('submitModal');
}

function submitExam() {
  recordQuestionTiming();
  clearInterval(timerInterval);
  closeModal('submitModal');
  closeModal('timeUpModal');

  let correct = 0, wrong = 0, skipped = 0;
  allResults = [];

  questions.forEach((q, i) => {
    const ua        = examAnswers[i];
    const isCorrect = ua === q.correct_option;
    if (!ua)            skipped++;
    else if (isCorrect) correct++;
    else                wrong++;
    allResults.push({
      q,
      userAnswer: ua || null,
      correct:    !!ua && isCorrect,
      index:      i,
      timeSpent:  questionTimings[i] || 0
    });
  });

  saveAnalyticsData(correct + wrong);
  updateMilestone(correct + wrong);
  localStorage.setItem('mq_results',            JSON.stringify(allResults));
  localStorage.setItem('mq_useNegativeMarking', useNegativeMarking);
  window.location.href = 'results.html';
}

function toggleMobileNav() {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.add('show');
}
function closeMobileNav() {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.remove('show');
}

// ═══════════════════════════════════════════════
// STUDY MODE
// ═══════════════════════════════════════════════
function startStudy() {
  currentQ      = 0;
  studyScore    = 0;
  studyAnswered = false;
  studyResults  = [];
  renderStudyQuestion();
}

function renderStudyQuestion() {
  const q = questions[currentQ];
  if (!q) return;
  studyAnswered = false;

  const resultFeedback = document.getElementById('resultFeedback');
  const explanationBox = document.getElementById('explanationBox');
  const studyNextBtn   = document.getElementById('studyNextBtn');
  const studyFinishBtn = document.getElementById('studyFinishBtn');
  const aiExplainPanel = document.getElementById('aiExplainPanel');
  const aiPromptChips  = document.getElementById('aiPromptChips');
  const aiExplainBtn   = document.getElementById('aiExplainBtn');

  if (resultFeedback) resultFeedback.style.display = 'none';
  if (explanationBox) explanationBox.classList.remove('show');
  if (studyNextBtn)   studyNextBtn.style.display   = 'none';
  if (studyFinishBtn) studyFinishBtn.style.display  = 'none';
  if (aiExplainPanel) aiExplainPanel.classList.remove('show');
  if (aiPromptChips)  aiPromptChips.style.display  = 'none';
  // Pollinations is always ready
  if (aiExplainBtn) aiExplainBtn.style.display = 'inline-flex';

  const meta = document.getElementById('studyQuestionMeta');
  if (meta) {
    meta.innerHTML = '';
    if (q.subject)      meta.innerHTML += `<span class="meta-tag subject">${q.subject}</span>`;
    if (q.topic)        meta.innerHTML += `<span class="meta-tag topic">${q.topic}</span>`;
    if (q.difficulty)   meta.innerHTML += `<span class="meta-tag difficulty">${getDifficultyLabel(q.difficulty)}</span>`;
    if (q.blooms_level) meta.innerHTML += `<span class="meta-tag difficulty">${getBloomsLabel(q.blooms_level)}</span>`;
    if (q.tags)         q.tags.forEach(t => meta.innerHTML += `<span class="meta-tag tag">${t}</span>`);
  }

  const img = document.getElementById('studyQuestionImage');
  if (img) {
    if (q.image_url) {
      img.src = q.image_url; img.classList.add('show');
      img.onerror = () => img.classList.remove('show');
    } else {
      img.classList.remove('show');
    }
  }

  const studyQNum   = document.getElementById('studyQNumber');
  const studyQText  = document.getElementById('studyQuestionText');
  const studyProg   = document.getElementById('studyProgressText');
  const studyScore_ = document.getElementById('studyScoreText');
  const studyBar    = document.getElementById('studyProgressBar');

  if (studyQNum)   studyQNum.textContent   = `Question ${currentQ + 1} of ${questions.length}`;
  if (studyQText)  studyQText.textContent  = q.question;
  if (studyProg)   studyProg.textContent   = `Question ${currentQ + 1} of ${questions.length}`;
  if (studyScore_) studyScore_.textContent = `Score: ${studyScore}/${currentQ}`;
  if (studyBar)    studyBar.style.width    = `${(currentQ / questions.length) * 100}%`;

  const optList = document.getElementById('studyOptionsList');
  if (optList) {
    optList.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    q.options.forEach((opt, i) => {
      const div     = document.createElement('div');
      div.className = 'option-item';
      div.innerHTML = `<div class="option-letter">${letters[i]}</div><div class="option-text">${opt}</div><div class="option-icon"></div>`;
      div.onclick   = () => selectStudyOption(opt, div);
      optList.appendChild(div);
    });
  }
}

function selectStudyOption(opt, el) {
  if (studyAnswered) return;
  studyAnswered = true;
  const q         = questions[currentQ];
  const isCorrect = opt === q.correct_option;

  document.querySelectorAll('#studyOptionsList .option-item').forEach((item, i) => {
    item.classList.add('disabled');
    if (q.options[i] === q.correct_option) {
      item.classList.add('correct');
      item.querySelector('.option-icon').textContent = '✓';
    } else if (q.options[i] === opt && !isCorrect) {
      item.classList.add('wrong');
      item.querySelector('.option-icon').textContent = '✗';
    }
  });

  const feedback = document.getElementById('resultFeedback');
  if (feedback) {
    if (isCorrect) {
      studyScore++;
      feedback.className = 'result-feedback correct-feedback';
      feedback.innerHTML = 'Correct! Well done.';
    } else {
      feedback.className = 'result-feedback wrong-feedback';
      feedback.innerHTML = `Incorrect. Correct answer: <strong style="margin-left:6px">${q.correct_option}</strong>`;
    }
    feedback.style.display = 'flex';
  }

  const explanationText = document.getElementById('explanationText');
  const explanationBox  = document.getElementById('explanationBox');
  if (explanationText) explanationText.textContent = q.explanation || 'No explanation provided.';
  if (explanationBox)  explanationBox.classList.add('show');

  const aiPromptChips = document.getElementById('aiPromptChips');
  if (aiPromptChips) aiPromptChips.style.display = 'flex';

  studyResults.push({ q, userAnswer: opt, correct: isCorrect, explanation: q.explanation });

  const studyNextBtn   = document.getElementById('studyNextBtn');
  const studyFinishBtn = document.getElementById('studyFinishBtn');
  if (currentQ < questions.length - 1) {
    if (studyNextBtn) studyNextBtn.style.display = 'inline-flex';
  } else {
    if (studyFinishBtn) studyFinishBtn.style.display = 'inline-flex';
  }

  const studyScoreEl = document.getElementById('studyScoreText');
  if (studyScoreEl) studyScoreEl.textContent = `Score: ${studyScore}/${currentQ + 1}`;
  updateSRSData(q, isCorrect);
}

async function getAIExplanation(mode) {
  const q       = questions[currentQ];
  const panel   = document.getElementById('aiExplainPanel');
  const content = document.getElementById('aiExplainContent');
  const btn     = document.getElementById('aiExplainBtn');
  if (!panel || !content || !q) return;

  panel.classList.add('show');
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div>AI is thinking...</div>';
  if (btn) btn.disabled = true;

  let extra = '';
  if (mode === 'stepbystep') extra = 'Provide a detailed step-by-step breakdown of the reasoning process.';
  if (mode === 'mnemonic')   extra = 'Create a memorable mnemonic or memory aid for the correct answer and key concept.';
  if (mode === 'contrast')   extra = 'Explain why the correct answer is right AND specifically why each wrong option is incorrect. Contrast them clearly.';
  if (mode === 'clinical')   extra = 'Relate this to real clinical practice. Give a clinical pearl or bedside tip relevant to exams.';

  try {
    const prompt = `You are an expert medical educator teaching NEET PG / INI-CET aspirants. ${extra}

Explain this MCQ in depth — assume the student is encountering this topic for the first time:

Question: ${q.question}
Options: ${q.options.join(' | ')}
Correct Answer: ${q.correct_option}
Existing Explanation: ${q.explanation || 'None provided'}

Include:
- Why the correct answer is right (mechanism, pathophysiology)
- Why each wrong option is incorrect
- Key clinical pearls or mnemonics if applicable

Keep it under 300 words, plain text only.`;
    const response = await callAI(prompt);
    content.textContent = response;
  } catch (e) {
    content.innerHTML = `<span style="color:var(--accent-red)">AI error: ${e.message}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
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
  let card    = (await dbGet('srs', qHash)) || {
    qHash, question: q.question, answer: q.correct_option,
    explanation: q.explanation, interval: 1, repetitions: 0,
    easeFactor: 2.5, nextReview: new Date().toISOString(), lastCorrect: false
  };
  if (isCorrect) {
    card.repetitions++;
    card.interval   = card.repetitions === 1 ? 1
                    : card.repetitions === 2 ? 6
                    : Math.round(card.interval * card.easeFactor);
    card.easeFactor = Math.max(1.3, card.easeFactor + 0.1);
  } else {
    card.repetitions = 0;
    card.interval    = 1;
    card.easeFactor  = Math.max(1.3, card.easeFactor - 0.2);
  }
  card.lastCorrect = isCorrect;
  card.nextReview  = new Date(Date.now() + card.interval * 86400000).toISOString();
  await dbPut('srs', card);
}

function hashQuestion(q) {
  let hash = 0;
  for (let i = 0; i < q.length; i++) {
    hash = ((hash << 5) - hash) + q.charCodeAt(i);
    hash |= 0;
  }
  return 'q_' + Math.abs(hash);
}

// ═══════════════════════════════════════════════
// POMODORO
// ═══════════════════════════════════════════════
function togglePomodoroWidget() {
  const widget = document.getElementById('pomodoroWidget');
  const toggle = document.getElementById('pomodoroToggle');
  if (!widget) return;
  const showing = widget.classList.contains('show');
  if (showing) {
    widget.classList.remove('show');
    if (toggle) toggle.classList.remove('hidden');
  } else {
    widget.classList.add('show');
    if (toggle) toggle.classList.add('hidden');
  }
}

function setPomodoroPreset(min) {
  vibrate(20);
  pomodoroSeconds = min * 60;
  pomodoroIsBreak = false;
  updatePomodoroDisplay();
  const pomoLabel = document.getElementById('pomoLabel');
  if (pomoLabel) pomoLabel.textContent = 'FOCUS';
}

function updatePomodoroDisplay() {
  const el = document.getElementById('pomoTime');
  if (el) el.textContent = formatTime(pomodoroSeconds);
}

function startPomodoro() {
  vibrate(30);
  if (pomodoroRunning) {
    clearInterval(pomodoroInterval);
    pomodoroRunning = false;
    const btn = document.getElementById('pomoStartBtn');
    if (btn) btn.textContent = 'Start';
    return;
  }
  pomodoroRunning = true;
  const btn = document.getElementById('pomoStartBtn');
  if (btn) btn.textContent = 'Pause';
  pomodoroInterval = setInterval(() => {
    pomodoroSeconds--;
    updatePomodoroDisplay();
    if (pomodoroSeconds <= 0) {
      clearInterval(pomodoroInterval);
      pomodoroRunning = false;
      const startBtn  = document.getElementById('pomoStartBtn');
      const pomoLabel = document.getElementById('pomoLabel');
      if (startBtn) startBtn.textContent = 'Start';
      if (!pomodoroIsBreak) {
        pomodoroSeconds = POMODORO_BREAK;
        pomodoroIsBreak = true;
        if (pomoLabel) pomoLabel.textContent = 'BREAK';
        vibrate([200, 100, 200, 100, 200]); // Long buzz for break
        showToast('Focus session done! Take a 5-minute break.');
      } else {
        pomodoroSeconds = POMODORO_FOCUS;
        pomodoroIsBreak = false;
        if (pomoLabel) pomoLabel.textContent = 'FOCUS';
        vibrate([200, 100, 200]);
        showToast('Break over! Ready to focus again?');
      }
      updatePomodoroDisplay();
    }
  }, 1000);
}

function resetPomodoro() {
  vibrate(20);
  clearInterval(pomodoroInterval);
  pomodoroRunning  = false;
  pomodoroSeconds  = POMODORO_FOCUS;
  pomodoroIsBreak  = false;
  const btn        = document.getElementById('pomoStartBtn');
  const label      = document.getElementById('pomoLabel');
  if (btn)   btn.textContent   = 'Start';
  if (label) label.textContent = 'FOCUS';
  updatePomodoroDisplay();
}

// ═══════════════════════════════════════════════
// MILESTONE / DAILY GOAL (REWRITTEN FOR SVG DIAL)
// ═══════════════════════════════════════════════
async function loadDailyGoal() {
  const saved = localStorage.getItem('medquiz_daily_goal');
  if (saved) dailyGoal = parseInt(saved) || 100;
  const input = document.getElementById('dailyGoalInput');
  if (input) input.value = dailyGoal;
  await updateMilestoneBar();
}

function setDailyGoal() {
  vibrate(20);
  const input = document.getElementById('dailyGoalInput');
  const val   = parseInt(input ? input.value : '');
  if (!val || val < 1) { showToast('Enter a valid goal number.'); return; }
  dailyGoal = val;
  localStorage.setItem('medquiz_daily_goal', val);
  updateMilestoneBar();
  showToast(`Daily goal set: ${val} questions.`);
}

async function updateMilestone(answeredToday = 0) {
  const today    = new Date().toISOString().slice(0, 10);
  const existing = (await dbGet('milestones', today)) || { date: today, answered: 0 };
  if (answeredToday > 0) {
    existing.answered += answeredToday;
    await dbPut('milestones', existing);
  }
  await updateMilestoneBar();
}

// ── THE MAGIC: Updates BOTH the modal bar AND the Navbar SVG Dial ──
async function updateMilestoneBar() {
  const today    = new Date().toISOString().slice(0, 10);
  const existing = (await dbGet('milestones', today)) || { date: today, answered: 0 };
  const answered = existing.answered || 0;
  const pct      = Math.min(100, Math.max(0, (answered / dailyGoal) * 100)); // clamp between 0 and 100

  // 1. Update Modal UI
  const milestoneText = document.getElementById('milestoneText');
  const milestoneFill = document.getElementById('milestoneFill');
  if (milestoneText) milestoneText.textContent = `${answered} / ${dailyGoal} Questions Today`;
  if (milestoneFill) {
    milestoneFill.style.width = `${pct}%`;
  }

  // 2. Update Navbar SVG Ring
  const navRing = document.getElementById('navGoalRing');
  if (navRing) {
    const circumference = 87.96; // 2 * PI * 14
    const offset = circumference - (pct / 100) * circumference;
    
    // Animate the fill length
    navRing.style.strokeDashoffset = offset;
    
    // Dynamic color shifting based on progress
    if (pct >= 100) {
      navRing.style.stroke = '#10b981'; // Green (Success)
    } else if (pct >= 75) {
      navRing.style.stroke = '#06b6d4'; // Cyan (Almost there)
    } else if (pct >= 40) {
      navRing.style.stroke = '#f59e0b'; // Orange (Halfway)
    } else if (pct > 0) {
      navRing.style.stroke = '#ef4444'; // Red (Started)
    } else {
      navRing.style.stroke = 'transparent'; // Hidden at exactly 0
    }
  }
}

// ═══════════════════════════════════════════════
// ANALYTICS / HEATMAP
// ═══════════════════════════════════════════════
async function saveAnalyticsData(countAnswered) {
  const today    = new Date().toISOString().slice(0, 10);
  const existing = (await dbGet('analytics', today)) || { date: today, questionsAnswered: 0, quizzes: 0 };
  existing.questionsAnswered += countAnswered;
  existing.quizzes           += 1;
  await dbPut('analytics', existing);
}

function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const days  = 84;
  const today = new Date();
  grid.innerHTML = '';
  (async () => {
    const analytics = await dbGetAll('analytics');
    const dateMap   = {};
    analytics.forEach(a => { dateMap[a.date] = a.questionsAnswered || 0; });
    for (let i = days - 1; i >= 0; i--) {
      const d     = new Date(today);
      d.setDate(d.getDate() - i);
      const key   = d.toISOString().slice(0, 10);
      const count = dateMap[key] || 0;
      const cell  = document.createElement('div');
      cell.className = 'heatmap-cell';
      if      (count >= 50) cell.classList.add('l4');
      else if (count >= 25) cell.classList.add('l3');
      else if (count >= 10) cell.classList.add('l2');
      else if (count >= 1)  cell.classList.add('l1');
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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getDifficultyLabel(d) {
  const map = { 1: 'Easy', 2: 'Easy+', 3: 'Medium', 4: 'Hard', 5: 'Very Hard' };
  return map[d] || `Difficulty ${d}`;
}

function getBloomsLabel(b) {
  const map = { 1: 'Remember', 2: 'Understand', 3: 'Apply', 4: 'Analyze', 5: 'Evaluate', 6: 'Create' };
  return map[b] || `Bloom ${b}`;
}

// ═══════════════════════════════════════════════
// RESULTS PAGE
// ═══════════════════════════════════════════════
function showResults() {
  const resultsData = localStorage.getItem('mq_results');
  if (!resultsData) { window.location.href = 'index.html'; return; }
  allResults         = JSON.parse(resultsData);
  useNegativeMarking = localStorage.getItem('mq_useNegativeMarking') === 'true';

  let correct = 0, wrong = 0, skipped = 0;
  allResults.forEach(r => {
    if (!r.userAnswer)  skipped++;
    else if (r.correct) correct++;
    else                wrong++;
  });

  const total = allResults.length;
  const pct   = Math.round((correct / total) * 100);

  const badge = document.getElementById('resultModeBadge');
  if (badge) { badge.className = 'mode-badge exam'; badge.textContent = 'Exam Mode'; }

  const circumference = 427;
  const offset        = circumference - (pct / 100) * circumference;
  setTimeout(() => {
    const ringFill = document.getElementById('ringFill');
    if (ringFill) ringFill.style.strokeDashoffset = offset;
  }, 100);

  const scorePercent = document.getElementById('scorePercent');
  if (scorePercent) scorePercent.textContent = `${pct}%`;

  const title = pct >= 90 ? 'Outstanding!'
              : pct >= 80 ? 'Excellent!'
              : pct >= 60 ? 'Good Job!'
              : pct >= 40 ? 'Keep Practicing'
              : 'More Practice Needed';

  const resultsTitle    = document.getElementById('resultsTitle');
  const resultsSubtitle = document.getElementById('resultsSubtitle');
  if (resultsTitle)    resultsTitle.textContent = title;
  if (resultsSubtitle) {
    resultsSubtitle.textContent = `You scored ${correct} out of ${total} questions correctly`;
    if (useNegativeMarking) {
      const rawScore = correct * 4 - wrong;
      const maxScore = total * 4;
      resultsSubtitle.textContent += ` · NEET Score: ${rawScore}/${maxScore}`;
    }
  }

  const resultsStats = document.getElementById('resultsStats');
  if (resultsStats) {
    resultsStats.innerHTML = `
      <div class="result-stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div class="stat-number" style="color:var(--accent-green)">${correct}</div>
        <div class="stat-name">Correct</div>
      </div>
      <div class="result-stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6"  y1="6" x2="18" y2="18"/>
          </svg>
        </div>
        <div class="stat-number" style="color:var(--accent-red)">${wrong}</div>
        <div class="stat-name">Wrong</div>
      </div>
      <div class="result-stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 12 19 12"/>
            <polyline points="13 6 19 12 13 18"/>
          </svg>
        </div>
        <div class="stat-number" style="color:var(--text-muted)">${skipped}</div>
        <div class="stat-name">Skipped</div>
      </div>
      <div class="result-stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </div>
        <div class="stat-number" style="color:var(--accent)">${pct}%</div>
        <div class="stat-name">Score</div>
      </div>`;
  }

  const printDate = document.getElementById('printDate');
  if (printDate) printDate.textContent = `Generated on ${new Date().toLocaleString()}`;

  const aiAssessBtn = document.getElementById('aiAssessBtn');
  if (aiAssessBtn) aiAssessBtn.style.display = 'inline-flex';
  
  const aiAssessment = document.getElementById('aiAssessment');
  if (aiAssessment) aiAssessment.classList.remove('show');

  renderWeaknessResults();
  renderHeatmap();
  renderReviewItems();

  const retakeWrongBtn = document.getElementById('retakeWrongBtn');
  const wrongCount     = allResults.filter(r => !r.correct || !r.userAnswer).length;
  if (retakeWrongBtn) retakeWrongBtn.style.display = wrongCount > 0 ? 'inline-flex' : 'none';
  if (wrongCount > 0) saveRetakeData(allResults.filter(r => !r.correct || !r.userAnswer));

  flashcardDeck = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
}

function renderWeaknessResults() {
  const dashboard = document.getElementById('weaknessDashboard');
  const content   = document.getElementById('weaknessContent');
  if (!dashboard || !content) return;

  const topicMap = {};
  allResults.forEach(r => {
    const topic = r.q.topic || 'Other';
    if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0 };
    topicMap[topic].total++;
    if (r.correct && r.userAnswer) topicMap[topic].correct++;
  });

  const entries = Object.entries(topicMap)
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));

  if (entries.length === 0) { dashboard.style.display = 'none'; return; }

  dashboard.style.display = 'block';
  content.innerHTML = entries.map(([topic, d]) => {
    const pct = Math.round((d.correct / d.total) * 100);
    const cls = pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad';
    return `
      <div class="weakness-item">
        <span class="weakness-name">${topic}</span>
        <div class="weakness-bar-bg">
          <div class="weakness-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
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
    if (activeFilter === 'all')     return true;
    if (activeFilter === 'correct') return r.correct && r.userAnswer;
    if (activeFilter === 'wrong')   return !r.correct && r.userAnswer;
    if (activeFilter === 'skipped') return !r.userAnswer;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No questions match this filter.</div>';
    return;
  }

  filtered.forEach((r, displayIdx) => {
    const q           = r.q;
    const ua          = r.userAnswer;
    const isCorrect   = r.correct;
    const isSkipped   = !ua;
    const originalIdx = r.index;

    const item     = document.createElement('div');
    item.className = `review-item ${isSkipped ? 'skipped-item' : isCorrect ? 'correct-item' : 'wrong-item'}`;
    item.style.animationDelay = `${displayIdx * 0.03}s`;

    const badgeClass = isSkipped ? 'badge-skipped' : isCorrect ? 'badge-correct' : 'badge-wrong';
    const badgeText  = isSkipped ? 'Skipped'       : isCorrect ? 'Correct'       : 'Wrong';

    let metaHtml = '';
    if (q.subject)    metaHtml += `<span class="meta-tag subject">${q.subject}</span>`;
    if (q.topic)      metaHtml += `<span class="meta-tag topic">${q.topic}</span>`;
    if (q.difficulty) metaHtml += `<span class="meta-tag difficulty">${getDifficultyLabel(q.difficulty)}</span>`;
    if (q.tags)       q.tags.forEach(t => metaHtml += `<span class="meta-tag tag">${t}</span>`);

    let optHtml = '';
    q.options.forEach((opt, oi) => {
      let cls = '';
      if (opt === q.correct_option)      cls = 'r-correct';
      else if (opt === ua && !isCorrect) cls = 'r-wrong';
      const icon = opt === q.correct_option ? '✓' : (opt === ua && !isCorrect ? '✗' : '');
      optHtml += `
        <div class="review-option ${cls}">
          <span style="font-weight:700;flex-shrink:0">${letters[oi]}.</span>
          <span style="flex:1">${opt}</span>
          ${icon ? `<span style="font-weight:700">${icon}</span>` : ''}
        </div>`;
    });

    item.innerHTML = `
      <div class="review-item-header">
        <div class="review-q-number">Q${originalIdx + 1}</div>
        <span class="review-status-badge ${badgeClass}">${badgeText}</span>
      </div>
      ${metaHtml ? `<div class="review-meta-tags">${metaHtml}</div>` : ''}
      <div class="review-q-text">${q.question}</div>
      <div class="review-options">${optHtml}</div>
      ${ua && !isCorrect
        ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">
            Your answer: <strong style="color:var(--accent-red)">${ua}</strong>
            &nbsp;|&nbsp;
            Correct: <strong style="color:var(--accent-green)">${q.correct_option}</strong>
           </div>` : ''}
      ${isSkipped
        ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">
            Correct answer: <strong style="color:var(--accent-green)">${q.correct_option}</strong>
           </div>` : ''}
      <div class="review-explanation">
        <div class="exp-label">Explanation</div>
        <p>${q.explanation || 'No explanation provided.'}</p>
      </div>
      ${r.timeSpent
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Time spent: ${r.timeSpent}s</div>`
        : ''}
      <div class="review-actions no-print">
        <button class="btn btn-ai btn-sm" onclick="getReviewAI(${originalIdx}, this)">AI Deep Dive</button>
        <button class="btn btn-ghost btn-sm" onclick="saveToFolder(${originalIdx})">Save to Folder</button>
      </div>
      <div class="review-ai-response" id="reviewAI_${originalIdx}">
        <div class="review-ai-response-header">AI Analysis</div>
        <div class="review-ai-response-body"></div>
      </div>`;
    container.appendChild(item);
  });
}

function filterReview(f) {
  activeFilter = f;
  document.querySelectorAll('.review-filter').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f)
  );
  renderReviewItems();
}

async function getReviewAI(idx, btn) {
  const q  = questions.length
    ? questions[idx]
    : allResults.find(r => r.index === idx)?.q;
  if (!q) return;
  const ua    = allResults.find(r => r.index === idx)?.userAnswer;
  const panel = document.getElementById(`reviewAI_${idx}`);
  if (!panel) return;
  const body  = panel.querySelector('.review-ai-response-body');
  panel.classList.add('show');
  body.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Analyzing...</div>';
  if (btn) btn.disabled = true;
  try {
    const prompt = `You are an expert medical educator. Explain in depth why "${q.correct_option}" is the correct answer${ua && ua !== q.correct_option ? ` and why "${ua}" is wrong` : ''}.

Question: ${q.question}
All options: ${q.options.join(' | ')}

Include:
- Mechanism/reasoning for correct answer
- Why each distractor is wrong
- Clinical pearl or exam tip if applicable

Max 250 words, plain text only.`;
    const response = await callAI(prompt);
    body.textContent = response;
  } catch (e) {
    body.innerHTML = `<span style="color:var(--accent-red)">AI error: ${e.message}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function getAIAssessment() {
  const btn     = document.getElementById('aiAssessBtn');
  const panel   = document.getElementById('aiAssessment');
  const content = document.getElementById('aiAssessmentContent');
  if (!panel || !content) return;
  panel.classList.add('show');
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div>Analyzing your performance...</div>';
  if (btn) btn.disabled = true;

  const correct     = allResults.filter(r => r.correct && r.userAnswer).length;
  const wrong       = allResults.filter(r => !r.correct && r.userAnswer).length;
  const skipped     = allResults.filter(r => !r.userAnswer).length;
  const wrongTopics = [...new Set(
    allResults.filter(r => !r.correct && r.userAnswer).map(r => r.q.topic).filter(Boolean)
  )];

  try {
    const prompt = `Analyze this medical quiz performance for a NEET PG / INI-CET aspirant:
Score: ${correct}/${allResults.length} (${Math.round(correct / allResults.length * 100)}%)
Wrong: ${wrong} | Skipped: ${skipped}
Weak topics: ${wrongTopics.join(', ') || 'None identified'}

Provide a structured analysis:
1. Overall Performance Summary
2. Strengths observed
3. Areas needing improvement
4. Specific study recommendations for weak topics
5. Motivational note

Max 400 words, plain text.`;
    const response = await callAI(prompt);
    content.textContent = response;
  } catch (e) {
    content.innerHTML = `<span style="color:var(--accent-red)">AI error: ${e.message}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
// RETAKE
// ═══════════════════════════════════════════════
function hasRetakeData() {
  try { return !!localStorage.getItem('medquiz_retake_questions'); }
  catch(e) { return false; }
}

function saveRetakeData(wrongResults) {
  localStorage.setItem('medquiz_retake_questions', JSON.stringify(wrongResults.map(r => r.q)));
}

function loadRetakeData() {
  const saved      = localStorage.getItem('medquiz_retake_questions');
  const retakeCard = document.getElementById('retakeModeCard');
  if (saved && retakeCard) retakeCard.style.display = 'block';
}

function startRetake() {
  const saved = localStorage.getItem('medquiz_retake_questions');
  if (!saved) { showToast('No retake data available. Complete a quiz first.'); return; }
  questions = JSON.parse(saved);
  if (!questions.length) { showToast('No wrong questions to retake.'); return; }
  showToast(`Retake Mode: ${questions.length} questions from previous session.`);
  localStorage.removeItem('medquiz_retake_questions');
  const retakeCard = document.getElementById('retakeModeCard');
  if (retakeCard) retakeCard.style.display = 'none';
  useNegativeMarking = false;
  localStorage.setItem('mq_questions',          JSON.stringify(questions));
  localStorage.setItem('mq_mode',               'exam');
  localStorage.setItem('mq_timePerQuestion',    timePerQuestion || 90);
  localStorage.setItem('mq_useNegativeMarking', false);
  window.location.href = 'exam.html';
}

function retakeWrong() {
  const wrong = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
  if (wrong.length === 0) { showToast('No wrong questions to retake.'); return; }
  questions = wrong;
  showToast(`Retaking ${wrong.length} wrong/skipped questions.`);
  useNegativeMarking = false;
  localStorage.setItem('mq_questions',          JSON.stringify(wrong));
  localStorage.setItem('mq_mode',               'exam');
  localStorage.setItem('mq_timePerQuestion',    timePerQuestion || 90);
  localStorage.setItem('mq_useNegativeMarking', false);
  window.location.href = 'exam.html';
}

// ═══════════════════════════════════════════════
// FLASHCARDS
// ═══════════════════════════════════════════════
function openFlashcards() {
  if (flashcardDeck.length === 0)
    flashcardDeck = allResults.filter(r => !r.correct || !r.userAnswer).map(r => r.q);
  if (flashcardDeck.length === 0) { showToast('No flashcards to review.'); return; }
  flashcardIdx = 0;
  const overlay = document.getElementById('flashcardOverlay');
  const card    = document.getElementById('flashcard');
  if (overlay) overlay.classList.add('show');
  if (card)    card.classList.remove('flipped');
  renderFlashcard();
}

function renderFlashcard() {
  const q       = flashcardDeck[flashcardIdx];
  const fcFront = document.getElementById('fcFront');
  const fcBack  = document.getElementById('fcBack');
  const counter = document.getElementById('fcCounter');
  const card    = document.getElementById('flashcard');
  if (fcFront) fcFront.textContent = q.question;
  if (fcBack)  fcBack.innerHTML    = `<strong>Answer:</strong> ${q.correct_option}<br><br>${q.explanation || ''}`;
  if (counter) counter.textContent = `${flashcardIdx + 1}/${flashcardDeck.length}`;
  if (card)    card.classList.remove('flipped');
}

function flipFlashcard() {
  const card = document.getElementById('flashcard');
  if (card) card.classList.toggle('flipped');
}
function nextFlashcard() { if (flashcardIdx < flashcardDeck.length - 1) { flashcardIdx++; renderFlashcard(); } }
function prevFlashcard() { if (flashcardIdx > 0) { flashcardIdx--; renderFlashcard(); } }
function closeFlashcards() {
  const overlay = document.getElementById('flashcardOverlay');
  if (overlay) overlay.classList.remove('show');
}

// ═══════════════════════════════════════════════
// DOWNLOAD RESULTS
// ═══════════════════════════════════════════════
function downloadResults() {
  const allAIResponses = [];
  document.querySelectorAll('.review-ai-response-body').forEach((el, i) => {
    if (el.textContent && !el.textContent.includes('Analyzing'))
      allAIResponses.push({ idx: i, text: el.textContent });
  });

  const resultsScreen = document.getElementById('resultsScreen');
  if (!resultsScreen) return;
  const content  = resultsScreen.innerHTML;
  const styleTag = document.querySelector('link[href="css/style.css"]');
  const style    = styleTag ? styleTag.outerHTML : '';

  let aiSection = '';
  if (allAIResponses.length > 0) {
    aiSection = '<div style="page-break-before:always"><h2>AI Explanations</h2>'
      + allAIResponses.map(r =>
          `<div style="margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:8px">
            <strong>Q${r.idx + 1}:</strong>
            <div style="margin-top:6px">${r.text}</div>
           </div>`).join('')
      + '</div>';
  }

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>MedQuiz Pro — Report</title>${style}
    </head><body>
    <div id="resultsScreen" class="screen active"
      style="display:flex;flex-direction:column;min-height:100vh">${content}</div>
    ${aiSection}</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `MedQuiz_Report_${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded.');
}

// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════
function confirmGoHome() {
  const examScreen  = document.getElementById('examScreen');
  const studyScreen = document.getElementById('studyScreen');
  if (examScreen?.classList.contains('active') || studyScreen?.classList.contains('active')) {
    openModal('confirmHomeModal');
  } else {
    goHome();
  }
}

function goHome() {
  clearInterval(timerInterval);
  isPaused = false;
  const pauseOverlay = document.getElementById('pauseOverlay');
  if (pauseOverlay) pauseOverlay.classList.remove('show');
  window.location.href = 'index.html';
}

// ═══════════════════════════════════════════════
// PAGE INITIALIZATION
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── Theme ──
  const savedTheme = localStorage.getItem('medquiz_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.body.classList.remove('light');
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  updateThemeIcon();

  // ── Initialize Add To Home Screen PWA ──
  initPWA();

  // ── Clean up old API Keys from Storage ──
  const savedConfig = localStorage.getItem('medquiz_ai_config');
  if (savedConfig) {
    try { 
      const loaded = JSON.parse(savedConfig); 
      // Force it to pollinations to overwrite any old Gemini selections
      aiConfig = { provider: 'pollinations', pollinationsModel: loaded.pollinationsModel || 'openai' }; 
      localStorage.setItem('medquiz_ai_config', JSON.stringify(aiConfig));
    } catch(e) {}
  }
  
  const providerSelect          = document.getElementById('providerSelect');
  const pollinationsModelSelect = document.getElementById('pollinationsModelSelect');
  
  if (providerSelect)          providerSelect.value          = 'pollinations';
  if (pollinationsModelSelect) pollinationsModelSelect.value = aiConfig.pollinationsModel;
  
  onProviderChange();
  updateAIStatus();

  // ── Expose globals for index.html toggles ──
  if (typeof window._shuffleQuestions === 'undefined') window._shuffleQuestions = false;
  if (typeof window._shuffleOptions   === 'undefined') window._shuffleOptions   = false;
  if (typeof window._questionTarget   === 'undefined') window._questionTarget   = null;

  // ── Page Detection ──
  const isHome    = !!document.getElementById('homeScreen');
  const isExam    = !!document.getElementById('examScreen');
  const isStudy   = !!document.getElementById('studyScreen');
  const isResults = !!document.getElementById('resultsScreen');

  // ── HOME ──
  if (isHome) {
    loadDailyGoal();
    loadRetakeData();
    renderHeatmap();
    setupOCRZone();
    const homeScreen = document.getElementById('homeScreen');
    if (homeScreen) homeScreen.classList.add('active');
    const configSection = document.getElementById('quizConfigSection');
    if (configSection) {
      configSection.style.removeProperty('display');
      if (questions.length === 0) configSection.classList.remove('revealed');
    }
  }

  // ── EXAM ──
  else if (isExam) {
    const qData = localStorage.getItem('mq_questions');
    if (!qData) { window.location.href = 'index.html'; return; }
    questions          = JSON.parse(qData);
    timePerQuestion    = parseInt(localStorage.getItem('mq_timePerQuestion')) || 90;
    useNegativeMarking = localStorage.getItem('mq_useNegativeMarking') === 'true';
    quizMode           = 'exam';
    startExam();
  }

  // ── STUDY ──
  else if (isStudy) {
    const qData = localStorage.getItem('mq_questions');
    if (!qData) { window.location.href = 'index.html'; return; }
    questions = JSON.parse(qData);
    quizMode  = 'study';
    startStudy();
  }

  // ── RESULTS ──
  else if (isResults) {
    showResults();
  }

  // ── Keyboard Shortcuts (Exam only) ──
  if (isExam) {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (isPaused) return;
      if      (e.key === 'ArrowLeft')         examNavigate(-1);
      else if (e.key === 'ArrowRight')        examNavigate(1);
      else if (e.key.toLowerCase() === 'f')  toggleFlag();
      else if (e.key === ' ')                 { e.preventDefault(); togglePause(); }
      else if (['1','2','3','4'].includes(e.key)) {
        const idx  = parseInt(e.key) - 1;
        const opts = document.querySelectorAll('#examOptionsList .option-item');
        if (opts[idx]) opts[idx].click();
      }
    });
  }

  // ── Service Worker ──
  if ('serviceWorker' in navigator) {
    const swCode = `
      self.addEventListener('install', e => self.skipWaiting());
      self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', e => {
        e.respondWith(
          caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
            const clone = resp.clone();
            caches.open('medquiz-v1').then(c => c.put(e.request, clone));
            return resp;
          }).catch(() => caches.match(e.request)))
        );
      });`;
    const blob  = new Blob([swCode], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }
});
