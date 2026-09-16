"use client";

import { useRef } from "react";
import { ScreenGestureTracker, screenPoint, type ScreenGeometry, type ScreenInput } from "../../jarvis/remote-screen-input";

function geometry(image: HTMLImageElement): ScreenGeometry {
  const rect = image.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, nativeWidth: image.naturalWidth, nativeHeight: image.naturalHeight };
}

// The parent keys this component by session, device, capability and screenshot.
// A context change unmounts the pending gesture before it can send input.
export default function RemoteScreenControl({ src, serial, enabled, onInput }: {
  src: string; serial: string; enabled: boolean; onInput: (input: ScreenInput) => void;
}) {
  const tracker = useRef(new ScreenGestureTracker());
  const image = useRef<HTMLImageElement>(null);
  return <button type="button" className="jarvis-screen-button" disabled={!enabled}
    aria-label={enabled ? `${serial}：タップ・スワイプ。EnterまたはSpaceで画面中央をタップ` : `${serial}：閲覧のみ`}
    style={{ touchAction: enabled ? "none" : "auto", userSelect: "none" }}
    onPointerDown={(event) => {
      if (!enabled || event.button !== 0 || !image.current) return;
      const bounds = geometry(image.current);
      const start = { x: event.clientX, y: event.clientY };
      if (tracker.current.begin(event.pointerId, event.isPrimary, start, bounds, performance.now())) event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={(event) => {
      if (!enabled || !image.current) { tracker.current.cancel(); return; }
      const current = geometry(image.current);
      const input = tracker.current.finish(event.pointerId, { x: event.clientX, y: event.clientY }, current, performance.now());
      if (input) onInput(input);
    }}
    onPointerCancel={() => tracker.current.cancel()}
    onLostPointerCapture={() => tracker.current.cancel()}
    onBlur={() => tracker.current.cancel()}
    onClick={(event) => {
      // Pointer input was handled above; only keyboard/assistive activation remains.
      if (event.detail !== 0 || !enabled || !image.current) return;
      const bounds = geometry(image.current);
      const center = screenPoint({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, bounds);
      if (center) onInput({ action: "tap", ...center });
    }}
  ><img ref={image} src={src} draggable={false} alt={`${serial} の現在画面`} /></button>;
}
