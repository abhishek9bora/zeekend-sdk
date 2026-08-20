/**
 * @zeekend/react 0.3.0
 * React bindings. All the logic lives in @zeekend/sdk; this is lifecycle only.
 *
 * The whole integration:
 *
 *   import { ZeekendSlot } from '@zeekend/sdk/react'
 *
 *   <ZeekendSlot publisherKey="pub_live_..." messages={messages} />
 *
 * Drop it under your message list. It reads your existing messages array,
 * works out the turn boundary itself, fires the auction on the user's question
 * while your model is still streaming, and renders only when something fits,
 * which is a minority of turns.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Zeekend, deriveContext } from './zeekend.js';

const Ctx = createContext(null);

/** Optional. Use it to set config once for many slots. */
export function ZeekendProvider({ children, ...config }) {
  const client = useMemo(() => Zeekend.client(config), [config.publisherKey]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useZeekend(config) {
  const fromCtx = useContext(Ctx);
  // Zeekend.client caches by publisher key, so a slot used without a provider
  // still shares one client and one set of pacing counters.
  const own = useMemo(
    () => (fromCtx ? null : Zeekend.client(config || {})),
    [fromCtx, config && config.publisherKey]
  );
  const client = fromCtx || own;
  if (!client) { throw new Error('[zeekend] pass publisherKey, or wrap in <ZeekendProvider>'); }
  return client;
}

/**
 * Props
 *   messages       your existing array. [{role, content}] and most common
 *                  variants. Everything else is derived from it.
 *   publisherKey   required unless you used <ZeekendProvider>
 *   conversationId optional, ties follow-up turns together
 *   placementId    optional, names this slot in your reporting
 *   dimensions     optional, { maxWidth, maxHeight }. Leave one axis unbounded
 *                  so more formats stay eligible and fill stays up.
 *   onNoFill       optional, for waterfalling to another network
 *
 * Streaming needs no handling. Phase one fires the moment a new question
 * appears. Phase two waits until the assistant's text stops changing.
 */
export function ZeekendSlot({
  messages, publisherKey, conversationId, placementId = 'chat-main',
  dimensions, theme, onFill, onNoFill, className, settleMs = 700, ...rest
}) {
  /* The unit renders into this component's own div, so where you place
     <ZeekendSlot> is where the ad appears. Put it AFTER your message list, not
     inside it, or the ad will sit above an answer that is still streaming. */
  const zk = useZeekend({ publisherKey, ...rest });
  const mountRef = useRef(null);
  const turnRef = useRef(null);
  const askedFor = useRef(null);
  const answeredFor = useRef(null);

  const derived = useMemo(
    () => deriveContext(messages, conversationId),
    [messages, conversationId]
  );
  const turnId = derived && derived.turnId;
  const question = derived && derived.context.question;
  const answer = derived && derived.context.answer;

  // Phase 1 — on the question, before the answer exists. Races your stream.
  useEffect(() => {
    if (!turnId || !mountRef.current || askedFor.current === turnId) { return; }
    askedFor.current = turnId;

    if (turnRef.current) { turnRef.current.destroy(); }
    turnRef.current = zk.serve({
      mount: mountRef.current,
      placementId, question, conversationId, dimensions, theme, onFill, onNoFill
    });
  }, [turnId]);

  // Phase 2 — only once the assistant's text has stopped changing, and only if
  // phase 1 came back empty. Debouncing is what removes streaming from the
  // integrator's hands entirely.
  useEffect(() => {
    if (!turnId || !answer || answeredFor.current === turnId) { return; }
    const t = setTimeout(() => {
      if (answeredFor.current === turnId || !turnRef.current) { return; }
      answeredFor.current = turnId;
      turnRef.current.answer(answer);
    }, settleMs);
    return () => clearTimeout(t);
  }, [turnId, answer, settleMs]);

  useEffect(() => () => { if (turnRef.current) { turnRef.current.destroy(); } }, []);

  return <div ref={mountRef} className={className} />;
}

/** Headless. You render, we decide. Same derivation, no DOM. */
export function useZeekendSlot({ messages, publisherKey, conversationId, placementId, dimensions, settleMs = 700, ...rest }) {
  const zk = useZeekend({ publisherKey, ...rest });
  const [slot, setSlot] = useState(null);
  const [reason, setReason] = useState(null);
  const askedFor = useRef(null);
  const answeredFor = useRef(null);

  const derived = useMemo(() => deriveContext(messages, conversationId), [messages, conversationId]);
  const turnId = derived && derived.turnId;

  useEffect(() => {
    if (!turnId || askedFor.current === turnId) { return; }
    askedFor.current = turnId;
    setSlot(null); setReason(null);
    zk.request({
      placementId, dimensions,
      context: { ...derived.context, answer: null }
    }).then(r => { setSlot(r.slot); setReason(r.reason); });
  }, [turnId]);

  useEffect(() => {
    if (!turnId || !derived || !derived.context.answer || slot || answeredFor.current === turnId) { return; }
    const t = setTimeout(() => {
      answeredFor.current = turnId;
      zk.request({ placementId, dimensions, _secondPass: true, context: derived.context })
        .then(r => { if (r.slot) { setSlot(r.slot); } else { setReason(r.reason); } });
    }, settleMs);
    return () => clearTimeout(t);
  }, [turnId, derived && derived.context.answer]);

  return { slot, reason, zk };
}