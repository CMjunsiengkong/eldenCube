---
inclusion: always
---

# Git rules

Remote: `origin` = https://github.com/CMjunsiengkong/eldenCube.git. **The agent commits; the user pushes.**

## Branches
- `main` always holds working code.
- One branch per milestone/stage: `feat/1.1-foundation`, `feat/1.2-player`, `feat/1.3-combat`, `feat/1.4-boss-ai`, `feat/1.4b-combat-rework`, `feat/1.5-flow`, `feat/1.6-tuning`, `infra/2-deploy`, `release/3-freeze`.
- Fixes go on `fix/<short-name>`.

## Commits
- Conventional Commits: `type(scope): summary`. Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.
- Small, frequent commits. Stage specific files (no blind `git add .`).

## Merging
- When a milestone's exit criteria pass, **ask the user first**. On approval (when the user asks for it): push the branch, open a GitHub PR with `gh pr create`, **squash-merge** it with `gh pr merge --squash` (**keep** the branch, no `--delete-branch`), then `git pull --ff-only` on `main` and start the next branch from it.
- After a squash merge, local `main` is reset to `origin/main` only with the user's permission.

## Never
- Never push unless the user asks for it, never force-push, never rewrite history (no amend/rebase of shared commits).
- Never commit secrets, `node_modules`, `dist` or `cdk.out`.
- Never change git config.

## Release
- In Stage 3, tag `v1.0-event` (the user pushes the tag). Later critical fixes get `v1.0.1-event`, …
