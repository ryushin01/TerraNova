"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 5;
const SCROLL_EDGE_PX = 60;
const SCROLL_STEP_PX = 14;

/** Pressing on these keeps its normal behavior instead of starting a selection. */
const IGNORED =
  "button, a, input, select, textarea, label, header, aside, nav, form, [role=menu], [role=dialog], [role=alertdialog], " +
  '[data-scope="toast"], [data-scope="action-bar"], [data-scope="alert"], [data-part="control"]';

export interface Marquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Gesture {
  mode: "marquee" | "drag";
  zone: string | null;
  toggle: boolean;
  additive: boolean;
  /** Start point in page coordinates, so scrolling during a drag keeps it anchored. */
  pageX: number;
  pageY: number;
  clientX: number;
  clientY: number;
  base: ReadonlySet<string>;
  active: boolean;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

/**
 * Mouse selection for field cards: drag on free space to draw a box, then drag any selected
 * card onto a section to move them all. Touch is left alone so pages still scroll.
 */
export function useFieldSelection(enabled: boolean, onDrop: (zoneIds: string[], sectionId: string) => void) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const clear = useCallback(() => setSelected((prev) => (prev.size ? new Set() : prev)), []);
  const toggle = useCallback((zone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(zone)) next.add(zone);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let gesture: Gesture | null = null;
    let frame = 0;
    let target: string | null = null;

    const finish = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      gesture = null;
      target = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
      setMarquee(null);
      setPointer(null);
      setDropTarget(null);
    };

    const updateMarquee = (g: Gesture) => {
      const startX = g.pageX - window.scrollX;
      const startY = g.pageY - window.scrollY;
      const left = Math.min(startX, g.clientX);
      const top = Math.min(startY, g.clientY);
      const right = Math.max(startX, g.clientX);
      const bottom = Math.max(startY, g.clientY);
      setMarquee({ left, top, width: right - left, height: bottom - top });

      const next = new Set(g.base);
      for (const card of document.querySelectorAll<HTMLElement>("[data-zone]")) {
        const box = card.getBoundingClientRect();
        if (box.left < right && box.right > left && box.top < bottom && box.bottom > top) {
          next.add(card.dataset.zone!);
        }
      }
      setSelected((prev) => (sameSet(prev, next) ? prev : next));
    };

    const updateDrag = (g: Gesture) => {
      setPointer({ x: g.clientX, y: g.clientY });
      const section = document.elementFromPoint(g.clientX, g.clientY)?.closest<HTMLElement>("[data-section]")
        ?.dataset.section;
      target = section ?? null;
      setDropTarget(target);
    };

    const update = (g: Gesture) => (g.mode === "marquee" ? updateMarquee(g) : updateDrag(g));

    // Keeps scrolling while the pointer rests near an edge, since far sections may be off screen.
    const autoScroll = () => {
      if (!gesture?.active) return;
      const { clientY } = gesture;
      const step =
        clientY < SCROLL_EDGE_PX ? -SCROLL_STEP_PX : clientY > window.innerHeight - SCROLL_EDGE_PX ? SCROLL_STEP_PX : 0;
      if (step) {
        window.scrollBy(0, step);
        update(gesture);
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const element = event.target as Element | null;
      if (!element || element.closest(IGNORED)) return;

      const zone = element.closest<HTMLElement>("[data-zone]")?.dataset.zone ?? null;
      const toggle = event.metaKey || event.ctrlKey;
      const additive = event.shiftKey;
      const onSelected = !!zone && selectedRef.current.has(zone);
      gesture = {
        mode: onSelected && !toggle && !additive ? "drag" : "marquee",
        zone,
        toggle,
        additive,
        pageX: event.pageX,
        pageY: event.pageY,
        clientX: event.clientX,
        clientY: event.clientY,
        base: toggle || additive ? new Set(selectedRef.current) : new Set(),
        active: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!gesture) return;
      gesture.clientX = event.clientX;
      gesture.clientY = event.clientY;
      if (!gesture.active) {
        const moved = Math.hypot(event.pageX - gesture.pageX, event.pageY - gesture.pageY);
        if (moved < DRAG_THRESHOLD_PX) return;
        gesture.active = true;
        document.body.style.userSelect = "none";
        if (gesture.mode === "drag") document.body.style.cursor = "grabbing";
        window.getSelection()?.removeAllRanges();
        frame = requestAnimationFrame(autoScroll);
      }
      update(gesture);
    };

    const onPointerUp = () => {
      const g = gesture;
      if (!g) return;
      const dropOn = target;
      if (g.active) {
        if (g.mode === "drag" && dropOn) onDropRef.current([...selectedRef.current], dropOn);
      } else if (!g.zone) {
        if (!g.additive && !g.toggle) setSelected((prev) => (prev.size ? new Set() : prev));
      } else {
        // A plain click selects one field; with a modifier it adds to or removes from the set.
        const zone = g.zone;
        setSelected((prev) => {
          if (!g.toggle && !g.additive) return new Set([zone]);
          const next = new Set(prev);
          if (g.toggle && next.has(zone)) next.delete(zone);
          else next.add(zone);
          return next;
        });
      }
      finish();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (gesture) {
        finish();
        return;
      }
      // Escape belongs to an open menu or dialog first.
      if (!document.querySelector("[role=menu], [role=dialog], [role=alertdialog]")) {
        setSelected((prev) => (prev.size ? new Set() : prev));
      }
    };

    // Stops the browser selecting text or dragging images while a gesture is under way.
    const preventDuringGesture = (event: Event) => {
      if (gesture) event.preventDefault();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", finish);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectstart", preventDuringGesture);
    document.addEventListener("dragstart", preventDuringGesture);
    window.addEventListener("blur", finish);

    return () => {
      finish();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectstart", preventDuringGesture);
      document.removeEventListener("dragstart", preventDuringGesture);
      window.removeEventListener("blur", finish);
    };
  }, [enabled]);

  return { selected, toggle, clear, marquee, pointer, dropTarget };
}
