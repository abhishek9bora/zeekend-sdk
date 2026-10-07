# Changelog

Every released version, newest first. Releases are also on GitHub with the
same notes, and each npm publish carries a provenance attestation tying the
tarball to the commit it was built from.

## 0.8.0 — 2026-10-06

**Changed: the first turn a placement may appear on is now set from your
dashboard.** `minTurns` defaulted to 2 and was enforced in your app, so turn
one never reached the exchange and a dashboard setting of 1 did nothing: the
dashboard could make the warm-up longer but never shorter. It now defaults to
`null`, the SDK asks on every turn, and the exchange applies your dashboard's
setting. Unset, the exchange still holds the first placement to turn 2, so an
app that changes nothing sees the same pacing as before. `turnGap` and
`maxPerSession` made the same move in 0.6.0.

Turn one now makes a request that the exchange usually declines before any
scoring, which is cheap but visible in your network tab as a `204` with
`x-zeekend-skip: warmup`. Setting `minTurns` here still works: the SDK skips the
turns it holds back, and reports the value so the exchange uses it instead of
its default when your dashboard has none. An app that set `minTurns: 1` (the
generator install does) keeps getting turn one. The turn-2 default applies to
conversations only; an `article` or `feed` request is not held back by it.

**New: `includePrevious`, off by default.** When `true`, a conversation request
also carries the user's previous message, clipped to 500 characters, so a
follow-up like "something classic" can be matched to the watch it is about.
Without it, each request carries only the latest message and the assistant's
reply, and a short follow-up has nothing to match on. It is off because it sends
a turn the SDK otherwise never does, which changes what your privacy notice has
to say. `deriveContext()` now works the previous message out either way;
`trimContext()` is the only place it is sent from, and it drops it unless this
option is on.

**Better: no-fill reasons say which rule held the turn back.** A `204` the
exchange explained (`warmup`, `frequency_cap`, `session_cap`, `paused`) is now
reported to `onNoFill` and the debug log under that name instead of `no_fill`.

**Needs the hosted exchange as of 2026-10-06,** which applies the turn-2 default
to 0.8.0 and later only. Self-hosting an older exchange, this version shows a
placement on turn one unless you set `minTurns: 2`.

## 0.7.1 — 2026-09-29

**Security.** URLs are checked before they reach the browser. `safeUrl()`
parses each one and allows `https:` only; anything else is dropped and the
element is omitted rather than rendered broken. This covers links and images
on cards, catalogue tiles and sponsored lines.

The link path was already closed in practice — `href` reads
`slot.clickUrl || slot.url` and the exchange always sets `clickUrl` — but it
was closed by a value happening to be truthy, not by a check. The image path
was genuinely open: `slot.image` is the advertiser's own string and was used
verbatim.

Note what this does not do: it stops `javascript:` and `data:`, it does not
stop an advertiser choosing which host serves their product image. A product
image legitimately lives on the advertiser's own CDN, so scheme validation is
not and cannot be a same-origin rule.

**Fixed.** A catalogue tile with an image was also given the border meant for
tiles without one.

**Docs.** The README no longer claims "No user data" — a line that contradicted
itself in the same sentence. It now states plainly that conversation text
reaches us, that `trimContext()` truncates rather than scrubbing, that Anthropic
processes the text as our sub-processor, and what `npx @zeekend/sdk init`
writes to your project.

## 0.7.0 — 2026-09-24

`serve()` renders a sponsored line instead of quietly drawing a card. An inline
placement previously fell through to the card renderer and never read
`slot.inline`.

`readableColors()` now picks the accent colour as well as text, so an
advertiser's claim stays readable on a dark host page.

## 0.6.0 — 2026-09-24

`turnGap` and `maxPerSession` default to `null`: the SDK sends neither and the
exchange applies the publisher's own dashboard settings. Previously the SDK
paced itself before making a request, so a dashboard control could only ever
tighten pacing, never loosen it. `minTurns` stays client-side.

## 0.5.4 and earlier

See the GitHub releases.
