# Zeekend SDK

Sponsored product placements for AI apps. When someone tells your assistant
their pan is scratched, Zeekend can put the right pan in front of them, labeled,
at the moment it helps.

Three properties that make this worth a try:

- **Zero perceived latency.** The auction fires on the user's question and runs
  while your model streams. The slot is decided before your answer finishes.
- **Nothing fills most of the time.** Ads serve on maybe 5 to 10% of turns.
  That is the design, not a bug. Turn `relevance` down if you want more.
- **No user data.** We get the last question, optionally the answer, and your
  publisher key. No identity, no cookies, no cross-app profile.

---

## Install

```bash
npm i @zeekend/sdk
```

Or let a coding agent do it. In Cursor, Claude Code, or anything similar, paste:

> Read https://exchange.zeekend.com/skill.md and follow its instructions to
> install Zeekend in this app.

It detects your framework, wires the SDK in, and verifies the integration before
reporting success.

You need a publisher key. Get one at [zeekend.com](https://zeekend.com). Until you
have one, run your own exchange locally (see the end of this file) and point the
SDK at it with the `endpoint` option.

## React

```jsx
import { ZeekendProvider, ZeekendSlot } from '@zeekend/sdk/react'

<ZeekendProvider publisherKey="pub_live_...">
  <App />
</ZeekendProvider>

// under each assistant message
<ZeekendSlot
  turnId={msg.id}                              // stable per turn. required.
  question={msg.question}
  answer={msg.streaming ? null : msg.text}     // null while streaming
  conversationId={thread.id}
/>
```

That is the whole integration. `turnId` is the guard that stops a streaming
answer from firing a request per token, so it must be stable for the turn.

## Vanilla JS

```js
import { Zeekend } from '@zeekend/sdk'

const zk = Zeekend.init({ publisherKey: 'pub_live_...' })

// the moment the user hits enter
const turn = zk.serve({
  mount: messageEl,
  question: userText,
  conversationId: threadId
})

// when your assistant finishes streaming
turn.answer(finalText)
```

`serve()` runs two phases. Phase one matches on the question alone, while your
model is still generating. If nothing fills, phase two runs again with the
answer included, because the diagnosis in the answer is often the real buying
signal. The second render replaces the first.

## Headless

Build your own unit and keep full control of your UI.

```js
const { slot, reason } = await zk.request({
  context: { type: 'conversation', question, answer: null }
})

if (slot) {
  renderYourOwnCard(slot)   // slot.headline, .body, .price, .image, .clickUrl
  zk.impression(slot)       // call when 50% visible for 1s
  // zk.click(slot) on click
}
```

Two rules if you render your own: use `slot.clickUrl`, not `slot.url`, and keep
the `slot.disclosure` label visible. Everything else is yours.

---

## Config

```js
Zeekend.init({
  publisherKey: 'pub_live_...',

  relevance: 0.55,        // quality floor 0-1. higher = fewer, better, less fill
  minTurns: 2,            // no ad before the conversation warms up
  turnGap: 2,             // user turns between placements
  maxPerSession: 3,

  blockCategories: ['gambling', 'crypto', 'supplements', 'politics'],
  blockAdvertisers: ['competitor.com'],

  timeoutMs: 1500,        // never blocks your app; on timeout, renders nothing
  debug: false
})
```

`relevance` is the setting that matters. At 0.55 you serve on strong matches
only. At 0.35 you roughly double fill and the placements feel looser. Move it
based on your own numbers, not ours.

## Sizing

You do not pick a format. Tell us how much room the slot has and we serve what
fits: a product card, a scrolling catalog, or a plain text mention.

```js
zk.serve({ dimensions: { maxWidth: 640 } })   // leave height unbounded
```

Leave at least one axis unbounded. A wider pool of eligible formats means a
higher fill rate.

## Waterfall to another network

```js
zk.serve({
  mount: el,
  question,
  onFill:   slot   => {},
  onNoFill: reason => showBackupNetwork(el)
})
```

`reason` is one of `no_fill`, `warmup`, `frequency_cap`, `session_cap`,
`timeout`, `error`. The first four are normal. The last two are us being broken,
and they are deliberately never conflated with the others.

## Monitoring

```js
zk.stats()
// { requests, fills, fillRate, errors, timeouts, errorRate, p50, p95 }
```

Watch `errorRate`, not just `fillRate`. A broken integration and a quiet one
look identical from the outside, which is exactly why these are separate counters.

---

## What we receive

| Sent | Never sent |
| --- | --- |
| The user's last message | User id, email, phone |
| The assistant's reply (phase 2 only) | Cookies, device ids, IP fingerprints |
| Your publisher key and placement id | Your system prompt |
| Coarse locale | Anything from earlier turns |

Text is clipped client-side before the request leaves your app: 2,000 chars of
question, 4,000 of answer. Read `trimContext()` in the source if you want to
verify that rather than take our word for it.

## Ad safety

Every unit ships with a Report control, no integration work. Reports go
straight to us and the advertiser gets pulled from your app.

Generated copy is fenced by the advertiser's own claim rules: required phrases
must appear verbatim, banned words are stripped server-side after generation.
We do not let a model invent facts about someone's product.

The exchange scores every candidate at zero when the conversation involves
health, safety, injury, or money trouble. If your users are having a bad day,
you earn nothing on that turn.

---

## Troubleshooting

**No ads ever appear.** Check the browser console. The SDK warns once, loudly,
when it cannot reach the exchange or when your key is rejected — those warnings
are not gated behind `debug`. Then check `zk.stats()`:

| What you see | What it means |
| --- | --- |
| `errorRate` above 0 | Connection or auth problem. Read the console warning. |
| `errorRate` 0, `fillRate` 0 | Working correctly, nothing matched. Try lowering `relevance`. |
| `fills` 0 and `requests` 0 | Pacing. First turn is `warmup` by default. |

**Requests firing on every token.** In React, `turnId` is not stable across
renders. It must be the message's real id, not an array index or `Date.now()`.

**An ad appears on turn one.** `minTurns` was lowered below 2. Don't.

**Timeouts.** Default `timeoutMs` is 8000, which is generous because the request
races your model's stream and blocks nothing. If you see timeouts, your exchange
is slow, not your app.

## Running your own exchange

The reference exchange is not in this package. It lives in the
[repository](https://github.com/CHANGEME/zeekend-sdk).

```bash
ANTHROPIC_API_KEY=sk-ant-... node server/server.js
Zeekend.init({ publisherKey: 'pub_test', endpoint: 'http://localhost:8787/v1' })
```

Without an API key it falls back to keyword matching and prints
`model scoring: OFF`. It will still serve ads. They will not be good ones. Check
`GET /v1/health` before trusting any number it produces.

## Protocol

If you would rather not use the SDK:

```
POST /v1/slot        -> 200 + slot object, or 204 No Content for no fill
POST /v1/event       -> { type: impression | click | report, slotId }
POST /v1/conversion  -> { slotId, orderValue }   from your order webhook
GET  /v1/health
```

204 means nothing matched. Any 4xx or 5xx means we are broken. Treat them
differently.

## Billing rules

- An impression is 50% of the unit visible for one continuous second.
- Rendering is not an impression. Prefetching is never an impression.
- One impression and one click per slot, ever, enforced server-side.
- A click with no prior impression is invalid traffic and bills nothing.

Publishers earn a CPM on viewable impressions. Advertisers pay CPA on confirmed
orders. We carry the spread between them, which is the only arrangement a brand
will test cold and the only one that lets you forecast revenue.

## Local development

```bash
ZK_DEMO=1 ANTHROPIC_API_KEY=sk-ant-... node server/server.js
```

`ZK_DEMO=1` serves the example app at `/paddock` and the advertiser console at
`/console`. Leave it unset anywhere public: the demo chat proxy calls Anthropic
with your key and has no authentication.