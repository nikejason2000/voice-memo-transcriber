/**
 * Frontend logic for the Voice Memo Transcriber web UI.
 *
 * Live recording uses the browser's MediaRecorder API. The raw webm/ogg
 * recording is decoded and converted to a 16 kHz mono PCM WAV in the browser
 * (Web Audio API), so the server always receives plain WAV and no extra
 * tools (e.g. ffmpeg) are needed on the machine.
 */

const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const recIndicator = document.getElementById('rec-indicator');
const timerEl = document.getElementById('timer');
const transportHint = document.getElementById('transport-hint');
const dropZone = document.getElementById('drop-zone');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const fileNameEl = document.getElementById('file-name');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const errorEl = document.getElementById('error');
const resultPanel = document.getElementById('result-panel');
const transcriptEl = document.getElementById('transcript');
const copyBtn = document.getElementById('copy-btn');

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let timerInterval = null;
let secondsElapsed = 0;

function setStatus(message) {
  statusTextEl.textContent = message;
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.hidden = true;
  errorEl.hidden = true;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  statusEl.hidden = true;
}

function showTranscript(text) {
  transcriptEl.textContent = text;
  resultPanel.hidden = false;
}

// ---- Audio conversion: any decoded audio -> 16 kHz mono WAV ----

function audioBufferToWav(buffer, targetRate = 16000) {
  // Mix down to mono by averaging all channels.
  const numInChannels = buffer.numberOfChannels;
  const monoLength = buffer.length;
  const mono = new Float32Array(monoLength);
  for (let ch = 0; ch < numInChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < monoLength; i++) mono[i] += channelData[i] / numInChannels;
  }

  // Resample linearly to the target rate.
  const ratio = buffer.sampleRate / targetRate;
  const outLength = Math.round(monoLength / ratio);
  const resampled = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = mono[idx] ?? mono[monoLength - 1] ?? 0;
    const b = mono[idx + 1] ?? a;
    resampled[i] = a + (b - a) * frac;
  }

  // Encode 16-bit PCM WAV.
  const bytesPerSample = 2;
  const dataSize = resampled.length * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);         // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < resampled.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

async function blobToWav16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return audioBufferToWav(decoded, 16000);
  } finally {
    ctx.close();
  }
}

/**
 * POST the WAV to the backend. If the browser pulled a pooled keep-alive
 * socket that the server closed while a previous transcription was running
 * (Chrome reports this as "Failed to fetch" without the request ever
 * reaching the server), retry exactly once on a fresh connection.
 */
async function postAudio(wav) {
  try {
    return await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      return await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      });
    }
    throw err;
  }
}

async function transcribeBlob(blob) {
  clearStatus();
  setStatus('Converting audio and sending to the on-device model…');
  transcriptEl.textContent = '';
  resultPanel.hidden = true;
  try {
    const wav = await blobToWav16k(blob);
    const response = await postAudio(wav);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
    clearStatus();
    showTranscript(data.text || '(empty transcript)');
  } catch (err) {
    clearStatus();
    const msg = err.message || 'Transcription failed.';
    showError(
      msg === 'Failed to fetch'
        ? 'Could not reach the transcription server. Is “npm run web” still running?'
        : msg
    );
  }
}

// ---- Live microphone recording ----

async function startRecording() {
  clearStatus();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showError('Microphone access was denied or unavailable: ' + err.message);
    return;
  }

  const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  audioChunks = [];
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  };
  mediaRecorder.onstop = async () => {
    mediaStream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    await transcribeBlob(blob);
  };
  mediaRecorder.start();

  recordBtn.hidden = true;
  stopBtn.hidden = false;
  recIndicator.hidden = false;
  transportHint.textContent = 'Recording… press the stop button when finished';
  secondsElapsed = 0;
  timerEl.textContent = '00:00';
  timerInterval = setInterval(() => {
    secondsElapsed += 1;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  clearInterval(timerInterval);
  recordBtn.hidden = false;
  stopBtn.hidden = true;
  recIndicator.hidden = true;
  transportHint.textContent = 'Press to record — transcription starts when you stop';
}

// ---- File upload (browse or drag & drop) ----

function openFilePicker() {
  fileInput.click();
}

function handleFileSelected() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  fileNameEl.textContent = file.name;
  transcribeBlob(file);
}

dropZone.addEventListener('click', openFilePicker);
uploadBtn.addEventListener('click', (event) => {
  event.stopPropagation(); // dropzone click would otherwise fire too
  openFilePicker();
});
fileInput.addEventListener('change', handleFileSelected);

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFilePicker();
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  fileNameEl.textContent = file.name;
  transcribeBlob(file);
});

// ---- Copy transcript ----

copyBtn.addEventListener('click', async () => {
  const text = transcriptEl.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied ✓';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
});

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
