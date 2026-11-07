# Murmur: notes for Claude Code

Murmur simulates a crowd of AI personas reacting to a startup idea on a fake social feed, then writes a report and lets the user interview any persona.

## Layout
- `src/server.ts`: Express API, SSE stream, input validation, security headers. Binds to 127.0.0.1.
- `src/engine.ts`: the pipeline: brief → personas (per segment) → rounds (waves) → report; plus `interview()`. All prompts and zod output schemas live here.
- `src/claude.ts`: the only place that talks to the Anthropic SDK (`ask` = structured output, `chat` = free text).
- `src/types.ts`, `src/util.ts`: shared types and pure helpers (tested in `test/`).
- `public/`: dependency-free frontend (`app.js`, `styles.css`, `index.html`). No build step.

## Rules
- Never commit secrets. `.env` is git-ignored; only `.env.example` is tracked. Never print or log an API key.
- Model output is untrusted: render it with text nodes only (`h()` in `app.js`), never `innerHTML`. Keep the CSP in `server.ts` strict (no inline scripts or styles).
- Validate every request body with zod in `server.ts`.
- Keep the frontend build-free and the dependency list short.

## Commands
- `npm run dev`: start with reload at http://127.0.0.1:3000
- `npm run typecheck` / `npm test`: must pass before opening a PR (CI runs both)
- New contributors: run `/setup`.
