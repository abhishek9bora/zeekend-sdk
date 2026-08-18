/**
 * @zeekend/sdk 0.2.0
 * Sponsored product placements for conversational apps.
 *
 * Zero dependencies. Browser, Node 18+, React Native. Wherever fetch exists.
 *
 *   const zk = Zeekend.init({ publisherKey: 'pub_live_...' })
 *   const turn = zk.serve({ mount: el, question, conversationId })
 *   // when your assistant finishes streaming:
 *   turn.answer(finalText)
 *
 * Design rules this file enforces, in order of how much they matter:
 *
 *  1. Never block the host app. Every path fails open and renders nothing.
 *  2. Request on the QUESTION, before the answer exists. The auction runs
 *     while your model streams, so the placement costs zero perceived latency.
 *  3. No fill is the normal outcome, not an error, and the two are never
 *     conflated. Check health() to tell them apart.
 *  4. An impression is 50% of the unit visible for one continuous second.
 *     Rendering is not an impression. Prefetching is never an impression.
 *  5. Disclosure is not configurable. You can restyle the unit; you cannot
 *     remove the label that says it is sponsored.
 */

var VERSION = '0.2.0';

var DEFAULTS = {
  endpoint: 'https://exchange.zeekend.com/v1',

  // Publisher-side quality floor, 0 to 1. Higher means fewer, better matches
  // and a lower fill rate. This is the single most consequential setting in
  // this file. Start at 0.55 and move it based on your own numbers.
  relevance: 0.55,

  // Pacing. A conversational app that shows an ad on turn one has already lost.
  minTurns: 2,          // no placement before the conversation warms up
  turnGap: 2,           // user turns that must pass between two placements
  maxPerSession: 3,

  // Brand safety, enforced server-side. Send whatever you would refuse to
  // have appear inside your product.
  blockCategories: [],  // e.g. ['gambling','crypto','supplements','politics']
  blockAdvertisers: [], // e.g. ['competitor.com']

  /* Hard ceiling on the auction. Generous on purpose: the request fires on the
     user's question and races your model's stream, so nothing is waiting on it.
     A late ad renders a beat after the answer; an aborted one renders never.
     Only tighten this if you are calling requestPlacement somewhere that
     genuinely blocks your UI, which serve() never does. */
  timeoutMs: 8000,
  cacheTtlMs: 90000,    // identical requests inside this window reuse the result
  debug: false,
  transport: null       // override for tests and self-hosted exchanges
};

var VALID_CONTEXT = ['conversation', 'article', 'feed', 'static'];

function Zeekend() {}
Zeekend.version = VERSION;

