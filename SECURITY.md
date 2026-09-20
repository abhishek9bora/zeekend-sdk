# Security

This SDK runs inside publishers' apps and reads the conversation it is placed
next to. That is a position of trust, so it is worth being precise about what
it does and how to reach us if it does something else.

**What it sends:** the last user question, optionally the finished answer, the
publisher key, a conversation id the SDK makes up, and the formats the app
accepts. Nothing else. No identity, no cookies, no storage that outlives the
page. `sdk/zeekend.js` is short and uncompressed; the request body is built in
one place and you are encouraged to read it.

**Reporting a vulnerability:** email hello@zeekend.com with "security" in the
subject. We reply within two business days, and we will not take action
against good-faith research.

**Verifying a release:** every version from 0.5.1 on is published from this
repository by GitHub Actions through npm trusted publishing, with provenance. The npm page shows the exact
commit a version was built from; `npm audit signatures` checks it locally.
