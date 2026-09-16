"use client";

import { useEffect, useRef } from "react";
import { ScreenGestureTracker, screenPoint, containedScreenGeometry, type ScreenGeometry, type ScreenInput } from "../../jarvis/remote-screen-input";

function geometry(image: HTMLImageElement, nativeWidth?: number, nativeHeight?: number): ScreenGeometry {
  const rect = image.getBoundingClientRect();
  return containedScreenGeometry(rect, image.naturalWidth, image.naturalHeight, nativeWidth, nativeHeight);
}

// The parent keys this component by session, device, capability and screenshot.
// A context change unmounts the pending gesture before it can send input.
export default function RemoteScreenControl({ src, serial, enabled, onInput, onInteractionChange, nativeWidth, nativeHeight }: {
  src: string; serial: string; enabled: boolean; onInput: (input: ScreenInput) => void; onInteractionChange?: (active: boolean) => void;
  nativeWidth?: number; nativeHeight?: number;
}) {
  const tracker = useRef(new ScreenGestureTracker());
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);
  const cancel = () => { tracker.current.cancel(); onInteractionChange?.(false); };
  return <button type="button" className="jarvis-screen-button" disabled={!enabled}
    aria-label={enabled ? `${serial}：タップ・スワイプ。EnterまたはSpaceで画面中央をタップ` : `${serial}：閲覧のみ`}
    style={{ touchAction: enabled ? "none" : "auto", userSelect: "none" }}
    onPointerDown={(event) => {
      if (!enabled || event.button !== 0 || !image.current) return;
      const bounds = geometry(image.current, nativeWidth, nativeHeight);
      const start = { x: event.clientX, y: event.clientY };
      if (tracker.current.begin(event.pointerId, event.isPrimary, start, bounds, performance.now())) {
        onInteractionChange?.(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      } else onInteractionChange?.(false);
    }}
    onPointerUp={(event) => {
      onInteractionChange?.(false);
      if (!enabled || !image.current) { tracker.current.cancel(); return; }
      const current = geometry(image.current, nativeWidth, nativeHeight);
      const input = tracker.current.finish(event.pointerId, { x: event.clientX, y: event.clientY }, current, performance.now());
      if (input) onInput(input);
    }}
    onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onBlur={cancel}
    onClick={(event) => {
      // Pointer input was handled above; only keyboard/assistive activation remains.
      if (event.detail !== 0 || !enabled || !image.current) return;
      const bounds = geometry(image.current, nativeWidth, nativeHeight);
      const center = screenPoint({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, bounds);
      if (center) onInput({ action: "tap", ...center });
    }}
  ><img ref={image} src={src} draggable={false} alt={`${serial} の現在画面`} /></button>;
}
