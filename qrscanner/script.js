'use strict';

/* ==========================================================================
   Constants
   ========================================================================== */

const STORAGE_KEYS = {
  history: 'scanlux.history',
  settings: 'scanlux.settings',
};

const MAX_HISTORY_ITEMS = 300;
const RESUME_DELAY_MS = 900;

const FORMAT_LABELS = {
  QR_CODE: 'QR Code',
  CODE_128: 'Code 128',
  CODE_39: 'Code 39',
  CODE_93: 'Code 93',
  EAN_13: 'EAN-13',
  EAN_8: 'EAN-8',
  UPC_A: 'UPC-A',
  UPC_E: 'UPC-E',
  ITF: 'ITF',
  CODABAR: 'Codabar',
  DATA_MATRIX: 'Data Matrix',
  PDF_417: 'PDF417',
  AZTEC: 'Aztec',
  MAXICODE: 'MaxiCode',
  RSS_14: 'RSS-14',
  RSS_EXPANDED: 'RSS Expanded',
  UPC_EAN_EXTENSION: 'UPC/EAN Extension',
};

const DEFAULT_SETTINGS = {
  sound: true,
  vibration: true,
  theme: 'dark',
};

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  page: 'scanner',
  settings: DEFAULT_SETTINGS,
  history: [],
  codeReader: null,
  currentStream: null,
  devices: [],
  deviceIndex: 0,
  torchOn: false,
  torchSupported: false,
  isPaused: false,
  cameraActive: false,
  zxingAvailable: typeof window.ZXing !== 'undefined',
  audioCtx: null,
  pendingEntry: null,
  toastTimer: null,
};

/* ==========================================================================
   DOM references
   ========================================================================== */

const els = {
  video: document.getElementById('video'),
  scanOverlay: document.getElementById('scanOverlay'),
  scanFrame: document.getElementById('scanFrame'),
  scanStatus: document.getElementById('scanStatus'),

  cameraState: document.getElementById('cameraState'),
  cameraStateIcon: document.getElementById('cameraStateIcon'),
  cameraStateTitle: document.getElementById('cameraStateTitle'),
  cameraStateText: document.getElementById('cameraStateText'),
  retryCameraBtn: document.getElementById('retryCameraBtn'),

  galleryBtn: document.getElementById('galleryBtn'),
  galleryInput: document.getElementById('galleryInput'),
  switchCameraBtn: document.getElementById('switchCameraBtn'),
  torchBtn: document.getElementById('torchBtn'),

  topbarTitle: document.getElementById('topbarTitle'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),

  pages: document.querySelectorAll('.page'),
  navButtons: document.querySelectorAll('.nav-btn'),

  historyList: document.getElementById('historyList'),
  historyEmpty: document.getElementById('historyEmpty'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  historyIconTpl: document.getElementById('historyIconTpl'),
  historyDeleteIconTpl: document.getElementById('historyDeleteIconTpl'),

  soundToggle: document.getElementById('soundToggle'),
  vibrationToggle: document.getElementById('vibrationToggle'),
  themeOptions: document.querySelectorAll('.theme-option'),
  clearAllDataBtn: document.getElementById('clearAllDataBtn'),

  sheetOverlay: document.getElementById('sheetOverlay'),
  sheet: document.getElementById('sheet'),
  resultFormat: document.getElementById('resultFormat'),
  resultTime: document.getElementById('resultTime'),
  resultValue: document.getElementById('resultValue'),
  copyBtn: document.getElementById('copyBtn'),
  openLinkBtn: document.getElementById('openLinkBtn'),
  closeSheetBtn: document.getElementById('closeSheetBtn'),

  toast: document.getElementById('toast'),
};

/* ==========================================================================
   Utilities
   ========================================================================== */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    console.warn('Gagal membaca localStorage untuk', key, err);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Gagal menyimpan localStorage untuk', key, err);
    showToast('Penyimpanan gagal, memori penuh.');
    return false;
  }
}

function isValidUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function formatClock(date) {
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatFullTimestamp(date) {
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function friendlyFormatName(zxingFormatName) {
  if (!zxingFormatName) return 'Tidak diketahui';
  return FORMAT_LABELS[zxingFormatName] || zxingFormatName.replace(/_/g, ' ');
}

/* ==========================================================================
   Toast
   ========================================================================== */

function showToast(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 250);
  }, 2600);
}

/* ==========================================================================
   Settings
   ========================================================================== */

function loadSettings() {
  const saved = loadJSON(STORAGE_KEYS.settings, null);
  return Object.assign({}, DEFAULT_SETTINGS, saved || {});
}

