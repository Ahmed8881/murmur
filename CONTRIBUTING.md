# Contributing

Thanks for helping! The quickest way in:

```bash
git clone https://github.com/Ahmed8881/murmur && cd murmur
claude          # then type /setup
```

## Workflow

1. Fork, then create a branch: `git checkout -b feat/short-description`.
2. Keep changes focused. Run `npm run typecheck && npm test`.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
4. Open a pull request against `main`. `main` is protected: changes land through PRs with passing CI.

## Ground rules

- **No secrets in commits.** CI runs a secret scanner on every push and PR, and GitHub push protection is on.
- Treat model output as untrusted (see `CLAUDE.md`).
- Prefer the platform and existing code over new dependencies.

By contributing you agree your work is released under the MIT License.
