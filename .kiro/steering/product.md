---
inclusion: always
---

# Product — The Elden Cube

A small, funny 3D boss fight in the browser: a clumsy hero ("The Tarnished Intern") against a giant crowned cube ("The Elden Cube"). Two hits kill the player (3 flasks restore 1 HP each); the cube takes 20 damage (about five 3-hit combos). Souls-style stamina, input buffer and punish windows (GAME_DESIGN §4.3–§6.5, changed 2026-10-10). Built with Kiro, hosted on AWS (S3 + CloudFront via CDK). The booth attraction at AWS Student Community Day 2026 (Sat 17 Oct 2026). Booth key message: "Plan before you build."

## Purpose
- Draw visitors to the booth with a silly boss fight they want to try.
- Introduce Kiro (spec-first development).
- Promote AWS (static hosting for almost no cost, infrastructure as code).

## Locked decisions (README)
- Solo build with Kiro. Everything done, including polish, by **Tue 13 Oct 2026**.
- Platform: desktop Chrome on the booth laptop. One player at a time.
- Input: keyboard (WASD move, Space roll, F attack, R flask, M mute) + mouse/touchpad click to attack. No gamepad.
- 3D, simple geometric primitives only, flat green grass ground, no other scenery.
- No stored data: no leaderboard, accounts, scores. Each play is a one-time session.
- AWS: static hosting only (S3 + CloudFront, CDK). No AWS or network calls at runtime.
- Post-event hosting optional, only within ~USD 5/month.
- Code lives in `eldenCube/app` (game) and `eldenCube/infra` (CDK).
- AWS: personal account, IAM user `junsiengAdmin`, CLI profile `elden-personal`. No secrets in any file.
- Sound: files in `app/src/assets/sfx/` when present; otherwise (default) code-generated Web Audio recipes.

## Targets
- Attempt length 30–120 s. A first-time player wins in about 3–6 attempts.
- Steady 60 fps in Chrome on the booth laptop. No console errors or warnings.

## Source of truth
- `GAME_DESIGN.md` — gameplay behavior and every number.
- `ARCHITECTURE.md` — technical design, AWS stack, dev environment.
- `ASSETS.md` — sounds, colors, font, favicon.
- `PROJECT_PLAN.md` — stages 0–4, milestones, exit criteria, cut order.
- `eldencube.drawio` and `../liveDemo/` are not part of the build.

## Out of scope — never build (GAME_DESIGN §12, ARCHITECTURE §2)
- Multiplayer, leaderboards, accounts, saving, analytics, any network calls.
- Mobile or touch controls, gamepad support.
- Settings menus, difficulty selection UI.
- Textures, imported 3D models, terrain, trees, skyboxes.
- Boss voice, taunts, dialogue, subtitles, AI-generated content.
- A physics engine (only exception: optional ragdoll stretch item in PROJECT_PLAN, isolated in `fx/`).
- A UI framework (React, Vue, …), a state library, an analytics SDK, any runtime network call.
- No music by default.