function persistSettings() {
  saveJSON(STORAGE_KEYS.settings, state.settings);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef0f9' : '#08070d');
}

function renderSettingsUI() {
  els.soundToggle.classList.toggle('on', state.settings.sound);
  els.soundToggle.setAttribute('aria-checked', String(state.settings.sound));

  els.vibrationToggle.classList.toggle('on', state.settings.vibration);
  els.vibrationToggle.setAttribute('aria-checked', String(state.settings.vibration));

  els.themeOptions.forEach((btn) => {
    const isActive = btn.dataset.themeValue === state.settings.theme;
    btn.setAttribute('aria-pressed', String(isActive));
  });

  applyTheme(state.settings.theme);
}

function toggleSetting(key) {
  state.settings[key] = !state.settings[key];
  persistSettings();
  renderSettingsUI();
}

function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  state.settings.theme = theme;
  persistSettings();
  renderSettingsUI();
}

/* ==========================================================================
   History
   ========================================================================== */

function loadHistory() {
  const saved = loadJSON(STORAGE_KEYS.history, []);
  return Array.isArray(saved) ? saved : [];
}

function persistHistory() {
  saveJSON(STORAGE_KEYS.history, state.history);
}

function addHistoryEntry(entry) {
  state.history.unshift(entry);
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history.length = MAX_HISTORY_ITEMS;
  }
  persistHistory();
  renderHistory();
}

function deleteHistoryEntry(id) {
  state.history = state.history.filter((item) => item.id !== id);
  persistHistory();
  renderHistory();
}

function clearHistory() {
  state.history = [];
  persistHistory();
  renderHistory();
}

function renderHistory() {
  els.historyList.innerHTML = '';

  if (state.history.length === 0) {
    els.historyEmpty.hidden = false;
    els.clearHistoryBtn.hidden = true;
    return;
  }

  els.historyEmpty.hidden = true;
  els.clearHistoryBtn.hidden = false;

  const fragment = document.createDocumentFragment();

  state.history.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'history-icon';
    iconWrap.appendChild(els.historyIconTpl.content.cloneNode(true));

    const body = document.createElement('div');
    body.className = 'history-body';

    const formatEl = document.createElement('span');
    formatEl.className = 'history-format';
    formatEl.textContent = item.formatLabel;

    const valueEl = document.createElement('span');
    valueEl.className = 'history-value';
    valueEl.textContent = item.value;

    const timeEl = document.createElement('span');
    timeEl.className = 'history-time';
    timeEl.textContent = formatFullTimestamp(new Date(item.timestamp));

    body.appendChild(formatEl);
    body.appendChild(valueEl);
    body.appendChild(timeEl);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'history-delete';
    deleteBtn.setAttribute('aria-label', 'Hapus item riwayat ini');
    deleteBtn.appendChild(els.historyDeleteIconTpl.content.cloneNode(true));
    deleteBtn.addEventListener('click', () => deleteHistoryEntry(item.id));

    card.addEventListener('click', (evt) => {
      if (evt.target.closest('.history-delete')) return;
      openResultSheet(item, { fromHistory: true });
    });

    card.appendChild(iconWrap);
    card.appendChild(body);
    card.appendChild(deleteBtn);
    fragment.appendChild(card);
  });

  els.historyList.appendChild(fragment);
}

/* ==========================================================================
   Sound + Vibration feedback
   ========================================================================== */

function getAudioContext() {
  if (state.audioCtx) return state.audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  state.audioCtx = new Ctx();
  return state.audioCtx;
}

function playBeep() {
  if (!state.settings.sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1046.5, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.2);
}

function doVibrate() {
  if (!state.settings.vibration) return;
  if (navigator.vibrate) {
    navigator.vibrate(160);
  }
}

/* ==========================================================================
   Navigation
   ========================================================================== */

const PAGE_TITLES = {
  scanner: 'Scanner',
  history: 'Riwayat',
  settings: 'Pengaturan',
};

function navigateTo(page) {
  if (page === state.page) return;
  const leavingScanner = state.page === 'scanner';
  const enteringScanner = page === 'scanner';

  state.page = page;
  els.topbarTitle.textContent = PAGE_TITLES[page];

  els.pages.forEach((section) => {
    section.classList.toggle('active', section.id === `page-${page}`);
  });

  els.navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (leavingScanner && !enteringScanner) {
    stopCamera();
  } else if (enteringScanner && !state.cameraActive) {
    initCamera();
  }
}

