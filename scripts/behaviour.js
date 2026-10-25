// What serve() does, not only that it loads. Runs in a simulated browser
// (jsdom, a dev dependency; nothing here ships) against a fake transport, so
// no request leaves the machine.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

const { Zeekend } = await import('../sdk/zeekend.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slot = n => ({ slotId: 'slot_' + n, format: 'card', advertiser: 'Brand ' + n, headline: 'Ad ' + n,
  body: 'b', price: '$1', image: null, cta: 'View', url: 'https://example.com',
  clickUrl: 'https://example.com', disclosure: 'Sponsored' });
const units = el => el.querySelectorAll('[data-zeekend-slot]').length;
const fail = msg => { throw new Error(msg); };

/* One ad per question. The first ad waits up to four seconds to be drawn when
   its mount is empty, so the assistant's answer can arrive during that wait.
   0.8.0 fetched a second ad then and drew both. */
{
  let calls = 0;
  const zk = Zeekend.client({ publisherKey: 'pub_live_behaviour_double', transport: async () => slot(++calls) });
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const turn = zk.serve({ mount, question: 'which laptop should I buy?' });
  await turn.first;
  await turn.answer('Here are three good laptops.');
  await sleep(4300);
  if (calls !== 1) fail(`one question made ${calls} requests; the answer pass must not run once the first has an ad`);
  if (units(mount) !== 1) fail(`one question drew ${units(mount)} ads`);
}

/* The answer pass still runs when the question pass found nothing. */
{
  let calls = 0;
  const zk = Zeekend.client({ publisherKey: 'pub_live_behaviour_second',
    transport: async () => (++calls === 1 ? { skipped: 'no_fill' } : slot(calls)) });
  const mount = document.createElement('div');
  mount.textContent = 'assistant answer';
  document.body.appendChild(mount);
  const turn = zk.serve({ mount, question: 'which laptop should I buy?' });
  await turn.first;
  await turn.answer('Here are three good laptops.');
  if (calls !== 2) fail(`an empty first pass should be followed by an answer pass; saw ${calls} requests`);
  if (units(mount) !== 1) fail(`the answer pass drew ${units(mount)} ads`);
}

/* destroy() before the first ad comes back must not stop it being drawn.
   React's Strict Mode unmounts and remounts every component once in
   development; <ZeekendSlot> destroys its turn on that unmount and does not
   ask again on the remount, so the ad it shows is this pending one. A
   destroy() that cancelled it would leave every local build with no ad. */
{
  const zk = Zeekend.client({ publisherKey: 'pub_live_behaviour_strict',
    transport: async () => { await sleep(30); return slot(1); } });
  const mount = document.createElement('div');
  mount.textContent = 'assistant answer';
  document.body.appendChild(mount);
  const turn = zk.serve({ mount, question: 'which laptop should I buy?' });
  turn.destroy();
  await turn.first;
  await sleep(200);
  if (units(mount) !== 1) fail('an ad pending at destroy() was not drawn; React Strict Mode would show nothing');
}

/* No relevance floor unless the publisher sets one. Until 0.8.2 every
   request carried 0.55, which overruled each campaign's own lower cutoff. */
{
  const sent = [];
  const zk = Zeekend.client({ publisherKey: 'pub_live_behaviour_relevance', transport: async (p) => { sent.push(p); return { skipped: 'no_fill' }; } });
  await zk.request({ context: { type: 'conversation', question: 'which laptop?' } });
  if ('relevance' in sent[0] && sent[0].relevance !== undefined) fail(`a request with no floor set sent relevance ${sent[0].relevance}`);
  await zk.request({ relevance: 0.7, context: { type: 'conversation', question: 'which laptop?' } });
  if (sent[1].relevance !== 0.7) fail(`a per-request floor of 0.7 was sent as ${sent[1].relevance}`);
  const strict = Zeekend.client({ publisherKey: 'pub_live_behaviour_relevance_cfg', relevance: 0.6, transport: async (p) => { sent.push(p); return { skipped: 'no_fill' }; } });
  await strict.request({ context: { type: 'conversation', question: 'which laptop?' } });
  if (sent[2].relevance !== 0.6) fail(`a configured floor of 0.6 was sent as ${sent[2].relevance}`);
}

console.log('ok: one ad per question, answer pass on an empty first pass, pending ad survives destroy(), relevance sent only when set');
process.exit(0);
