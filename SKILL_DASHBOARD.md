---
name: zeekend-dashboard
description: Install the Zeekend SDK to show sponsored product placements inside an AI chat app, AND wire it to the Zeekend Publisher dashboard so every impression/click reports there live. Use this instead of skill.md whenever the user also wants dashboard reporting. Triggers on "Zeekend", "zeekend.com", "@zeekend/sdk", "monetize my AI app", "add ads to my chatbot", "zeekend dashboard", "publisher dashboard", "publisher.zeekend.com".
---

# Zeekend integration, with dashboard reporting

Zeekend places sponsored products inside AI conversations. The auction fires on
the user's question and runs while the model streams, so a placement adds nothing
to how long the user waits. Nothing fills on most turns, by design.

This skill wires up BOTH halves in one pass:

1. **Ad serving** — the same integration as `skill.md`, unchanged.
2. **Dashboard reporting** — every request/impression/click also reports to
   https://publisher.zeekend.com, so the user can watch it happen on their own
   dashboard without touching anything after this.

There is one integration. Do not improvise another. Do not do the two halves as
separate follow-up tasks — gather both keys up front (Step 1) so you only touch
the component once.

## Step 1 — Two keys, gathered together

Ask the user for both before writing any code:

1. **Publisher key** (`pub_live_...`) — controls what ad shows and who gets billed.
   **If they don't have one, use `pub_test` and continue.** Sandbox: no signup,
   fills on almost every turn, bills nobody. A live key comes from
   https://zeekend.com.

2. **Publisher app key** — a separate credential that makes activity show up on
   https://publisher.zeekend.com. It does not look like `pub_...`; it's the
   "PUBLISHER APP KEY" shown on that dashboard's `/apps` page.
   - **If they don't have one:** tell them to open https://publisher.zeekend.com,
     sign in with Google, create an app (any name — usually the chatbot's name),
     and paste back the key shown there. This step needs a human in a browser;
     you cannot generate or fetch this key yourself. Wait for it.
   - **If they'd rather skip dashboard reporting:** that's fine — continue with
     only the publisher key. Ad serving works identically either way; they just
     won't see anything on that dashboard. Do not push them to sign up.

Do not proceed to Step 4 until you have an answer (a real key, `pub_test`, or an
explicit "skip it") for both.

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

Do not set an `endpoint` or `trackingEndpoint`. Both default to production.

## Step 4 — Add one component, both keys

```jsx
import { ZeekendSlot } from '@zeekend/sdk/react'

<ZeekendSlot
  publisherKey={process.env.NEXT_PUBLIC_ZEEKEND_KEY}
  zeekendAppKey={process.env.NEXT_PUBLIC_ZEEKEND_APP_KEY}
  messages={messages}
/>
```

Set both env vars from the two keys gathered in Step 1. If the user chose to
skip dashboard reporting, omit the `zeekendAppKey` prop and its env var entirely
— do not pass an empty string, `undefined`, or a placeholder. The two keys are
independent: `zeekendAppKey` never affects what ad shows or what gets billed,
it only decides whether this app's activity is also mirrored to the dashboard.

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
- Do not invent a dashboard key or reuse the publisher key for `zeekendAppKey`.
  They are different credentials from different systems; a wrong value there
  fails silently (dashboard just never updates), so if unsure, ask again rather
  than guess.

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
8. **If a `zeekendAppKey` was set:** tell the user to open
   https://publisher.zeekend.com/dashboard and reload it after the ad on turn
   two has been visible for a couple of seconds. Their app's row should update.
   You cannot check this yourself — it's on their account, in their browser —
   so ask them to confirm it, the same way you'd ask them to confirm a UI looks
   right.

Only report the integration complete after steps 4, 6, and (if applicable) 8 pass.

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
| Ads work, dashboard never updates | `zeekendAppKey` missing, wrong, or swapped with `publisherKey`. Check the `/apps` page for the correct value. This never affects ad serving — it's a separate, silent-failing call. |
| Dashboard shows the app but zero activity | The user probably didn't wait a full second on the ad before checking, or hasn't reloaded the dashboard page since. Both counts only update after a genuine 1-second-visible impression, and the page doesn't auto-refresh. |

## Options

Only `publisherKey` and `messages` are required. `zeekendAppKey` is optional and
purely additive — see Step 1.

```jsx
<ZeekendSlot
  publisherKey="pub_live_..."
  zeekendAppKey="..."                 // optional — see Step 1
  messages={messages}
  conversationId={thread.id}
  relevance={0.55}                    // quality floor 0-1
  dimensions={{ maxWidth: 640 }}      // leave one axis unbounded
  blockCategories={['gambling', 'crypto']}
  onNoFill={reason => {}}             // waterfall to another network
/>
```

`trackingEndpoint` (default `https://publisher.zeekend.com`) exists only for
local development against a self-hosted zeekend-publisher instance. Never set
it in production.

## Only if the app is not React

Use these when the component genuinely cannot apply. Do not offer them otherwise.
`zeekendAppKey` works identically in every variant below — pass it in the same
config object as `publisherKey`.

**React Native, or custom rendering.**
`useZeekendSlot({ publisherKey, zeekendAppKey, messages })` returns a `slot`;
render it yourself, then call `zk.impression(slot)` from your own viewability
logic and `zk.click(slot)` on click. Keep `slot.disclosure`.

**Vanilla JS.** `Zeekend.client({ publisherKey, zeekendAppKey })` then
`zk.attach({ mount: el, messages })` whenever messages change.

**No build step at all.** The `data-` script tag (`z.js`) only supports
`publisherKey`, not `zeekendAppKey` — there is no way to add dashboard
reporting to that path. If the user needs dashboard reporting and has no build
step, say so plainly rather than silently dropping the dashboard half.

## What leaves the app

To the exchange (ad serving, always): the user's last message, the assistant's
reply on the second pass only, the publisher key and placement id, coarse locale.

To the dashboard (only if `zeekendAppKey` is set): the event type
(request/impression/click), placement id, advertiser name, and ad headline —
never the user's message or reply, and never any pricing.

Never sent anywhere: user id, email, phone, cookies, device ids, the system
prompt, or any earlier turn. Text is clipped client-side before any request
leaves.

## Reference

- Package and full README: https://www.npmjs.com/package/@zeekend/sdk
- API base: https://exchange.zeekend.com/v1
- Health: https://exchange.zeekend.com/v1/health
- Request a publisher key: https://zeekend.com/#for-ai-platforms
- Publisher dashboard / get a dashboard app key: https://publisher.zeekend.com
- Ad-serving-only version of this skill (no dashboard): https://exchange.zeekend.com/skill.md
