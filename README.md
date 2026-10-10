# The Elden Cube — Project Overview

A small, funny 3D boss fight in the browser, built with **Kiro** and delivered on **AWS**. It is the attraction at our booth at **AWS Student Community Day 2026 (Sat, 17 Oct 2026)**.

## Purpose

| Goal | How |
|---|---|
| Draw visitors to the booth | A silly-looking boss fight that people want to try |
| Introduce Kiro | Visitors ask how it was built. Answer: Kiro, with the plan written before any code. A live demo follows (see `../liveDemo/`) |
| Promote AWS | The game is hosted on AWS (S3 + CloudFront) for almost no cost. Everything is defined as code with the AWS CDK |

**Key message for visitors:** *"Plan before you build."* With Kiro you agree on requirements and design first, then let it build. You don't prompt and hope.

## Locked decisions

| Topic | Decision |
|---|---|
| Builder | Solo, using Kiro |
| Deadline | **Everything done (including polish) by Tue 13 Oct 2026**. Earlier is better |
| Platform | Web browser (Chrome) on the booth laptop |
| Players | One at a time, on the booth laptop |
| Input | Laptop keyboard (WASD move, Space roll, R flask) plus a mouse or touchpad (click to attack). No gamepad |
| Graphics | 3D, built only from simple geometric shapes, with a flat green grass ground and no other scenery |
| Data | **No stored data**: no leaderboard, no accounts, no scores. Each play is a one-time session (like slowroads.io) |
| AWS approach | **Static hosting only** (S3 + CloudFront, built with the CDK). No AWS calls while the game runs |
| Hosting after the event | Optional. Only if it stays within about USD 5/month |
| Network | Stable venue Wi-Fi expected. A local fallback is still prepared |
| Booth hours | 8am–5pm, with continuous rotating groups of visitors |
| Code location | `eldenCube/app` (game) and `eldenCube/infra` (CDK), next to these documents |
| AWS account | Personal account, IAM user `junsiengAdmin`, CLI profile `elden-personal`. No secrets are stored in any document (ARCHITECTURE.md §13.4) |
| Sound | Sound files in `app/src/assets/sfx/` are used when present; otherwise (and by default) code-generated Web Audio sounds |

## Documents

| File | Contents |
|---|---|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Complete gameplay spec: states, screens, controls, player (combo, roll, stamina, flask, HP), boss, attacks, camera, arena, audio triggers, debug flags, acceptance checklist |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Complete technical spec: stack, repository layout, game loop, state machine, physics and collision, `config.ts`, testing, AWS CDK stack, deploy and teardown, cost, security, development environment, MCP servers and AWS profile setup (§13) |
| [ASSETS.md](ASSETS.md) | Every non-code resource: procedural sound recipes, color palette, font, favicon, booth materials, tools |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Stage-by-stage build plan for the game (milestones with exit criteria), cut order, risks |
| [eldencube.drawio](eldencube.drawio) | Sheet 1: architecture diagram. Sheet 2: booth event flow |

**For the coding agent:** GAME_DESIGN.md + ARCHITECTURE.md + ASSETS.md are the complete specification. Build in the order of PROJECT_PLAN.md Stage 1 milestones. Where the documents give a value, use it exactly; values marked *(tune)* may only change during playtesting.

The live-demo script for the booth is in [`../liveDemo/LIVE_DEMO.md`](../liveDemo/LIVE_DEMO.md).

## AWS services used (for the booth poster)

| Service | Role in the project |
|---|---|
| Amazon S3 | Stores the built game files |
| Amazon CloudFront | Serves the game worldwide over HTTPS |
| AWS CDK / AWS CloudFormation | All infrastructure written as TypeScript code |
| AWS IAM | Lets only CloudFront read the private bucket (Origin Access Control) |
| AWS Budgets | Cost guardrail with an alert at USD 5 |
| Kiro | The AI IDE used to plan and build the whole project |