/* ==========================================================================
   Camera / ZXing scanning
   ========================================================================== */

function showCameraState(title, text, iconType) {
  els.cameraState.hidden = false;
  els.scanOverlay.style.display = 'none';
  els.cameraStateTitle.textContent = title;
  els.cameraStateText.textContent = text;
  els.cameraStateIcon.classList.toggle('is-warning', iconType === 'warning');
}

function hideCameraState() {
  els.cameraState.hidden = true;
  els.scanOverlay.style.display = '';
}

function describeGetUserMediaError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    const insecureHint = window.isSecureContext === false
      ? ' Halaman ini juga tidak diakses lewat HTTPS/localhost, yang membuat browser otomatis menolak akses kamera.'
      : ' Jika sebelumnya Anda menekan "Block", buka pengaturan situs (ikon gembok di address bar) → Camera → ubah ke "Allow", lalu muat ulang halaman.';
    return {
      title: 'Izin kamera ditolak',
      text: 'Aktifkan izin kamera untuk situs ini melalui pengaturan browser Anda, lalu coba lagi.' + insecureHint,
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: 'Kamera tidak ditemukan',
      text: 'Perangkat ini tidak memiliki kamera yang dapat diakses. Anda tetap bisa memindai dari galeri.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: 'Kamera sedang digunakan',
      text: 'Kamera mungkin sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.',
    };
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return {
      title: 'Kamera tidak kompatibel',
      text: 'Konfigurasi kamera yang diminta tidak didukung perangkat ini.',
    };
  }
  if (name === 'SecurityError') {
    return {
      title: 'Akses diblokir',
      text: 'Kamera hanya dapat diakses melalui koneksi HTTPS yang aman.',
    };
  }
  return {
    title: 'Kamera bermasalah',
    text: 'Terjadi kesalahan tak terduga saat mengakses kamera. Coba lagi.',
  };
}

async function initCamera() {
  hideCameraState();

  if (!state.zxingAvailable) {
    showCameraState(
      'Pustaka scanner gagal dimuat',
      'Periksa koneksi internet Anda lalu muat ulang halaman ini. Anda tetap bisa memindai dari galeri.',
      'warning'
    );
    return;
  }

  if (window.isSecureContext === false) {
    showCameraState(
      'Perlu koneksi aman (HTTPS)',
      'Kamera browser hanya bisa diakses lewat https:// atau http://localhost. Jika file ini dibuka langsung (file://) atau lewat alamat IP tanpa HTTPS, jalankan server lokal dulu, misalnya "python3 -m http.server", lalu buka melalui http://localhost:PORT.',
      'warning'
    );
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraState(
      'Browser tidak mendukung kamera',
      'Gunakan browser modern seperti Chrome, Safari, atau Edge terbaru. Anda tetap bisa memindai dari galeri.',
      'warning'
    );
    return;
  }

  els.scanStatus.textContent = 'Meminta izin kamera…';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    console.error('getUserMedia error', err);
    const info = describeGetUserMediaError(err);
    showCameraState(info.title, info.text, 'warning');
    return;
  }

  // Enumerate only now that permission is granted, so device labels are available.
  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    state.devices = allDevices.filter((d) => d.kind === 'videoinput');
  } catch (err) {
    console.warn('enumerateDevices error', err);
    state.devices = [];
  }

  const activeTrack = stream.getVideoTracks()[0];
  const activeDeviceId = activeTrack && typeof activeTrack.getSettings === 'function'
    ? activeTrack.getSettings().deviceId
    : undefined;
  const matchedIndex = state.devices.findIndex((d) => d.deviceId === activeDeviceId);
  state.deviceIndex = matchedIndex !== -1 ? matchedIndex : pickDefaultDeviceIndex(state.devices);

  els.switchCameraBtn.disabled = state.devices.length < 2;

  await startDecodingFromStream(stream);
}

function pickDefaultDeviceIndex(devices) {
  const backIndex = devices.findIndex((d) => /back|belakang|rear|environment/i.test(d.label));
  if (backIndex !== -1) return backIndex;
  return devices.length - 1 >= 0 ? devices.length - 1 : 0;
}

