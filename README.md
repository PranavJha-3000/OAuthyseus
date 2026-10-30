# OAuthyseus

**How long until your users can connect?**

Before an AI agent can act on someone's Gmail, Slack or Notion, its developer has to register an OAuth app with that provider. Sometimes that's a 15-minute form. Sometimes it's weeks of review and a paid security audit. OAuthyseus tells you which, before you start, and walks you through it.

- **Guide library.** Seven hand-checked guides chosen to cover the range of difficulty: GitHub and Notion (easy), HubSpot and Microsoft (moderate), Google and Slack (hard), X (gated by price and policy).
- **Live investigation.** Enter any app name or website. An agent researches it from scratch, probes the live console and OAuth endpoints, and writes a guide in the same format. You watch it work, and you get a shareable link at the end.
- **Console pointer.** A Chrome extension highlights the exact button or field for each step on the provider's real console, in your own signed-in browser. If a label has changed, it can find the element from a screenshot instead.
- **Evidence on every claim.** Each claim is marked *tested*, *documented*, *inferred* or *unverified*. Quotes are checked mechanically against their sources.

## What I learned about the problem

A provider OAuth app is the developer's identity with the provider: one registration (client ID and secret, redirect URIs, requested scopes, branding) that every end-user connection goes through. Each user who clicks "Connect Gmail" creates one grant, and one token pair, under that app. So the app's approval status limits every user, and a developer can't put off thinking about it.

Researching seven providers showed three things that shaped the product:

1. **Difficulty depends on what you ask for, not on the provider.** Google is under an hour with `drive.file`, and 6+ weeks plus an annual CASA audit with `gmail.readonly`. So every guide is organised around **launch paths** (testing, internal, public basic, public sensitive, marketplace), each with its own time and wait. Choosing a path filters the steps.
2. **Hands-on time and waiting time are different costs.** Developers plan around the waiting. Each guide's signature visual is a **route bar**: your work drawn solid, the time spent waiting on the provider drawn hatched, ending at "users can connect".
3. **The most dangerous facts are recent changes.** Several widely repeated "facts" turned out to be outdated (list below). A guide that's confidently wrong costs more than no guide, so evidence is part of the format.

### Things the research corrected (all cited in the guides)

| Provider | Common belief | What the current docs say |
|---|---|---|
| Slack | Distributing outside the Marketplace is fine | Since 29 May 2025, commercially distributed non-Marketplace apps get **1 request/min, 15 objects** on `conversations.history`/`replies`, the two methods agents rely on. The API Terms also bar training LLMs on API data. |
| Google | Brand verification takes 2–3 business days | Now an automated check that "usually completes in a few minutes". Google's FAQ still says 2–3 days. |
| Google | CASA Tier 2 can be self-scanned for free | CASA now has two levels (AL1/AL2), both assessed by a lab. |
| GitHub | OAuth Apps get one callback URL; tokens never expire | Up to 10 callback URLs. New OAuth Apps get expiring tokens by default (8 h, 6-month refresh). |
| X | Free/Basic/Pro tiers | Tiers are gone: pay-per-use credits (reads $0.005/post) plus Enterprise. One live grant per app and user. |
| Notion | "Integrations", Distribution tab | Now "connections" in a new developer portal (May 2026). The install scope is chosen at creation and can't be changed. Refresh tokens rotate. |
| HubSpot | Create a public app in the developer account UI | Legacy public apps can no longer be created in the UI; you start from `hs project create`. Listed AI connectors must use user-level access. |
| Microsoft | A verified publisher lets users consent | The default consent policy for new tenants blocks user consent to Mail, Calendar and Files scopes, so mail and calendar agents effectively need each customer's admin to consent. |

## How the evidence works

