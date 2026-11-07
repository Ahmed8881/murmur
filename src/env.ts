// Imported first so .env (git-ignored) is loaded before the Anthropic client reads it.
try {
  process.loadEnvFile();
} catch {}
