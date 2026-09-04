# Zeekend

Sponsored product placements for AI apps. When someone tells your assistant their
pan is scratched, Zeekend can put the right pan in front of them, labeled, at the
moment it helps.

- **Zero perceived latency.** The auction fires on the user's question and runs
  while your model streams. The slot is decided before your answer finishes.
- **Nothing fills most of the time.** Roughly 5 to 10% of turns. That is the
  design, not a bug.
- **No user data.** We get the last question, optionally the answer, and your
  publisher key. No identity, no cookies, no cross-app profile.

---

## Quickstart

The one-line way — installs the package AND finds your chat's message list
and drops the component in for you, no copy/paste:

```bash
npx @zeekend/sdk init
```

Works when your chat UI renders messages as `{messages.map(...)}` (true for
most React chat apps, including `useChat()` from the Vercel AI SDK). If it
can't find that pattern with confidence, it says so and prints the manual
snippet below instead of guessing.

Or by hand:

```bash
npm i @zeekend/sdk
```

```jsx
import { ZeekendSlot } from '@zeekend/sdk/react'

<ZeekendSlot publisherKey="pub_test" messages={messages} />
```

Drop it under your message list. That is the whole integration.

Using an AI coding assistant instead? Paste this:
`Read https://exchange.zeekend.com/skill.md and install Zeekend in this app.`
(or `/skill-dashboard.md` for the version that also wires up
[publisher.zeekend.com](https://publisher.zeekend.com) reporting.)

`pub_test` is the sandbox key. No signup, no waiting. It fills on almost every
turn so you can see it working in your own app in about two minutes, and it bills
nobody. When you have seen it work, get a live key at
[zeekend.com](https://zeekend.com) and change that one string.

Sandbox fill rates are not real. Live fill is closer to 5 to 10%, because most
turns genuinely deserve nothing.

### What `messages` needs to be

Your existing array. `[{ role, content }]`, and the common variants
(`{role, text}`, `{from: 'user'|'bot'}`, Anthropic-style content blocks). If you
use `useChat()` from the Vercel AI SDK, pass its `messages` straight in.

Everything else is derived from it: which turn this is, what the question was,
whether the assistant is still streaming. There is no turn id to keep stable and
no streaming flag to thread through.

---

## Options

Only `publisherKey` and `messages` are required.

```jsx
<ZeekendSlot
  publisherKey="pub_live_..."
  messages={messages}
  conversationId={thread.id}
  relevance={0.55}                    // quality floor 0-1. higher = fewer, better
  dimensions={{ maxWidth: 640 }}      // leave one axis unbounded
  blockCategories={['gambling', 'crypto']}
  onNoFill={reason => showBackupNetwork()}
/>
```

`relevance` is the setting that matters. At 0.55 you serve on strong matches
only. At 0.35 you roughly double fill and placements feel looser. Move it on your
own numbers, not ours.

Rendering several slots, or want config in one place:

```jsx
<ZeekendProvider publisherKey="pub_live_..." relevance={0.5}>
  <App />
</ZeekendProvider>
```

---

## Checking it works

```js
import { useZeekend } from '@zeekend/sdk/react'
const zk = useZeekend()
zk.stats()   // { requests, fills, fillRate, errors, timeouts, errorRate, p50, p95 }
```

Watch `errorRate`, not just `fillRate`. A broken integration and a quiet one look
identical from outside, which is exactly why they are separate counters.

| What you see | What it means |
| --- | --- |
| `errorRate` above 0 | Connection or auth. The console warning names the fix. |
| `errorRate` 0, `fillRate` 0 | Working. Nothing matched. Lower `relevance`. |
| `requests` 0 | The slot is not mounted where anything renders. |

The SDK warns in the console, without `debug`, when it cannot reach the exchange,
when your key is rejected, and when it loads but never fires. Silence is never a
valid state.

## Your earnings

```bash
curl https://exchange.zeekend.com/v1/publisher/stats \
  -H "x-publisher-key: pub_live_..."
```

Impressions, clicks, and what you have earned. No dashboard, no emailing us.

---

## What we receive

| Sent | Never sent |
| --- | --- |
| The user's last message | User id, email, phone |
| The assistant's reply, second pass only | Cookies, device ids |
| Your publisher key and placement id | Your system prompt |
| Coarse locale | Anything from earlier turns |

Text is clipped in your app before the request leaves: 2,000 characters of
question, 4,000 of answer. Read `trimContext()` in the source rather than taking
our word for it.

## Ad safety

Every unit ships with a Report control, no integration work. Reports reach us and
the advertiser is pulled from your app.

Generated copy is fenced by each advertiser's own claim rules: required phrases
must appear verbatim, banned words are stripped server-side after generation. We
do not let a model invent facts about someone's product.

The exchange scores every candidate at zero when a conversation involves health,
safety, injury, or money trouble. If your users are having a bad day, you earn
nothing on that turn.

## Billing

- An impression is 50% of the unit visible for one continuous second.
- Rendering is not an impression. Prefetching is never an impression.
- One impression and one click per slot, ever, enforced server-side.
- A click with no prior impression is invalid traffic and bills nothing.

Publishers earn a CPM on viewable impressions. Advertisers pay CPA on confirmed
orders. We carry the spread.

---

## Custom rendering

If you want the unit to match your app exactly, or you are on React Native where
there is no DOM:

```jsx
import { useZeekendSlot } from '@zeekend/sdk/react'

const { slot } = useZeekendSlot({ publisherKey: 'pub_live_...', messages })

if (slot) {
  // slot.headline, slot.body, slot.price, slot.image, slot.clickUrl
  // call zk.impression(slot) when it is 50% visible for 1s
  // call zk.click(slot) on click
}
```

Two rules: use `slot.clickUrl`, not `slot.url`, and keep `slot.disclosure`
visible. Everything else is yours.

## Not using React?

```js
import { Zeekend } from '@zeekend/sdk'
const zk = Zeekend.client({ publisherKey: 'pub_live_...' })

zk.attach({ mount: messageEl, messages })   // call whenever messages change
```

Repeat calls within a turn are ignored, so wire it into your render loop.

## Protocol

If you would rather not use the SDK at all:

```
POST /v1/slot        -> 200 + slot object, or 204 No Content for no fill
POST /v1/event       -> { type: impression | click | report, slotId }
POST /v1/conversion  -> { slotId, orderValue }   from your order webhook
GET  /v1/health
```

204 means nothing matched. Any 4xx or 5xx means we are broken. Treat them
differently.

Base URL `https://exchange.zeekend.com/v1`.