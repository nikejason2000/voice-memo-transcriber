#!/usr/bin/env node
/**
 * Voice Memo Transcriber — on-device speech-to-text via the QVAC SDK.
 *
 * QVAC calls used: loadModel(), transcribe(), unloadModel().
 *
 * Two ways to run:
 *   1. CLI:      node transcribe.js [path/to/audio.wav]
 *   2. Library:  import { transcribeAudioFile } from './transcribe.js'
 *                (used by server.js for the web UI)
 *
 * All inference runs on-device. No cloud calls, no API keys.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadModel, transcribe, unloadModel, WHISPER_TINY } from '@qvac/sdk';

const DEFAULT_AUDIO = 'sample-audio/memo.wav';

function resolveAudioPath(input) {
  const absolute = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (!existsSync(absolute)) {
    throw new Error(`Audio file not found: ${absolute}`);
  }
  return absolute;
}

function printDownloadProgress(progress) {
  const mb = (n) => (n / 1e6).toFixed(1);
  const line = `  downloading model ${progress.percentage.toFixed(0)}% (${mb(progress.downloaded)}/${mb(progress.total)} MB)`;
  process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`);
  if (progress.percentage >= 100 && process.stderr.isTTY) {
    process.stderr.write('\n');
  }
}

/**
 * Transcribe one audio file entirely on-device.
 *
 * QVAC flow (unchanged): loadModel() -> transcribe() -> unloadModel().
 * Returns the transcript text.
 */
export async function transcribeAudioFile(audioPath) {
  const absolutePath = resolveAudioPath(audioPath);

  // 1. Load the speech-to-text model into memory on this device.
  //    First run downloads it (~78 MB) via the QVAC model registry; after
  //    that it is served from the local cache.
  console.log('▸ Loading Whisper model on-device (first run downloads ~78 MB)...');
  const modelId = await loadModel({
    modelSrc: WHISPER_TINY,
    onProgress: printDownloadProgress,
  });
  console.log('▸ Model ready.');

  try {
    // 2. Transcribe the audio locally.
    console.log(`▸ Transcribing ${absolutePath} ...`);
    const text = await transcribe({ modelId, audioChunk: absolutePath });
    return text.trim();
  } finally {
    // 3. Release the model.
    await unloadModel({ modelId });
    console.log('▸ Model unloaded.');
  }
}

// --- CLI entry point (skipped when imported by server.js) ---
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const input = process.argv[2] ?? DEFAULT_AUDIO;
  transcribeAudioFile(input)
    .then((text) => {
      console.log('\n─── TRANSCRIPT ───');
      console.log(text);
      console.log('─────────────────\n');
    })
    .catch((error) => {
      console.error('✖ Transcription failed:', error);
      process.exit(1);
    });
}