| Mark | Meaning | How it's enforced |
|---|---|---|
| Tested | We exercised it: HTTP probe of the console, OIDC discovery, or the authorize endpoint with a fake client ID | Must cite a probe that actually ran, or it is downgraded |
| Documented | Stated on an official page | Must carry a verbatim quote of 15 words or fewer, which code searches for in the fetched page. If it isn't found, the claim is downgraded to *inferred* |
| Inferred | Reasoning from evidence | Must explain itself in `note` |
| Unverified | Community reports, or couldn't confirm | Listed again under "What we couldn't confirm" |

**Verification of the curated library** (`scripts/verify-guides.ts`, results in [`docs/verification-report.md`](docs/verification-report.md)):

- **240 of 240 quotes** were found verbatim in the live source pages.
- **17 of 17 live probes** succeeded: every console exists and sits behind sign-in, the discovery documents are reachable, and the authorize endpoints are live.
- **What the checker caught:** the first run found 238 of 240. One miss was a real typo in a quote (`production,click`), which I fixed. The other was a false negative: Google served a machine-translated Spanish page to a request with no `Accept-Language` header. I fixed the verifier, and the live agent's probes now send that header too.
- **What I could not verify:** actual (as opposed to published maximum) review times, CASA audit cost, and some console button labels. Labels come from the docs, not from a logged-in walkthrough. Each guide lists these under "What we couldn't confirm". No provider approvals were completed, because none were needed or possible without paid accounts.

## What the agent does, and where you take over

The live investigator (`src/lib/agent/investigate.ts`) is one Claude Opus 5.5 tool-use loop with:

- server-side `web_search` and `web_fetch` for reading docs;
- three probe tools that run real HTTP checks without credentials (`src/lib/agent/probes.ts`), with SSRF protection: public HTTPS hosts only;
- a `submit_guide` tool whose input is validated against the guide schema with Zod. Validation errors go back to the model to fix.

After the model submits, `ground.ts` checks every quote against the pages the agent actually fetched and downgrades anything it can't back up. The guide records the agent's searches, the pages it read, its probes and the grounding result. The UI streams the agent's progress over server-sent events.

Every step in a guide says who does it:
- **An agent can do this:** drafting a privacy policy, writing scope justifications, writing a demo-video script, writing the code.
- **Agent prepares, you submit:** for example, an app manifest you paste in.
- **You do this:** anything that needs a login, a legal attestation, payment or identity verification.

The pointer extension follows the same rule. It highlights and explains, but never types passwords, submits forms or accepts terms.

## Key decisions

- **Depth over breadth.** I chose seven guides that are actually checked over a hundred guesses. The live agent covers the long tail, in the same format and with the same honesty rules.
- **One schema for curated and generated guides** (`docs/guide-schema.md`). The library, the agent, the Markdown export, the JSON API (`/api/guides/:id`) and the extension all read it.
- **No account creation or credential handling.** "Tested" means credential-free probes. The extension runs in the developer's own session, so the hand-off point is explicit.
- **Pointer before full automation.** A browser agent that clicks through consoles for you is fragile and runs into logins and CAPTCHAs. Highlighting in your own session gets most of the benefit with none of the credential risk.

## Running it

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

- The library and guide pages work without an API key. Live investigation and screenshot pointing need one.
- To deploy: on Vercel, set `ANTHROPIC_API_KEY`. For shareable generated guides, also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the Upstash free tier is enough). Without them, generated guides go to `/tmp` and don't survive a cold start.
- To re-verify the library: `npx tsx scripts/verify-guides.ts`.
- To install the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `extension/`. The bridge only runs on `localhost` and `*.vercel.app`.

## Limitations

- **Waiting times:** published maximums plus community reports. I didn't run real reviews.
- **Console labels:** taken from the docs. The label matcher is heuristic; the screenshot fallback covers renamed labels, but only after you press "Point for me".
- **Run time:** a live investigation takes 2–4 minutes and runs inside one serverless function (300 s cap on Vercel). A long run on a provider with sprawling docs can hit that cap.
- **Generated guides** are not reviewed by a person. The page says so, and the grounding check is the safety net.
