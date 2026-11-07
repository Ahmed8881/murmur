# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. You should get a reply within a few days.

## How Murmur handles your data

- **Your key stays on your machine.** Murmur reads `ANTHROPIC_API_KEY` from your environment or a local `.env` file, which is git-ignored. The key is only sent to the Anthropic API.
- **Local only by default.** The server binds to `127.0.0.1`. If you set `HOST=0.0.0.0` or deploy it, anyone who can reach it can run simulations on your bill. Put it behind authentication first.
- **Your ideas and decks** go to the Anthropic API and are saved as JSON in `./data/` (git-ignored) on your machine. Nothing is sent anywhere else.
- **Model output is treated as untrusted** and rendered as plain text under a strict Content Security Policy.

## If you leak a key

Revoke it immediately at https://console.anthropic.com/settings/keys and create a new one. Deleting the commit does not make a pushed secret safe again.
