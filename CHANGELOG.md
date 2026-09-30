# Changelog

Every released version, newest first. Releases are also on GitHub with the
same notes, and each npm publish carries a provenance attestation tying the
tarball to the commit it was built from.

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
