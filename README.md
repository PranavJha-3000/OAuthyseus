# OAuthseus

**How long until your users can connect?**

Before an AI agent can act on someone's Gmail, Slack or Notion, its developer has to register an OAuth app with that provider. Sometimes that's a 15-minute form. Sometimes it's weeks of review and a paid security audit. OAuthseus tells you which, before you start, and walks you through it.

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

The live investigator runs on **free-tier models**. Any OpenAI-compatible API works: Gemini (recommended), Groq or OpenRouter. If an Anthropic key is set instead, it uses Claude. All the tools are its own, so nothing depends on a paid search API:

- **`web_search`:** DuckDuckGo Lite with Bing as fallback, no key needed. Tavily or Brave is used if you set their free-tier keys (`src/lib/agent/web.ts`).
- **`fetch_page`:** fetches the page directly, falls back to the free Jina reader for pages that render in the browser, and returns the passages around the model's focus terms so long docs fit a small context window.
- **Three probe tools** run real HTTP checks without credentials (`src/lib/agent/probes.ts`), with SSRF protection: public HTTPS hosts only.

The free-tier engine (`src/lib/agent/open.ts`) works in two phases:

1. **Research:** a tool-calling loop that searches, reads and probes. Every page it reads gets a source ID (`s1`, `s2`, …).
2. **Writing:** a separate JSON-mode call writes the guide from the gathered excerpts. The phases are split because Gemini rejects tool calling and JSON mode in the same request.

Output is validated with Zod; on failure, the errors go back to the model, up to three attempts. Rate-limit responses (429) are retried after the provider's suggested delay, and the live log shows the wait. The Claude engine (`src/lib/agent/claude.ts`) does the same job with Claude's server-side web tools.

After the guide is written, `ground.ts` checks every quote against the pages the agent actually fetched and downgrades anything it can't back up. The guide records the agent's searches, the pages it read, its probes and the grounding result. The UI streams the agent's progress over server-sent events.

Every step in a guide says who does it:
- **An agent can do this:** drafting a privacy policy, writing scope justifications, writing a demo-video script, writing the code.
- **Agent prepares, you submit:** for example, an app manifest you paste in.
- **You do this:** anything that needs a login, a legal attestation, payment or identity verification.

The pointer extension follows the same rule. It highlights and explains, but never types passwords, submits forms or accepts terms.

### How the live agent did ([`docs/agent-eval.md`](docs/agent-eval.md))

I ran the agent on Slack, which has a curated guide, and on Calendly, which is new. All runs used a free Gemini key, mostly on Flash-Lite after the full models' daily quota ran out.

- **What it gets right:** the registration mechanics, live endpoint probes, and honest labels. Every invented or wrong quote it produced was caught and downgraded.
- **What it misses:** facts hidden in changelogs and marketplace guidelines. On Slack it missed the 2025 rate limit for non-Marketplace apps and the 10-install minimum that the curated guide has.
- **What the runs changed:**
  - Approval waits now count as *documented* only when a verified quote contains a duration. The agent once gave "1–7 days" while listing review time as unknown.
  - The agent has to read at least one page about review or distribution before it can finish.
  - Failed fetches point it back to real URLs from its own searches.

## Key decisions

- **Depth over breadth.** I chose seven guides that are actually checked over a hundred guesses. The live agent covers the long tail, in the same format and with the same honesty rules.
- **One schema for curated and generated guides** (`docs/guide-schema.md`). The library, the agent, the Markdown export, the JSON API (`/api/guides/:id`) and the extension all read it.
- **No account creation or credential handling.** "Tested" means credential-free probes. The extension runs in the developer's own session, so the hand-off point is explicit.
- **Pointer before full automation.** A browser agent that clicks through consoles for you is fragile and runs into logins and CAPTCHAs. Highlighting in your own session gets most of the benefit with none of the credential risk.

## Running it

```bash
npm install
cp .env.example .env.local   # add a free GEMINI_API_KEY from https://aistudio.google.com/apikey
npm run dev                  # http://localhost:3000
```

- The library and guide pages work without any key. Live investigation and screenshot pointing need one model key.
- The model is chosen by whichever key is set, checked in this order:
  1. `LLM_BASE_URL` + `LLM_API_KEY` (+ `LLM_MODEL`)
  2. `GEMINI_API_KEY` (newest Flash model picked automatically; override with `GEMINI_MODEL`)
  3. `GROQ_API_KEY`
  4. `OPENROUTER_API_KEY` (a `:free` model is picked; override with `OPENROUTER_MODEL`)
  5. `ANTHROPIC_API_KEY`
- Groq's free tier allows only a few thousand tokens a minute, and reading docs pages exceeds that, so Gemini works best.
- To check the tools without any model: `npx tsx scripts/smoke-tools.mts "Calendly"`.
- To run an investigation from the terminal, with a timestamped log, and save the guide: `npx tsx --env-file=.env scripts/investigate.mts "Calendly"`.
- To deploy: on Vercel, set your model key. For shareable generated guides, also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the Upstash free tier is enough). Without them, generated guides go to `/tmp` and don't survive a cold start.
- To re-verify the library: `npx tsx scripts/verify-guides.ts`.
- To install the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `extension/`. The bridge only runs on `localhost` and `*.vercel.app`.

## Limitations

- **Waiting times:** published maximums plus community reports. I didn't run real reviews.
- **Console labels:** taken from the docs. The label matcher is heuristic; the screenshot fallback covers renamed labels, but only after you press "Point for me".
- **Run time:** a live investigation takes 2–4 minutes and runs inside one serverless function (300 s cap on Vercel). Free-tier rate-limit waits and providers with sprawling docs can push a run past that cap.
- **Keyless search** scrapes DuckDuckGo Lite and Bing, which can throttle or change their markup. A free Tavily or Brave key makes search dependable.
- **Free-tier capacity is the real constraint.** In testing, the newest Gemini Flash models were often overloaded: they answered 503, or held the connection without replying. The agent handles this:
  - It pings every candidate model at the start and uses the best one that responds.
  - It puts a failing or rate-limited model on cooldown and moves to the next immediately, since quotas are per model.
  - It keeps Flash-Lite out of the writing step.

  Even so, a day of heavy testing used up the daily free quota on the full Flash models. When that happens, research falls back to Flash-Lite, which reads less carefully, so the guide comes out thinner.
  - *A good run:* Calendly in 149 s, 10 of 10 quotes found verbatim.
  - *A starved run:* Flash-Lite made 17 searches and read nothing. That is why searches are now capped until the agent reads a page.
- **Free-tier model quality:** smaller models write weaker guides and make more quote mistakes. The grounding check catches invented quotes, but not thin research.
- **Generated guides** are not reviewed by a person. The page says so, and the grounding check is the safety net.
