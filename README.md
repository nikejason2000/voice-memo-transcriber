# Voice Memo Transcriber

Transcribes voice memos to text **entirely on-device** using Tether's QVAC SDK — no cloud services, no API keys, and your audio never leaves your machine.

Two ways to use it: a **web UI** (record live from your microphone or upload a file) or a simple **CLI**.

## Requirements

- [Node.js](https://nodejs.org) **22.17 or newer** (required by the QVAC SDK)
- Windows, macOS, or Linux (on Windows, Vulkan ≥ 1.4 must be available — typically installed with your GPU drivers)

## Install

```bash
npm install
```

## Web UI — record live or upload

Start the server:

```bash
npm run web
```

Then open **http://localhost:3000** in your browser.

- **Record live:** press the big amber button (the browser asks for microphone permission), speak, then press it again to stop. A blinking **REC** indicator and timer show that recording is in progress. The recording is transcribed automatically and appears in the transcript panel (with a one-click **Copy**).
- **Upload a file:** **drop an audio file** onto the drop zone or click **browse** (16 kHz mono WAV works best).

While transcription runs, a spinner shows progress. Recordings are converted to 16 kHz mono WAV directly in your browser, so the on-device model always receives WAV — no extra tools like ffmpeg are required. All transcription still happens locally via QVAC; the browser only talks to your own machine.

## CLI — transcribe a file

With the included sample memo:

```bash
node transcribe.js sample-audio/memo.wav
```

Or with your own recording (16 kHz mono WAV works best):

```bash
node transcribe.js path/to/your-memo.wav
```

Running with no argument transcribes the bundled sample by default:

```bash
node transcribe.js
```

The first run downloads the Whisper model (~78 MB) through the QVAC model registry; after that it is cached locally and inference runs fully offline.

## QVAC SDK

- **SDK version used:** `@qvac/sdk` **0.20.0** (see `package.json`)
- **QVAC functions called:**
  - `loadModel()` — loads the on-device speech-to-text model (`WHISPER_TINY`) into memory
  - `transcribe()` — runs speech-to-text locally on the audio file and returns the transcript
  - `unloadModel()` — frees the model from memory when done

## License

[MIT](LICENSE)
