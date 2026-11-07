---
description: Install Murmur, connect your own Claude key safely, and start the app
---

Set up Murmur on this machine for the user. Work through these steps in order and report briefly after each one.

1. **Check Node.js.** Run `node -v`. Murmur needs Node 20.12 or newer. If it is missing or older, tell the user how to install the current LTS from https://nodejs.org and stop.
2. **Install dependencies.** Run `npm install`.
3. **Create `.env`.** If `.env` does not exist, copy `.env.example` to `.env`. Never overwrite an existing `.env`.
4. **Connect credentials, without the key ever entering this chat.**
   - Check whether `ANTHROPIC_API_KEY` already has a value in `.env` or the environment (report only "set" or "not set" and never print the value).
   - If it is not set, tell the user to open `.env` in their editor and paste their key after `ANTHROPIC_API_KEY=`. Keys come from https://console.anthropic.com/settings/keys. Ask them to reply "done" when finished. **Do not ask them to paste the key into this conversation, and do not read or echo the key yourself.**
   - Alternative: if the `ant` CLI is installed, `ant auth login` works too and no key file is needed.
5. **Confirm `.env` is ignored.** Run `git check-ignore .env`. It must print `.env`. If it does not, stop and warn the user.
6. **Run the checks.** Run `npm run typecheck` and `npm test`. Both must pass.
7. **Start the app.** Run `npm run dev` in the background, then tell the user to open http://127.0.0.1:3000.
8. **Explain the cost.** Each simulation makes roughly `people × rounds + a few` Claude calls on their own account (the UI shows the estimate before they press Run). Suggest starting small (8 people, 2 rounds) to try it out, and mention that `CLAUDE_MODEL=claude-sonnet-5-5` in `.env` makes runs cheaper.
