# Development Cloud Backend

This server exists so Viral AI Tool Desktop can test the real account/session and Cloud Speech workflow before a production backend is deployed.

It is **development only** and is intentionally excluded from the Electron build files.

## Start the backend without Speech AI

Open terminal 1:

```powershell
cd C:\Users\haiho\Desktop\Viral_AI_Tool
npm run dev:backend
```

The server binds only to:

```text
127.0.0.1:3000
```

Development account:

```text
Email:    demo@viral-ai.local
Password: ViralAI123!
```

Without a provider API key, account/login works but Cloud Speech correctly reports that the backend AI provider is not configured.

## Enable real Cloud Speech in development

Do **not** paste an API key into the desktop app and do not commit it to Git.

In terminal 1, set the provider key only for that terminal session:

```powershell
cd C:\Users\haiho\Desktop\Viral_AI_Tool

$env:OPENAI_API_KEY="YOUR_PRIVATE_API_KEY"
$env:VIRAL_AI_SPEECH_PROVIDER="openai"
$env:VIRAL_AI_OPENAI_TRANSCRIBE_MODEL="whisper-1"
$env:VIRAL_AI_OPENAI_TRANSLATION_MODEL="gpt-5-mini"
$env:VIRAL_AI_VOICE_PROVIDER="openai"
$env:VIRAL_AI_OPENAI_TTS_MODEL="gpt-4o-mini-tts"

npm run dev:backend
```

Default model:

```text
whisper-1
```

The development backend uses this default because it can return segment timestamps needed by the subtitle workflow.

Optional provider model examples supported by the adapter can be selected with `VIRAL_AI_OPENAI_TRANSCRIBE_MODEL`. The product UI must not depend on the provider-specific model name.

The backend console should show:

```text
Cloud speech: READY
Speech model: whisper-1
Cloud translation: READY
Translation model: gpt-5-mini
Cloud voice: READY
Voice model: gpt-4o-mini-tts
```

Never send or paste a real provider API key into chat, screenshots, source files, issue descriptions, or commits.

## Start the desktop app

Open terminal 2:

```powershell
cd C:\Users\haiho\Desktop\Viral_AI_Tool
npm start
```

In the app:

1. Open **Cài đặt**.
2. Find **Nhà phát triển → Kết nối Viral AI Cloud**.
3. Choose **Development — máy chủ thử nghiệm**.
4. Set Backend URL to `http://127.0.0.1:3000`.
5. Save.
6. Test the connection.
7. Sign in with the development account.
8. Open **Video AI**.
9. Import a short video that contains speech.
10. Choose **Cloud**.
11. Choose the spoken language or automatic detection.
12. Start speech recognition.
13. Confirm the Cloud consent dialog.

Expected Cloud flow:

```text
Video
  -> local audio extraction
  -> FLAC
  -> authenticated job creation
  -> one-time upload token
  -> SHA-256 validation
  -> job commit
  -> provider transcription
  -> normalized transcript + timestamps
  -> desktop subtitle transcript
```

## Test Cloud translation

After Speech recognition returns a transcript:

1. Stay in **Video AI**.
2. Go to step **Dịch / Translate**.
3. Choose **Cloud**.
4. Choose a target language.
5. Keep or disable **Giữ cách nói tự nhiên / Preserve tone**.
6. Start translation.
7. Confirm that transcript text may be sent to Cloud.

The desktop sends transcript segments only in this step. It does not resend the original video or audio.

Expected flow:

```text
Timed transcript
  -> authenticated translation job
  -> idempotent job recovery
  -> batched provider translation
  -> segment ID validation
  -> original start/end restored
  -> translation result
  -> timing-risk hints
```

Development translation limits:

```text
Maximum segments:   300
Maximum characters: 60,000
Batch size:         30 segments
```

Changing the target language creates a new translation job. Retrying an interrupted translation for the same input reuses the original client job ID.

## Test AI Voice / TTS

After Cloud translation returns translated segments:

1. Stay in **Video AI**.
2. Go to step **Giọng AI / AI Voice**.
3. Choose **Cloud**.
4. For each detected speaker, choose one product voice.
5. Use **Nghe thử / Preview** to check the selected voice.
6. Start voice generation.
7. Confirm that translated text may be sent to Cloud.

Expected flow:

```text
Translated timed segments
  -> speaker identity preserved
  -> speaker -> product voice mapping
  -> authenticated idempotent voice job
  -> WAV generation per segment
  -> generated duration check
  -> protected audio download
  -> local voice-cache
  -> timing-risk hints
```

Voice provider/model names are not exposed in the customer UI. Product voice IDs remain stable even if the backend provider changes later.

Development voice limits:

```text
Maximum segments:          300
Maximum total characters:  60,000
Maximum characters/segment: 4,096
Preview text:               220 characters
Preview cooldown:           3 seconds
Temporary server audio TTL: 60 minutes
```

If a multi-segment voice job fails or is cancelled, completed segment audio is kept on the development backend. Retrying the same idempotent job regenerates only missing segments. After the completed server audio TTL expires, retrying the same job safely regenerates the audio.

## Development job guarantees

The dev backend now implements:

- authenticated job ownership;
- idempotency by client job ID;
- duplicate retry recovery;
- quota reservation before processing;
- one-time expiring upload tokens;
- exact upload size validation;
- SHA-256 validation before processing;
- FLAC-only Cloud Speech uploads;
- maximum audio size and duration limits;
- queued / processing / completed / cancelling / cancelled / failed states;
- cancellation;
- temporary file cleanup;
- normalized Viral AI Tool speech result;
- quota charge only after successful speech completion;
- batched Cloud translation;
- translation job ownership and idempotency;
- original transcript timing preserved after translation;
- cancellation between translation batches;
- timing-risk hints for significantly longer translated segments;
- product-facing voice catalog independent of provider voice IDs;
- authenticated voice preview with cooldown;
- per-speaker voice assignment;
- resumable per-segment voice generation;
- protected WAV download to desktop cache;
- timing-risk hints when generated speech exceeds the original slot.

The same idempotency key cannot be reused with different audio metadata.

## Default development limits

Unless overridden by environment variables:

```text
Maximum prepared audio: 24 MiB
Maximum duration:       120 minutes
Temporary upload TTL:   10 minutes
```

Optional overrides:

```powershell
$env:VIRAL_AI_PROVIDER_MAX_AUDIO_BYTES="25165824"
$env:VIRAL_AI_MAX_AUDIO_SECONDS="7200"
```

## Account/session security behavior

- password is never persisted by the desktop renderer;
- access and refresh tokens are stored through Electron `safeStorage`;
- renderer never receives token values;
- access tokens expire after 15 minutes in the dev server;
- refresh tokens are rotated;
- logout revokes the active access and refresh session;
- changing the configured backend clears the previous local session;
- the app attempts to revoke the old remote session before switching endpoints;
- login attempts are rate-limited;
- the dev backend binds to loopback only.

## What remains development-only

This backend intentionally does **not** provide the production guarantees required for a public commercial service:

- persistent database storage;
- durable jobs across backend restarts;
- distributed job workers;
- production object storage / signed uploads;
- email verification;
- password reset;
- MFA;
- subscription payments;
- durable billing ledger;
- provider failover;
- production observability;
- abuse controls;
- persistent rate limiting;
- production secrets manager;
- horizontal scaling.

In particular, provider-side billing may already occur after a provider request has been accepted even if the user cancels immediately afterward. Production billing/cancellation policy must account for this explicitly.
