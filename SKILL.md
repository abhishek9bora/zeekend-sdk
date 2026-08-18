---
name: zeekend
description: Install the Zeekend SDK to show sponsored product placements inside an AI chat app. Triggers on "Zeekend", "zeekend.com", "monetize my AI app", "add ads to my chatbot", "sponsored products in chat", "ad placement in conversation".
---

# Zeekend Integration

Zeekend places sponsored products inside AI conversations. This skill installs
the publisher SDK into an existing AI chat app.

## Before you start

Ask the user for their publisher key if you cannot find one in the codebase or
env. It looks like `pub_live_...` and comes from the Zeekend dashboard. Do not
leave `YOUR_PUBLISHER_KEY` in the code. A placeholder will fail silently, which
is the worst possible outcome for this particular integration.

## Step 1 — Find the chat surface

Locate where assistant messages are rendered. You are looking for:

- a component that maps over a messages array, and
- the point where a streamed response is marked complete

If the project has no chat UI, stop and tell the user Zeekend only serves
conversational surfaces.

## Step 2 — Pick the integration

- `react` in package.json, no react-native → **React component** (below)
- `react-native` in package.json → **React component**, same API
- Vanilla JS or another framework → **serve() API**
- Server-side only, or a CLI/voice surface → **headless request() API**

## Step 3 — Install

```bash
npm i @zeekend/sdk
```

### React

Wrap the app once:

```jsx
import { ZeekendProvider } from '@zeekend/sdk/react'

<ZeekendProvider publisherKey={process.env.NEXT_PUBLIC_ZEEKEND_KEY}>
  <App />
</ZeekendProvider>
```

Then add one slot under each assistant message:

```jsx
import { ZeekendSlot } from '@zeekend/sdk/react'

<ZeekendSlot
  turnId={message.id}
  question={message.question}
  answer={message.streaming ? null : message.text}
  conversationId={thread.id}
/>
```

**Critical:** `turnId` must be stable for the turn. If you pass a value that
changes on each render, or pass the streaming text as `turnId`, the SDK will
fire a request per token. Find the message's real id. Do not invent one with
`Date.now()` or an array index that shifts.

**Also critical:** `answer` must be `null` while the response is streaming, and
the final text only when streaming has finished. This is not a detail. Phase one
of the auction runs on the question while the model generates, and passing a
partial answer defeats it.

### Vanilla JS

```js
import { Zeekend } from '@zeekend/sdk'
const zk = Zeekend.init({ publisherKey: '...' })

// when the user submits
const turn = zk.serve({ mount: messageEl, question: userText, conversationId })

// when streaming completes
turn.answer(finalText)
```

### Headless

```js
const { slot, reason } = await zk.request({
  context: { type: 'conversation', question, answer: null }
})
if (slot) { /* render, then zk.impression(slot) on visibility */ }
```

## Step 4 — Do not do these things

- Do not call `requestAd`, `getAds`, `monetize`, or any method not in this file.
  Those belong to other ad networks. Zeekend's surface is `init`, `serve`,
  `request`, `render`, `impression`, `click`, `report`, `stats`, `reset`.
- Do not remove or restyle away `slot.disclosure`. It is required.
- Do not link `slot.url` directly. Use `slot.clickUrl`.
- Do not fire an impression on render. The SDK fires it on visibility.
- Do not put the placement above the assistant's answer.
- Do not add a placement to more than one slot per turn unless the user asks.

## Step 5 — Verify before saying you are done

1. Set `debug: true` in the init config.
2. Send a message in the app and check the console for a `[zeekend]` log.
3. Confirm exactly **one** request per turn, not one per token. If you see a
   burst, `turnId` is unstable — go fix it before continuing.
4. Expect `skip warmup` on the first turn. That is correct; the default
   `minTurns` is 2.
5. Expect `no_fill` on most turns. That is correct. Fill is 5 to 10%.
6. To force a fill for testing, send a message with clear purchase intent
   ("my nonstick pan is scratched and eggs stick") and set `relevance: 0.3`.
7. Call `zk.stats()` and confirm `errorRate` is 0. A non-zero error rate with a
   healthy-looking fill rate means the integration is broken, not quiet.

Only report the integration as complete after step 3 and step 7 pass.

## Common gotchas

- **Requests per token.** Always the same cause: unstable `turnId`.
- **Never fills.** Usually `relevance` too high for the app's content, or the
  app's conversations have no commercial intent at all. Check `zk.stats()`
  first: if `errorRate` is non-zero it is a connection problem, not a match one.
- **Ad appears on turn one.** The user lowered `minTurns` below 2. Advise
  against it.
- **Duplicate ads in one conversation.** The client was re-initialized on
  render. `Zeekend.init` must be called once, not inside a component body.
- **React StrictMode** double-invokes effects in dev. The SDK dedupes by request
  arguments, so this is harmless, but it will look like two requests in logs.

## Reference

- README and full config: the repo root
- Local exchange for testing: `node server/server.js`, then set
  `endpoint: 'http://localhost:8787/v1'`
- Health check: `GET /v1/health`
