# Live agent evaluation (2026-10-30 / 31)

Every run below used a **free-tier Gemini key**. That is the setup a reviewer is most likely to have, and the hardest one for the agent. Logs come from `scripts/investigate.mts`.

## Agent vs. curated: Slack

Slack is a good test. Its mechanics are easy, but the real gate for a commercial AI agent is easy to miss: since May 2025, apps distributed commercially outside the Marketplace get 1 request/min on `conversations.history`, and a Marketplace listing needs 10+ installs and up to about 12 weeks of review.

| | Curated guide | Agent run 1 | Agent run 2 (after fixes) |
|---|---|---|---|
| Model | (researched by hand, verified) | gemini-3.5-flash-lite (full models out of quota) | gemini-3.5-flash-lite |
| Time | n/a | 48 s | 54 s |
| Verdict | **hard** | moderate | moderate |
| Paths | internal / unlisted / Marketplace | local / Marketplace | **undistributed / unlisted / Marketplace** |
| Commercial apps must use the Marketplace | yes | no | **yes** (quote verified) |
| Rate limits for non-Marketplace apps | yes | no | no |
| 10-install minimum, review up to ~12 weeks | yes | no | no |
| Workspace admin approval blocker | yes | no | **yes** |
| Approval wait | 2–12 weeks (published maximums) | "1–7 days", labelled *inferred* | "3–14 days", backed by a quote that gives no duration |
| Quotes found verbatim | 32/32 | 14/18 (4 downgraded) | 16/19 (3 downgraded) |

**What the agent got right:** the registration mechanics (the Create New App, OAuth & Permissions and redirect URL flow) and token types. It probed the live endpoints, and its broken quotes were caught and downgraded.

**What it missed:** the facts that make Slack *hard* for a commercial agent. Those live in Slack's changelog and Marketplace guidelines, which a quick read of the docs doesn't reach. A curated guide is still worth more than a generated one for the most important providers.

### What these runs changed

1. **Approval waits are checked mechanically** (`agent/common.ts`). A wait now counts as *documented* only if a verified quote actually contains a duration. Otherwise it is relabelled *unverified*, with a note that it is the agent's estimate. Run 2's "3–14 days" would now be marked unverified. Run 1 showed why this is needed: the model listed review time as unknown in its own uncertainties, then gave "1–7 days" anyway.
2. **The agent must read about the launch gate.** If it tries to finish without having read any page on review, distribution, Marketplace, verification, limits or terms, it is sent back once (`agent/open.ts`). Run 2 then read Slack's "App lifecycle & distribution" page, found the Marketplace requirement, the unlisted path and admin approval, and quoted them correctly.

## New app: Calendly (not in the library)

| Run | Model | Time | Result |
|---|---|---|---|
| 1 | gemini-3.5-flash-lite (after 5 overloaded models) | 149 s | **easy**, accurate (self-serve, PKCE, secret shown once), but thin: 2 steps. 10/10 quotes verified |
| 2 | gemini-3.5-flash-lite | 47 s | thin and weakly sourced: the model guessed two docs URLs that 404 and read no pages. Labels stayed honest: 5 *tested* (probes), 13 *inferred*, 0 *documented*, no approval wait claimed |
| 3 | gemini-3.5-flash-lite | 39 s | **easy**, 6 steps, 3 blockers, 8/8 quotes verified. 2 of 3 probes succeeded; the third (a console probe aimed at the authorize URL) was treated as a sign-in wall |

Fix after run 2: when a fetch fails, the tool result lists real URLs on that site from the agent's own searches (`agent/open.ts`), because smaller models guess URLs instead of using results they already have.

## Free-tier behaviour observed

- **Overload:** the newest Gemini Flash models were often overloaded. They returned 503, or held the connection without replying. The agent now finds a responsive model one request at a time, puts failing models on cooldown, and switches straight to the next.
- **Daily quota:** 20 requests per model per day for the full Flash models (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). A day of testing used it up, so every run after that used Flash-Lite. Writing prefers a full model, but now falls back to Lite rather than failing.
- **Model quality decides research depth.** The quote check keeps the output honest at every model size, but it can't make thin research thorough. With quota available, a full Flash model writes the more complete guides; for a demo, run on a fresh day's quota or use a paid key.
