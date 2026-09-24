/**
 * Web UI server for the Voice Memo Transcriber.
 *
 * Serves public/index.html and exposes POST /api/transcribe, which saves an
 * uploaded audio file and runs the exact same on-device QVAC flow as the CLI
 * (loadModel -> transcribe -> unloadModel, see transcribe.js).
 *
 * Start with: npm run web   (then open http://localhost:3000)
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { transcribeAudioFile } from './transcribe.js';

const requestedPort = Number.parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535
  ? requestedPort
  : 3000;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const UPLOADS_DIR = join(ROOT, '.uploads');
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
  const ext = extname(filePath);
  const body = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  res.end(body);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleTranscribe(req, res) {
  const audioBuffer = await readRequestBody(req, MAX_UPLOAD_BYTES);
  if (audioBuffer.length === 0) {
    sendJson(res, 400, { error: 'No audio received.' });
    return;
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  const uploadPath = join(UPLOADS_DIR, `${randomUUID()}.wav`);
  await writeFile(uploadPath, audioBuffer);

  console.log(`▸ Web request: transcribing ${uploadPath} (${audioBuffer.length} bytes)...`);
  try {
    // Same on-device QVAC flow as the CLI (loadModel -> transcribe -> unloadModel).
    const text = await transcribeAudioFile(uploadPath);
    sendJson(res, 200, { text });
  } catch (error) {
    console.error('✖ Web transcription failed:', error);
    sendJson(res, 500, { error: error?.message || 'Transcription failed.' });
  } finally {
    await rm(uploadPath, { force: true });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/transcribe') {
    try {
      await handleTranscribe(req, res);
    } catch (error) {
      sendJson(res, 500, { error: error?.message || 'Server error.' });
    }
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = resolve(PUBLIC_DIR, '.' + urlPath);
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    serveStatic(res, safePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`▸ Voice Memo Transcriber web UI running at http://localhost:${PORT}`);
  console.log('▸ Open that address in your browser to record or upload audio.');
});