async function startDecodingFromStream(stream) {
  if (!state.codeReader) {
    const hints = new Map();
    hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
    state.codeReader = new window.ZXing.BrowserMultiFormatReader(hints);
  }

  state.currentStream = stream;
  els.scanStatus.textContent = 'Scanning…';
  state.isPaused = false;
  state.cameraActive = true;

  try {
    await state.codeReader.decodeFromStream(stream, els.video, (result, err) => {
      if (state.isPaused) return;

      if (result) {
        handleScanSuccess(result);
        return;
      }

      if (err && err.name !== 'NotFoundException' && err.name !== 'ChecksumException' && err.name !== 'FormatException') {
        console.warn('Decode error', err);
      }
    });

    setupTorchForCurrentStream(stream);
  } catch (err) {
    console.error('decodeFromStream error', err);
    state.cameraActive = false;
    stream.getTracks().forEach((track) => track.stop());
    state.currentStream = null;
    const info = describeGetUserMediaError(err);
    showCameraState(info.title, info.text, 'warning');
  }
}

function setupTorchForCurrentStream(stream) {
  state.torchSupported = false;
  els.torchBtn.hidden = true;
  els.torchBtn.classList.remove('is-on');
  state.torchOn = false;

  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return;

  try {
    const capabilities = track.getCapabilities();
    if (capabilities && capabilities.torch) {
      state.torchSupported = true;
      els.torchBtn.hidden = false;
    }
  } catch (err) {
    console.warn('getCapabilities tidak didukung', err);
  }
}

async function toggleTorch() {
  if (!state.torchSupported || !state.currentStream) return;
  const track = state.currentStream.getVideoTracks()[0];
  if (!track) return;

  const nextState = !state.torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: nextState }] });
    state.torchOn = nextState;
    els.torchBtn.classList.toggle('is-on', state.torchOn);
  } catch (err) {
    console.error('Gagal mengubah flashlight', err);
    showToast('Flashlight tidak dapat diaktifkan pada perangkat ini.');
  }
}

function stopCamera() {
  if (state.codeReader) {
    try {
      state.codeReader.reset();
    } catch (err) {
      console.warn('Gagal menghentikan decoder', err);
    }
  }
  if (state.currentStream) {
    state.currentStream.getTracks().forEach((track) => track.stop());
    state.currentStream = null;
  }
  state.cameraActive = false;
  state.torchOn = false;
  state.torchSupported = false;
  els.torchBtn.hidden = true;
}

async function switchCamera() {
  if (state.devices.length < 2 || !state.cameraActive) return;

  const nextIndex = (state.deviceIndex + 1) % state.devices.length;
  const nextDeviceId = state.devices[nextIndex].deviceId;

  els.scanStatus.textContent = 'Mengganti kamera…';

  if (state.codeReader) {
    try {
      state.codeReader.reset();
    } catch (err) {
      console.warn(err);
    }
  }
  if (state.currentStream) {
    state.currentStream.getTracks().forEach((track) => track.stop());
    state.currentStream = null;
  }

  let newStream;
  try {
    newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: nextDeviceId } },
      audio: false,
    });
  } catch (err) {
    console.error('Gagal ganti kamera', err);
    const info = describeGetUserMediaError(err);
    showCameraState(info.title, info.text, 'warning');
    state.cameraActive = false;
    return;
  }

  state.deviceIndex = nextIndex;
  await startDecodingFromStream(newStream);
}

function pauseScanning() {
  state.isPaused = true;
}

function resumeScanning() {
  setTimeout(() => {
    state.isPaused = false;
    els.scanFrame.classList.remove('detected');
    els.scanStatus.textContent = 'Scanning…';
  }, RESUME_DELAY_MS);
}

/* ==========================================================================
   Scan result handling
   ========================================================================== */

function handleScanSuccess(result) {
  pauseScanning();
  els.scanFrame.classList.add('detected');
  els.scanStatus.textContent = 'Kode terdeteksi!';

  let formatName = 'UNKNOWN';
  try {
    const formatValue = result.getBarcodeFormat();
    formatName = window.ZXing.BarcodeFormat[formatValue] || 'UNKNOWN';
  } catch (err) {
    console.warn('Tidak dapat membaca format barcode', err);
  }

  const entry = {
    id: generateId(),
    format: formatName,
    formatLabel: friendlyFormatName(formatName),
    value: result.getText(),
    timestamp: new Date().toISOString(),
  };

  playBeep();
  doVibrate();
  addHistoryEntry(entry);
  openResultSheet(entry, { fromHistory: false });
}

