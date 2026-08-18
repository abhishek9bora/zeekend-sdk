/**
 * @zeekend/react 0.2.0
 * React bindings. Thin wrapper over @zeekend/sdk, which holds all the logic.
 *
 *   import { ZeekendProvider, ZeekendSlot } from '@zeekend/react'
 *
 *   <ZeekendProvider publisherKey="pub_live_...">
 *     <App />
 *   </ZeekendProvider>
 *
 *   // under each assistant message:
 *   <ZeekendSlot
 *     turnId={msg.id}
 *     question={msg.question}
 *     answer={msg.streaming ? null : msg.text}
 *     conversationId={thread.id}
 *   />
 */

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Zeekend } from './zeekend.js';

const Ctx = createContext(null);

export function ZeekendProvider({ children, ...config }) {
  // One client for the whole app. Re-initializing per render would reset the
  // pacing counters every time, which is how apps end up showing four ads in
  // one conversation and blaming the network.
  const client = useMemo(() => Zeekend.init(config), [config.publisherKey]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useZeekend() {
  const client = useContext(Ctx);
  if (!client) { throw new Error('[zeekend] useZeekend must be used inside <ZeekendProvider>'); }
  return client;
}

/**
 * Drop-in slot. Renders nothing until a placement fills, which is most of the time.
 *
 * Props
 *   turnId          required, stable per conversation turn. This is the guard
 *                   that stops a streaming answer from firing a request per token.
 *   question        the user's message for this turn
 *   answer          the assistant's reply, or null while streaming
 *   conversationId  optional, ties follow-up turns together
 *   placementId     optional, names this slot in your reporting
 *   dimensions      optional, { maxWidth, maxHeight }. Leave one axis unbounded
 *                   so more formats are eligible and your fill rate stays up.
 *   onNoFill        optional, for waterfalling to another network
 */
export function ZeekendSlot({
  turnId, question, answer = null, conversationId,
  placementId = 'chat-main', dimensions, theme, onFill, onNoFill, className
}) {
  const zk = useZeekend();
  const mountRef = useRef(null);
  const turnRef = useRef(null);
  const requestedTurn = useRef(null);
  const answeredTurn = useRef(null);

  // Phase 1: fire on the question, the instant it exists. The auction runs
  // while your model streams, so the slot is decided before the answer lands.
  useEffect(() => {
    if (!turnId || !question || !mountRef.current) { return; }
    if (requestedTurn.current === turnId) { return; }
    requestedTurn.current = turnId;

    turnRef.current = zk.serve({
      mount: mountRef.current,
      placementId, question, conversationId, dimensions, theme, onFill, onNoFill
    });

    return () => { if (turnRef.current) { turnRef.current.destroy(); } };
  }, [turnId, question]);

  // Phase 2: only if phase 1 came back empty. The assistant's answer is often
  // where the buying signal actually is.
  useEffect(() => {
    if (!answer || answeredTurn.current === turnId || !turnRef.current) { return; }
    answeredTurn.current = turnId;
    turnRef.current.answer(answer);
  }, [turnId, answer]);

  return <div ref={mountRef} className={className} />;
}

/**
 * Headless variant. You render, we decide. Call zk.impression(slot) when your
 * unit becomes visible and zk.click(slot) on click, and keep the disclosure.
 */
export function useZeekendSlot({ turnId, question, answer = null, conversationId, placementId, dimensions }) {
  const zk = useZeekend();
  const [slot, setSlot] = React.useState(null);
  const [reason, setReason] = React.useState(null);
  const requestedTurn = useRef(null);
  const answeredTurn = useRef(null);

  useEffect(() => {
    if (!turnId || !question || requestedTurn.current === turnId) { return; }
    requestedTurn.current = turnId;
    setSlot(null); setReason(null);
    zk.request({
      placementId, dimensions,
      context: { type: 'conversation', question, answer: null, conversationId }
    }).then(r => { setSlot(r.slot); setReason(r.reason); });
  }, [turnId, question]);

  useEffect(() => {
    if (!answer || answeredTurn.current === turnId || slot) { return; }
    answeredTurn.current = turnId;
    zk.request({
      placementId, dimensions, _secondPass: true,
      context: { type: 'conversation', question, answer, conversationId }
    }).then(r => { if (r.slot) { setSlot(r.slot); } else { setReason(r.reason); } });
  }, [turnId, answer]);

  return { slot, reason, zk };
}
