/**
 * @zeekend/sdk — auto install
 *
 *   <script src="https://exchange.zeekend.com/z.js" data-key="pub_test"></script>
 *
 * That is the entire integration. No imports, no component, no messages array,
 * no knowledge of how the app is built. Paste one line into index.html.
 *
 * How it works, so nobody has to trust magic:
 *
 *  1. It wraps window.fetch and watches for a request body containing a
 *     messages array of {role, content}. Practically every AI chat app POSTs
 *     exactly that to its own backend, so we read the conversation from the
 *     app's own traffic instead of scraping the screen.
 *  2. It finds the element the conversation is rendering into: the scrollable
 *     container that gains children as messages arrive.
 *  3. It calls the normal SDK from there.
 *
 * Every step fails silently into doing nothing. A broken guess must never break
 * somebody's product.
 *
 * Escape hatches, as data attributes on the script tag:
 *   data-key       required, publisher key
 *   data-mount     CSS selector for where the ad should go
 *   data-relevance quality floor, 0-1
 *   data-endpoint  a self-hosted exchange
 *   data-debug     "1" for verbose logging
 */

(function () {
  var script = document.currentScript ||
    (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  if (!script) { return; }

  var cfg = {
    publisherKey: script.getAttribute('data-key'),
    endpoint: script.getAttribute('data-endpoint') || 'https://exchange.zeekend.com/v1',
    mount: script.getAttribute('data-mount'),
    relevance: parseFloat(script.getAttribute('data-relevance')) || undefined,
    debug: script.getAttribute('data-debug') === '1',
    /* Dashboard reporting, which this tag previously had no way to switch on
       at all — so a script-tag publisher saw ads serve and bill normally
       while their dashboard sat at zero impressions forever, with nothing
       explaining why.

       Defaults to data-key because a key minted through the publisher
       dashboard is the same value on both sides. data-app-key stays available
       for the case where they differ. If the key isn't one the dashboard
       recognises (a sandbox key, or one issued straight from the exchange),
       that call 401s and is swallowed — trackEvent is deliberately
       fire-and-forget, and never affects what ad shows or what gets billed. */
    zeekendAppKey: script.getAttribute('data-app-key') || script.getAttribute('data-key'),
    trackingEndpoint: script.getAttribute('data-tracking-endpoint') || undefined
  };

  if (!cfg.publisherKey) {
    console.warn('[zeekend] no data-key on the script tag. Nothing will load.\n' +
      '  <script src="..." data-key="pub_test"></script>');
    return;
  }

  var sdkUrl = script.src.replace(/[^/]*$/, 'zeekend.js');
  var zk = null, messages = null, mountEl = null, sawTraffic = false;

  function log() {
    if (cfg.debug) { console.log.apply(console, ['[zeekend:auto]'].concat([].slice.call(arguments))); }
  }

  /* ---------------------------------------------------------------- *
   * 1. Read the conversation from the app's own network traffic.
   *    Far more reliable than reading the screen: we get real roles and
   *    real text instead of guessing from markup.
   * ---------------------------------------------------------------- */
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var body = (init && init.body) || (input && input.body);
      if (typeof body === 'string' && body.indexOf('"role"') !== -1) {
        var parsed = JSON.parse(body);
        var found = findMessages(parsed);
        if (found && found.length) {
          sawTraffic = true;
          messages = found;
          log('captured', found.length, 'messages');
          setTimeout(tick, 0);
        }
      }
    } catch (e) { /* never let our parsing break their request */ }
    return origFetch.apply(this, arguments);
  };

  /** Depth-first search for the messages array, wherever they nested it. */
  function findMessages(obj, depth) {
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 4) { return null; }
    if (Array.isArray(obj)) {
      var ok = obj.length && obj.every(function (m) {
        return m && typeof m === 'object' && (m.role || m.from) &&
          (typeof m.content === 'string' || typeof m.text === 'string' || Array.isArray(m.content));
      });
      if (ok) { return obj; }
      for (var i = 0; i < obj.length; i++) {
        var r = findMessages(obj[i], depth + 1);
        if (r) { return r; }
      }
      return null;
    }
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        var f = findMessages(obj[k], depth + 1);
        if (f) { return f; }
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * 2. Find where the conversation is rendering.
   * ---------------------------------------------------------------- */
  function findMount() {
    if (cfg.mount) { return document.querySelector(cfg.mount); }

    // The chat thread is the scrollable element with the most direct children
    // and real height. Crude, but it is the right element in almost every
    // chat UI, and being wrong only means the ad lands somewhere odd.
    var best = null, bestScore = 0;
    var all = document.querySelectorAll('div, main, section, ul, ol');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var kids = el.children.length;
      if (kids < 2) { continue; }
      var style = getComputedStyle(el);
      var scrolls = /auto|scroll/.test(style.overflowY);
      var h = el.clientHeight;
      if (h < 150) { continue; }
      var score = kids * (scrolls ? 3 : 1) + (h / 100);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- *
   * 3. Hand off to the normal SDK.
   * ---------------------------------------------------------------- */
  function tick() {
    if (!zk || !messages) { return; }
    var target = mountEl && document.contains(mountEl) ? mountEl : (mountEl = findMount());
    if (!target) { log('no mount point found yet'); return; }
    // Place under the newest message rather than at the end of the container,
    // so the unit sits with the answer it belongs to.
    var anchor = target.lastElementChild || target;
    zk.attach({ mount: anchor, messages: messages, placementId: 'auto' });
  }

  var s = document.createElement('script');
  s.type = 'module';
  s.textContent =
    'import { Zeekend } from "' + sdkUrl + '";' +
    'window.__zkReady(Zeekend);';
  window.__zkReady = function (Zeekend) {
    /* Only pass what was actually configured. The SDK merges with
       Object.assign semantics, which copies undefined over a default rather
       than falling back to it — so handing it `relevance: undefined` sets
       relevance to undefined instead of leaving 0.55 in place. That is how
       every script-tag publisher has been running with no relevance floor:
       the auction reads Number(undefined) as NaN and falls back to 0. */
    var clientCfg = {
      publisherKey: cfg.publisherKey,
      endpoint: cfg.endpoint,
      debug: cfg.debug,
      zeekendAppKey: cfg.zeekendAppKey
    };
    if (cfg.relevance !== undefined) { clientCfg.relevance = cfg.relevance; }
    if (cfg.trackingEndpoint) { clientCfg.trackingEndpoint = cfg.trackingEndpoint; }

    zk = Zeekend.client(clientCfg);
    log('ready');
    tick();
  };
  document.head.appendChild(s);

  /* If nothing ever arrives, say so. Silence is the worst outcome: the
     integrator concludes our matching is bad when in fact we never ran. */
  setTimeout(function () {
    if (sawTraffic) { return; }
    console.warn('[zeekend] installed, but no conversation traffic seen in 45s.\n' +
      '  This happens when the app talks to its model from the server rather than\n' +
      '  the browser. Use the component instead:\n' +
      '    <ZeekendSlot publisherKey="' + cfg.publisherKey + '" messages={messages} />\n' +
      '  Docs: https://exchange.zeekend.com/skill.md');
  }, 45000);
})();
