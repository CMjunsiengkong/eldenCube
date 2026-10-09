---
inclusion: always
---

# Ground rules (apply for the whole project)

1. **The documents are the specification.** Use every given value exactly. Values marked *(tune)* change only during playtesting (milestone 1.6), and only in `app/src/config.ts`.
2. **Never add anything out of scope** (GAME_DESIGN §12, ARCHITECTURE §2 "Do not add").
3. **Work stage by stage** per PROJECT_PLAN.md. Don't start a stage before the previous stage's exit criteria are met. In Stage 1, build milestones 1.1 → 1.6 in order; the game must run after each one.
4. **Secrets:** never ask for, write, print or store passwords, AWS access keys, secret keys or MFA codes. For AWS, always and only use `--profile elden-personal`; never use or write the `default` profile. Never export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
5. **User steps:** steps marked **User** in PROJECT_PLAN.md belong to the user. On reaching one, stop, say exactly what to run or do, and wait for confirmation.
6. **Ask, don't guess:** if the documents are contradictory or missing something needed, ask the user.
7. **Explain risky commands:** before running any shell command that installs software or touches AWS, explain in one line what it does.
8. **Reporting:** at the end of every milestone and stage, report what was done, how each exit criterion was verified (commands, test results, what was checked in Chrome via the chrome-devtools MCP), and anything the user needs to do next.
