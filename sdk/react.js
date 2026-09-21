// Generated from react.jsx by scripts/build.js. Edit the .jsx, then `npm run build`.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Zeekend, deriveContext } from "./zeekend.js";
const Ctx = createContext(null);
function ZeekendProvider({ children, ...config }) {
  const client = useMemo(() => Zeekend.client(config), [config.publisherKey]);
  return /* @__PURE__ */ React.createElement(Ctx.Provider, { value: client }, children);
}
function useZeekend(config) {
  const fromCtx = useContext(Ctx);
  const own = useMemo(
    () => fromCtx ? null : Zeekend.client(config || {}),
    [fromCtx, config && config.publisherKey]
  );
  const client = fromCtx || own;
  if (!client) {
    throw new Error("[zeekend] pass publisherKey, or wrap in <ZeekendProvider>");
  }
  return client;
}
function ZeekendSlot({
  messages,
  publisherKey,
  conversationId,
  placementId = "chat-main",
  dimensions,
  theme,
  onFill,
  onNoFill,
  className,
  settleMs = 700,
  ...rest
}) {
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
  useEffect(() => {
    if (!turnId || !mountRef.current || askedFor.current === turnId) {
      return;
    }
    askedFor.current = turnId;
    if (turnRef.current) {
      turnRef.current.destroy();
    }
    turnRef.current = zk.serve({
      mount: mountRef.current,
      placementId,
      question,
      conversationId,
      dimensions,
      theme,
      onFill,
      onNoFill
    });
  }, [turnId]);
  useEffect(() => {
    if (!turnId || !answer || answeredFor.current === turnId) {
      return;
    }
    const t = setTimeout(() => {
      if (answeredFor.current === turnId || !turnRef.current) {
        return;
      }
      answeredFor.current = turnId;
      turnRef.current.answer(answer);
    }, settleMs);
    return () => clearTimeout(t);
  }, [turnId, answer, settleMs]);
  useEffect(() => () => {
    if (turnRef.current) {
      turnRef.current.destroy();
    }
  }, []);
  return /* @__PURE__ */ React.createElement("div", { ref: mountRef, className });
}
function useZeekendSlot({ messages, publisherKey, conversationId, placementId, dimensions, settleMs = 700, ...rest }) {
  const zk = useZeekend({ publisherKey, ...rest });
  const [slot, setSlot] = useState(null);
  const [reason, setReason] = useState(null);
  const askedFor = useRef(null);
  const answeredFor = useRef(null);
  const derived = useMemo(() => deriveContext(messages, conversationId), [messages, conversationId]);
  const turnId = derived && derived.turnId;
  useEffect(() => {
    if (!turnId || askedFor.current === turnId) {
      return;
    }
    askedFor.current = turnId;
    setSlot(null);
    setReason(null);
    zk.request({
      placementId,
      dimensions,
      context: { ...derived.context, answer: null }
    }).then((r) => {
      setSlot(r.slot);
      setReason(r.reason);
    });
  }, [turnId]);
  useEffect(() => {
    if (!turnId || !derived || !derived.context.answer || slot || answeredFor.current === turnId) {
      return;
    }
    const t = setTimeout(() => {
      answeredFor.current = turnId;
      zk.request({ placementId, dimensions, _secondPass: true, context: derived.context }).then((r) => {
        if (r.slot) {
          setSlot(r.slot);
        } else {
          setReason(r.reason);
        }
      });
    }, settleMs);
    return () => clearTimeout(t);
  }, [turnId, derived && derived.context.answer]);
  return { slot, reason, zk };
}
export {
  ZeekendProvider,
  ZeekendSlot,
  useZeekend,
  useZeekendSlot
};