Zeekend.init = function init(config) {
  var cfg = assign({}, DEFAULTS, config || {});
  if (!cfg.publisherKey && !cfg.transport) {
    throw new Error('[zeekend] publisherKey is required. Get one at https://zeekend.com');
  }
  if (/YOUR_|xxx|placeholder|pub_live_\.\.\./i.test(String(cfg.publisherKey))) {
    throw new Error('[zeekend] publisherKey looks like a placeholder: "' +
      cfg.publisherKey + '". Nothing will ever fill with this value.');
  }

  var state = {
    sessionId: cfg.sessionId || rid('ses'),
    turns: 0,
    lastFilledTurn: -999,
    shown: 0
  };

  // Separate counters, because a network that cannot tell "nothing matched"
  // from "we are broken" will report a healthy fill rate while dead.
  var health = { requests: 0, fills: 0, noFills: 0, errors: 0, timeouts: 0, latencies: [] };
  var cache = {};
  var seen = {};   // slotId -> { impression: bool, click: bool }

  function log() {
    if (cfg.debug && typeof console !== 'undefined') {
      console.log.apply(console, ['[zeekend]'].concat(slice(arguments)));
    }
  }

  /* Warnings are NOT gated behind debug. A misconfigured endpoint produces the
     same visible result as a quiet one — no ad — so if we stay silent the
     integrator concludes our matching is bad and removes the SDK. Say it once,
     loudly, with the fix in the message. */
  var warned = {};
  function warnOnce(key, msg) {
    if (warned[key] || typeof console === 'undefined') { return; }
    warned[key] = true;
    console.warn('[zeekend] ' + msg);
  }

  /* ------------------------------------------------------------------ *
   * request — the primitive. Everything else is sugar on top.
   * Returns { slot, reason }. slot is null far more often than not.
   * ------------------------------------------------------------------ */
  function request(opts) {
    opts = opts || {};
    var context = opts.context || { type: 'static' };

    if (VALID_CONTEXT.indexOf(context.type) === -1) {
      return Promise.resolve(skip('bad_context'));
    }

    // Prefetch warms the cache without touching pacing counters or billing.
    var prefetch = !!opts.prefetch;

    if (!prefetch) {
      if (!opts._secondPass) { state.turns += 1; }
      if (state.turns < cfg.minTurns) { return Promise.resolve(skip('warmup')); }
      if (state.turns - state.lastFilledTurn < cfg.turnGap) { return Promise.resolve(skip('frequency_cap')); }
      if (state.shown >= cfg.maxPerSession) { return Promise.resolve(skip('session_cap')); }
    }

    var payload = {
      v: VERSION,
      publisherKey: cfg.publisherKey,
      sessionId: state.sessionId,
      placementId: opts.placementId || 'default',
      turn: state.turns,
      context: trimContext(context),
      dimensions: opts.dimensions || null,   // you give room, we pick the format
      relevance: opts.relevance != null ? opts.relevance : cfg.relevance,
      blockCategories: cfg.blockCategories,
      blockAdvertisers: cfg.blockAdvertisers,
      prefetch: prefetch,
      locale: safeLocale()
    };

    var key = cacheKey(payload);
    var hit = cache[key];
    if (hit && Date.now() - hit.t < cfg.cacheTtlMs) {
      log('cache hit', opts.placementId);
      return Promise.resolve(hit.slot ? fill(hit.slot, prefetch) : skip('no_fill'));
    }

    var t0 = nowMs();
    health.requests += 1;

    return send(payload)
      .then(function (slot) {
        health.latencies.push(nowMs() - t0);
        cache[key] = { t: Date.now(), slot: slot };
        if (!slot) { health.noFills += 1; return skip('no_fill'); }
        health.fills += 1;
        return fill(slot, prefetch);
      })
      .catch(function (err) {
        var timedOut = err && (err.name === 'AbortError' || err.message === 'timeout');
        if (timedOut) { health.timeouts += 1; } else { health.errors += 1; }
        log('request failed, failing open:', err && err.message);
        return skip(timedOut ? 'timeout' : 'error');
      });
  }

  function fill(slot, prefetch) {
    if (!prefetch) {
      state.lastFilledTurn = state.turns;
      state.shown += 1;
    }
    return { slot: slot, reason: null };
  }
  function skip(reason) { log('skip', reason); return { slot: null, reason: reason }; }

  /* ------------------------------------------------------------------ *
   * serve — the two-phase call most apps should use.
   *
   * Phase 1 fires the moment the user hits enter, matching on the question
   * alone. The auction runs while your model streams, so the slot is decided
   * before the answer finishes. Phase 2 only runs if phase 1 came back empty,
   * because the assistant's answer is often where the buying signal actually
   * appears ("your coating is worn through" beats the question that preceded
   * it). The second render replaces the first.
   * ------------------------------------------------------------------ */
  function serve(opts) {
    opts = opts || {};
    var mount = opts.mount;
    var el = null;
    var settled = false;

    var base = {
      placementId: opts.placementId || 'default',
      dimensions: opts.dimensions,
      relevance: opts.relevance
    };

    var first = request(assign({}, base, {
      context: {
        type: 'conversation',
        question: opts.question,
        answer: null,
        conversationId: opts.conversationId
      }
    })).then(function (r) {
      if (r.slot && mount) { settled = true; el = render(r.slot, mount, opts); }
      if (opts.onFill && r.slot) { opts.onFill(r.slot); }
      if (opts.onNoFill && !r.slot) { opts.onNoFill(r.reason); }
      return r;
    });

    return {
      first: first,

      /** Call when your assistant's answer is complete. Second shot at the slot. */
      answer: function (answerText) {
        return first.then(function (r) {
          if (settled) { return r; }        // already filled on the question
          return request(assign({}, base, {
            _secondPass: true,
            context: {
              type: 'conversation',
              question: opts.question,
              answer: answerText,
              conversationId: opts.conversationId
            }
          })).then(function (r2) {
            if (r2.slot && mount) { settled = true; el = render(r2.slot, mount, opts); }
            if (opts.onFill && r2.slot) { opts.onFill(r2.slot); }
            if (opts.onNoFill && !r2.slot) { opts.onNoFill(r2.reason); }
            return r2;
          });
        });
      },

      /** Remove the unit, e.g. when the user edits or regenerates the turn. */
      destroy: function () { if (el && el.parentNode) { el.parentNode.removeChild(el); } el = null; }
    };
  }

  /* ------------------------------------------------------------------ *
   * Events. All idempotent client-side and server-side. A slot can bill
   * exactly one impression and one click, ever.
   * ------------------------------------------------------------------ */
  function impression(slot) { return once(slot, 'impression'); }
  function click(slot) { return once(slot, 'click'); }
  function report(slot, reason) { return beacon('report', slot, { reason: reason || 'unspecified' }); }

  function once(slot, type) {
    var s = seen[slot.slotId] || (seen[slot.slotId] = {});
    if (s[type]) { return Promise.resolve(); }
    s[type] = true;
    return beacon(type, slot);
  }

  function beacon(type, slot, extra) {
    var body = assign({
      type: type, slotId: slot.slotId, publisherKey: cfg.publisherKey,
      sessionId: state.sessionId, ts: Date.now()
    }, extra || {});

    if (cfg.transport) { return Promise.resolve(cfg.transport(assign({ event: true }, body))); }
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(cfg.endpoint + '/event', new Blob([JSON.stringify(body)],
          { type: 'application/json' }));
        return Promise.resolve();
      } catch (e) { /* fall through */ }
    }
    return post(cfg.endpoint + '/event', body, cfg.timeoutMs)['catch'](function () {});
  }

  /* ------------------------------------------------------------------ *
   * render — the default unit. Replace it freely; it is deliberately plain.
   * If you build your own, call impression() on visibility and click() on
   * click, and keep the disclosure line.
   * ------------------------------------------------------------------ */
  function render(slot, mount, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') { return null; }
    var t = assign({
      accent: '#c2410c', text: 'inherit', muted: '#6b7280',
      border: 'rgba(120,120,120,.28)', radius: '10px'
    }, opts.theme || {});

    var wrap = el('div');
    wrap.setAttribute('data-zeekend-slot', slot.slotId);
    wrap.style.cssText = 'margin-top:12px;border:1px solid ' + t.border + ';border-radius:' +
      t.radius + ';padding:10px 12px;font:inherit;line-height:1.45;position:relative;';

    // Disclosure. Not optional, not restylable away.
    var lbl = el('div');
    lbl.textContent = slot.disclosure || 'Sponsored';
    lbl.style.cssText = 'font-size:10px;letter-spacing:.12em;text-transform:uppercase;' +
      'opacity:.6;margin-bottom:6px;';
    wrap.appendChild(lbl);

    if (slot.format === 'catalog' && slot.items && slot.items.length) {
      // The copy is the point. A bare row of product tiles tells the reader
      // nothing about why these appeared in this conversation.
      if (slot.headline) { wrap.appendChild(text('div', slot.headline, 'font-weight:600;')); }
      if (slot.body) { wrap.appendChild(text('div', slot.body, 'opacity:.75;margin:2px 0 9px;font-size:.95em;')); }
      wrap.appendChild(catalog(slot, t));
      if (slot.advertiser) {
        wrap.appendChild(text('div', slot.advertiser,
          'font-size:11px;opacity:.5;margin-top:7px;color:' + t.muted + ';'));
      }
    } else {
      wrap.appendChild(card(slot, t));
    }

    // "Report this ad". Cheap, and it is the clearest signal to your users
    // that you did not sell them out.
    var rep = el('button');
    rep.textContent = 'Report';
    rep.setAttribute('aria-label', 'Report this ad');
    rep.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:0;' +
      'font:inherit;font-size:10px;opacity:.4;cursor:pointer;color:' + t.muted + ';';
    rep.onclick = function () { report(slot, 'user'); rep.textContent = 'Reported'; rep.disabled = true; };
    wrap.appendChild(rep);

    (mount || document.body).appendChild(wrap);
    observe(wrap, function () { impression(slot); });
    return wrap;
  }

  function card(slot, t) {
    var box = el('div');
    box.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';

    if (slot.image) {
      var img = el('img');
      img.src = slot.image; img.alt = '';
      img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:6px;flex:0 0 auto;';
      img.onerror = function () { img.style.display = 'none'; };
      box.appendChild(img);
    }

    var body = el('div');
    body.style.cssText = 'min-width:0;flex:1;';
    body.appendChild(text('div', slot.headline, 'font-weight:600;'));
    if (slot.body) { body.appendChild(text('div', slot.body, 'opacity:.75;margin-top:2px;font-size:.95em;')); }

    var row = el('div');
    row.style.cssText = 'margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
    if (slot.price) { row.appendChild(text('span', slot.price, 'font-weight:600;font-size:.95em;')); }
    row.appendChild(cta(slot, t));
    if (slot.advertiser) {
      row.appendChild(text('span', slot.advertiser, 'font-size:11px;opacity:.5;color:' + t.muted + ';'));
    }
    body.appendChild(row);
    box.appendChild(body);
    return box;
  }

  function catalog(slot, t) {
    var strip = el('div');
    strip.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;' +
      '-webkit-overflow-scrolling:touch;scrollbar-width:thin;';
    slot.items.slice(0, 8).forEach(function (item) {
      var c = el('a');
      c.href = item.clickUrl || slot.clickUrl;
      c.target = '_blank'; c.rel = 'sponsored noopener noreferrer';
      c.style.cssText = 'flex:0 0 132px;text-decoration:none;color:inherit;display:block;' +
        (item.image ? '' : 'border:1px solid ' + t.border + ';border-radius:8px;padding:9px 10px;');
      c.onclick = function () { click(slot); };
      if (item.image) {
        var img = el('img');
        img.src = item.image; img.alt = '';
        img.style.cssText = 'width:132px;height:132px;object-fit:cover;border-radius:6px;display:block;';
        img.onerror = function () { img.style.display = 'none'; };
        c.appendChild(img);
      }
      c.appendChild(text('div', item.title, 'font-size:12px;margin-top:5px;font-weight:600;'));
      if (item.price) { c.appendChild(text('div', item.price, 'font-size:12px;opacity:.7;')); }
      strip.appendChild(c);
    });
    return strip;
  }

  function cta(slot, t) {
    var a = el('a');
    a.href = slot.clickUrl || slot.url;
    a.target = '_blank';
    a.rel = 'sponsored noopener noreferrer';   // never let an ad pass link equity
    a.textContent = slot.cta || 'View';
    a.style.cssText = 'display:inline-block;font-size:12px;text-decoration:none;color:' +
      t.accent + ';border:1px solid ' + t.accent + ';border-radius:6px;padding:3px 10px;';
    a.onclick = function () { click(slot); };
    return a;
  }

  /** Impression fires on 50% visible for one continuous second. IAB standard. */
  function observe(node, fn) {
    if (typeof IntersectionObserver === 'undefined') { fn(); return; }
    var timer = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !timer) {
          timer = setTimeout(function () { fn(); io.disconnect(); }, 1000);
        } else if (!e.isIntersecting && timer) {
          clearTimeout(timer); timer = null;
        }
      });
    }, { threshold: 0.5 });
    io.observe(node);
  }

  /* ------------------------------------------------------------------ */

  function send(payload) {
    if (cfg.transport) { return Promise.resolve(cfg.transport(payload)); }
    return post(cfg.endpoint + '/slot', payload, cfg.timeoutMs);
  }

  /**
   * Call this in your own monitoring. errorRate rising while fillRate looks
   * fine is the failure that costs you a week of not knowing.
   */
  function stats() {
    var L = health.latencies.slice().sort(function (a, b) { return a - b; });
    var answered = health.fills + health.noFills;
    return {
      requests: health.requests,
      fills: health.fills,
      fillRate: answered ? +(health.fills / answered).toFixed(3) : 0,
      errors: health.errors,
      timeouts: health.timeouts,
      errorRate: health.requests ? +((health.errors + health.timeouts) / health.requests).toFixed(3) : 0,
      p50: L.length ? L[Math.floor(L.length / 2)] : 0,
      p95: L.length ? L[Math.floor(L.length * 0.95)] : 0,
      shownThisSession: state.shown,
      version: VERSION
    };
  }

  function reset() {
    state.turns = 0; state.lastFilledTurn = -999; state.shown = 0;
    state.sessionId = rid('ses'); cache = {}; seen = {};
  }

  return {
    request: request, serve: serve, render: render,
    impression: impression, click: click, report: report,
    stats: stats, reset: reset, config: cfg, state: state
  };
};