async function handleGalleryFile(file) {
  if (!file) return;

  if (!state.zxingAvailable) {
    showToast('Pustaka scanner belum siap. Muat ulang halaman.');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  showToast('Memindai gambar…');

  try {
    if (!state.codeReader) {
      const hints = new Map();
      hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
      state.codeReader = new window.ZXing.BrowserMultiFormatReader(hints);
    }

    const result = await state.codeReader.decodeFromImageUrl(objectUrl);

    let formatName = 'UNKNOWN';
    try {
      const formatValue = result.getBarcodeFormat();
      formatName = window.ZXing.BarcodeFormat[formatValue] || 'UNKNOWN';
    } catch (err) {
      console.warn(err);
    }

    const entry = {
      id: generateId(),
      format: formatName,
      formatLabel: friendlyFormatName(formatName),
      value: result.getText(),
      timestamp: new Date().toISOString(),
    };

    playBeep();
    doVibrate();
    addHistoryEntry(entry);
    openResultSheet(entry, { fromHistory: false });
  } catch (err) {
    console.warn('Tidak ada kode terdeteksi pada gambar', err);
    showToast('Tidak ada QR code / barcode yang terdeteksi pada gambar ini.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/* ==========================================================================
   Result bottom sheet
   ========================================================================== */

function openResultSheet(entry, opts) {
  const options = opts || {};
  state.pendingEntry = entry;

  els.resultFormat.textContent = entry.formatLabel;
  els.resultTime.textContent = formatFullTimestamp(new Date(entry.timestamp));
  els.resultValue.textContent = entry.value;

  const showLink = isValidUrl(entry.value);
  els.openLinkBtn.hidden = !showLink;
  els.closeSheetBtn.textContent = options.fromHistory ? 'Tutup' : 'Pindai Lagi';

  els.sheetOverlay.hidden = false;
  requestAnimationFrame(() => els.sheetOverlay.classList.add('show'));
}

function closeResultSheet() {
  els.sheetOverlay.classList.remove('show');
  setTimeout(() => {
    els.sheetOverlay.hidden = true;
  }, 320);

  if (state.page === 'scanner' && state.cameraActive) {
    resumeScanning();
  }
  state.pendingEntry = null;
}

async function copyResultValue() {
  if (!state.pendingEntry) return;
  const value = state.pendingEntry.value;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showToast('Hasil disalin ke clipboard.');
  } catch (err) {
    console.error('Copy gagal', err);
    showToast('Gagal menyalin hasil.');
  }
}

function openResultLink() {
  if (!state.pendingEntry) return;
  if (!isValidUrl(state.pendingEntry.value)) return;
  window.open(state.pendingEntry.value, '_blank', 'noopener,noreferrer');
}

/* ==========================================================================
   Init & event wiring
   ========================================================================== */

function wireEvents() {
  els.navButtons.forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  els.themeToggleBtn.addEventListener('click', () => {
    setTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
  });

  els.retryCameraBtn.addEventListener('click', () => initCamera());
  els.switchCameraBtn.addEventListener('click', () => switchCamera());
  els.torchBtn.addEventListener('click', () => toggleTorch());

  els.galleryBtn.addEventListener('click', () => els.galleryInput.click());
  els.galleryInput.addEventListener('change', (evt) => {
    const file = evt.target.files && evt.target.files[0];
    handleGalleryFile(file);
    evt.target.value = '';
  });

  els.clearHistoryBtn.addEventListener('click', () => {
    if (state.history.length === 0) return;
    const confirmed = window.confirm('Hapus seluruh riwayat pemindaian? Tindakan ini tidak dapat dibatalkan.');
    if (confirmed) {
      clearHistory();
      showToast('Riwayat berhasil dihapus.');
    }
  });

  els.soundToggle.addEventListener('click', () => toggleSetting('sound'));
  els.vibrationToggle.addEventListener('click', () => toggleSetting('vibration'));

  els.themeOptions.forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.themeValue));
  });

  els.clearAllDataBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Hapus semua riwayat dan kembalikan pengaturan ke default?');
    if (!confirmed) return;
    clearHistory();
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    persistSettings();
    renderSettingsUI();
    showToast('Semua data telah direset.');
  });

  els.copyBtn.addEventListener('click', () => copyResultValue());
  els.openLinkBtn.addEventListener('click', () => openResultLink());
  els.closeSheetBtn.addEventListener('click', () => closeResultSheet());
  els.sheetOverlay.addEventListener('click', (evt) => {
    if (evt.target === els.sheetOverlay) closeResultSheet();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.page === 'scanner') stopCamera();
    } else if (state.page === 'scanner' && !state.cameraActive) {
      initCamera();
    }
  });
}

function init() {
  state.settings = loadSettings();
  state.history = loadHistory();

  renderSettingsUI();
  renderHistory();
  wireEvents();
  initCamera();
}

document.addEventListener('DOMContentLoaded', init);
