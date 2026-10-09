---
inclusion: always
---

# Git rules

Remote: `origin` = https://github.com/CMjunsiengkong/eldenCube.git. **The agent commits; the user pushes.**

## Branches
- `main` always holds working code.
- One branch per milestone/stage: `feat/1.1-foundation`, `feat/1.2-player`, `feat/1.3-combat`, `feat/1.4-boss-ai`, `feat/1.5-flow`, `feat/1.6-tuning`, `infra/2-deploy`, `release/3-freeze`.
- Fixes go on `fix/<short-name>`.

## Commits
- Conventional Commits: `type(scope): summary`. Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.
- Small, frequent commits. Stage specific files (no blind `git add .`).

## Merging
- When a milestone's exit criteria pass, **ask the user first**, then merge into `main` with `--no-ff` and delete the branch.

## Never
- Never push (the user pushes), never force-push, never rewrite history (no amend/rebase/reset of shared commits).
- Never commit secrets, `node_modules`, `dist` or `cdk.out`.
- Never change git config.

## Release
- In Stage 3, tag `v1.0-event` (the user pushes the tag). Later critical fixes get `v1.0.1-event`, …