/* ---------------------------------------------------------------- utils -- */

/**
 * Only the tail of the conversation leaves the app, and only as text. No user
 * ids, no emails, no device fingerprints, no system prompt. If you would not
 * put a field in a screenshot, it does not belong here.
 */
function trimContext(c) {
  var out = { type: c.type };
  if (c.type === 'conversation') {
    out.question = clip(c.question, 2000);
    out.answer = c.answer ? clip(c.answer, 4000) : null;
    if (c.conversationId) { out.conversationId = String(c.conversationId).slice(0, 128); }
  } else if (c.type === 'article') {
    out.title = clip(c.title, 300);
    out.content = clip(c.content, 1000);
    if (c.about) { out.about = clip(c.about, 200); }
  } else if (c.type === 'feed') {
    out.text = clip(c.text, 2000);
    if (c.source) { out.source = clip(c.source, 200); }
    if (c.description) { out.description = clip(c.description, 500); }
  }
  return out;
}

function post(url, body, timeoutMs) {
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctl ? ctl.signal : undefined
  }).then(function (r) {
    if (timer) { clearTimeout(timer); }
    if (r.status === 204) { return null; }         // no fill. not an error.
    if (!r.ok) { throw new Error('http ' + r.status); }
    return r.json();
  }, function (e) {
    if (timer) { clearTimeout(timer); }
    throw e;
  });
}

function cacheKey(p) {
  var c = p.context;
  return [p.placementId, c.type, clip(c.question || c.text || c.title || '', 300),
    c.answer ? 'a' : 'q', p.relevance].join('|');
}

function assign(t) {
  for (var i = 1; i < arguments.length; i++) {
    var s = arguments[i];
    if (!s) { continue; }
    for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) { t[k] = s[k]; } }
  }
  return t;
}
function clip(s, n) { return s == null ? '' : String(s).slice(0, n); }
function slice(a) { return Array.prototype.slice.call(a); }
function rid(p) { return p + '_' + Math.random().toString(36).slice(2, 12); }
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function safeLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || null; } catch (e) { return null; }
}
function el(tag) { return document.createElement(tag); }
function text(tag, str, css) { var n = el(tag); n.textContent = str; n.style.cssText = css; return n; }

if (typeof module !== 'undefined' && module.exports) { module.exports = { Zeekend: Zeekend }; }
if (typeof window !== 'undefined') { window.Zeekend = Zeekend; }
export { Zeekend };
export default Zeekend;