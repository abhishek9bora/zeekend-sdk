---
name: zeekend
description: Install the Zeekend SDK to show sponsored product placements inside an AI chat app. Triggers on "Zeekend", "zeekend.com", "@zeekend/sdk", "monetize my AI app", "add ads to my chatbot", "sponsored products in chat", "ad placement in conversation".
---

# Zeekend integration

Zeekend places sponsored products inside AI conversations. The auction fires on
the user's question and runs while the model streams, so a placement adds nothing
to how long the user waits. Nothing fills on most turns, by design.

There is one integration. Do not improvise another.

## Step 1 — Key

Ask the user for their publisher key. It looks like `pub_live_...`.

**If they do not have one, use `pub_test` and continue.** That is the sandbox:
no signup, fills on almost every turn, bills nobody. They can see it working
immediately and swap in a live key later by changing one string.

Never invent a `pub_live_` value. Tell them once, at the end, that sandbox fill
rates are not representative and a live key comes from https://zeekend.com.

## Step 2 — Find the messages array

Locate where the app renders assistant messages. You are looking for the array
of conversation turns it maps over. Common names: `messages`, `chatHistory`,
`conversation`, or `messages` from `useChat()` in the Vercel AI SDK.

It should look like `[{ role: 'user' | 'assistant', content: '...' }]`. The SDK
also accepts `{role, text}`, `{from: 'user'|'bot'}`, and Anthropic-style content
blocks, so do not reshape it.

If the app has no conversational surface, stop and say so.

## Step 3 — Install

```bash
npm i @zeekend/sdk
```

Do not set an `endpoint`. The default is production.

## Step 4 — Add one component

```jsx
import { ZeekendSlot } from '@zeekend/sdk/react'

<ZeekendSlot publisherKey={process.env.NEXT_PUBLIC_ZEEKEND_KEY} messages={messages} />
```

Place it directly under the message list, inside the same scroll container, so
the unit sits with the conversation.

If the messages live in a store rather than a prop, read them from the store in
whatever component renders the slot.

That is the entire integration. Nothing else is required.

## Step 5 — Do not do these things

- Do not pass `turnId`, `question`, or `answer` by hand. Those props still exist
  from an older version and getting `turnId` wrong fires a request per token.
  `messages` is the correct integration.
- Do not call `Zeekend.init` inside a component body.
- Do not call `requestAd`, `getAds`, or `monetize`. Those belong to other ad
  networks. Zeekend's surface is `init`, `client`, `serve`, `request`, `attach`,
  `render`, `impression`, `click`, `report`, `stats`, `reset`.
- Do not remove or restyle away `slot.disclosure`. The label is required.
- Do not link `slot.url`. Use `slot.clickUrl`, the tracked URL.
- Do not fire an impression on render. The SDK fires it on visibility.
- Do not place the unit above the assistant's answer.
- Do not add more than one slot per turn unless asked.
- Do not lower `minTurns` below 2.

## Step 6 — Verify before reporting success

1. Add `debug` to the slot props or provider.
2. Send two messages in the app.
3. Check the browser console for a `[zeekend]` line.
4. Confirm **exactly one request per turn**, not one per token. A burst means
   `messages` is being rebuilt with different content each render. Investigate
   before continuing.
5. Turn one will `skip warmup`. Correct: `minTurns` defaults to 2.
6. On `pub_test`, turn two onward should fill every time. If nothing ever fills,
   the integration is wrong, not the matching. On a live key, most turns
   correctly return nothing.
7. Confirm `errorRate` is 0 via `useZeekend().stats()`.

Only report the integration complete after steps 4 and 6 pass.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Console: cannot reach the exchange | Network, or an `endpoint` was set. Remove it. |
| Console: initialized but never fired | The slot is not mounted where anything renders. |
| `errorRate` above 0 | Connection or auth. The console warning names the fix. |
| `errorRate` 0, `fillRate` 0 on a live key | Working correctly. Nothing matched. |
| A request per token | `messages` content is changing every render. |
| Ad on turn one | `minTurns` was lowered. Put it back. |
| Two identical ads | `Zeekend.init` called inside a component. Use the component or provider. |
| Doubled requests in React dev | StrictMode double-invokes effects. The SDK dedupes; harmless. |

## Options

Only `publisherKey` and `messages` are required.

```jsx
<ZeekendSlot
  publisherKey="pub_live_..."
  messages={messages}
  conversationId={thread.id}
  relevance={0.55}                    // quality floor 0-1
  dimensions={{ maxWidth: 640 }}      // leave one axis unbounded
  blockCategories={['gambling', 'crypto']}
  onNoFill={reason => {}}             // waterfall to another network
/>
```

## Only if the app is not React

Use these when the component genuinely cannot apply. Do not offer them otherwise.

**React Native, or custom rendering.** `useZeekendSlot({ publisherKey, messages })`
returns a `slot`; render it yourself, then call `zk.impression(slot)` from your
own viewability logic and `zk.click(slot)` on click. Keep `slot.disclosure`.

**Vanilla JS.** `Zeekend.client({ publisherKey })` then
`zk.attach({ mount: el, messages })` whenever messages change.

**No build step at all.** `<script src="https://exchange.zeekend.com/z.js"
data-key="pub_test"></script>` before `</body>`. This only works when the app
calls its model from the browser, and it guesses where to place the unit. Prefer
the component whenever React is available.

## What leaves the app

Sent: the user's last message, the assistant's reply on the second pass only,
the publisher key and placement id, coarse locale.

Never sent: user id, email, phone, cookies, device ids, the system prompt, or any
earlier turn. Text is clipped client-side before the request leaves.

## Reference

- Package and full README: https://www.npmjs.com/package/@zeekend/sdk
- API base: https://exchange.zeekend.com/v1
- Health: https://exchange.zeekend.com/v1/health
- Request a publisher key: https://zeekend.com/#for-ai-platforms