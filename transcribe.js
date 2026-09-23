#!/usr/bin/env node
/**
 * Voice Memo Transcriber — on-device speech-to-text CLI.
 *
 * Transcribes an audio file (16 kHz mono WAV recommended) entirely on-device
 * using the QVAC SDK. No cloud calls, no API keys, no audio ever leaves the
 * machine.
 *
 * Usage:
 *   node transcribe.js [path/to/audio.wav]
 *
 * QVAC calls used: loadModel(), transcribe(), unloadModel().
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadModel, transcribe, unloadModel, WHISPER_TINY } from '@qvac/sdk';

const DEFAULT_AUDIO = 'sample-audio/memo.wav';

function resolveAudioPath() {
  const input = process.argv[2] ?? DEFAULT_AUDIO;
  const absolute = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (!existsSync(absolute)) {
    console.error(`✖ Audio file not found: ${absolute}`);
    console.error(`  Usage: node transcribe.js [path/to/audio.wav]`);
    process.exit(1);
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

async function main() {
  const audioPath = resolveAudioPath();

  // 1. Load the speech-to-text model into memory on this device.
  //    First run downloads it (~78 MB) via the QVAC model registry; after
  //    that it is served from the local cache.
  console.log('▸ Loading Whisper model on-device (first run downloads ~78 MB)...');
  const modelId = await loadModel({
    modelSrc: WHISPER_TINY,
    onProgress: printDownloadProgress,
  });
  console.log('▸ Model ready.');

  // 2. Transcribe the audio locally.
  console.log(`▸ Transcribing ${audioPath} ...`);
  const text = await transcribe({ modelId, audioChunk: audioPath });

  console.log('\n─── TRANSCRIPT ───');
  console.log(text.trim());
  console.log('─────────────────\n');

  // 3. Release the model.
  await unloadModel({ modelId });
  console.log('▸ Model unloaded. Done.');
}

main().catch((error) => {
  console.error('✖ Transcription failed:', error);
  process.exit(1);
});
