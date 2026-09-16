# DualScribe — optional Groq transcription

This working copy adds **Groq · Whisper Large V3 Turbo** to the transcription model selector while retaining Gemini and the existing history/export result shape.

## Run locally

Tested with Node.js 24 and npm. Use npm for this copy; the inherited Bun lockfile was not refreshed.

```sh
npm ci
npm test
npm run lint
npm run dev
```

Production smoke:

```sh
npm run build
NODE_ENV=production npm start
```

Open http://localhost:3000, create a local account, select a file, choose Groq, and enter your personal Groq key in the temporary password field. No Gemini key is needed for Groq. Gemini remains the default and still uses its existing saved key flow.

Groq uses a 25,000,000-byte upload cap, 120-second upstream timeout, automatic language detection, and segment timestamps. No automatic retries or cross-provider fallbacks. The key lives only in transcription-view React state; navigating away/reloading clears it. It passes through the server to Groq and is never saved by this addition. Do not add it to client environment variables.

Whisper segment boundaries are **not speaker identities**. Groq results display `Speaker unknown`. The adapter does not translate or post-edit Arabic/English text. Empty transcripts are preserved as empty text.

## Existing security limitations

The inherited application trusts client-provided user IDs without authenticated sessions, stores Gemini keys in plaintext SQLite, and has unsafe password-reset/MFA flows. This patch does not repair the account system. Use a trusted local environment; fix authentication/authorization before public multi-user deployment. Do not add a shared server key to these unauthenticated routes.

See `REVIEW-ar.md` for the architecture, exact file/function inventory, limitations and follow-up plan. No live provider accuracy test was performed; automated tests stub external inference responses.
