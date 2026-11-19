import { useLayoutEffect,useState } from "react";

/** Below this container width an open record takes the whole screen. */
export const STACK_BELOW_PX = 900;

/**
 * The width of the frame the screen is mounted in, tracked with a
 * ResizeObserver. The CRM screen runs in frames of very different widths
 * (full page, the ~420-830px chat canvas), so layout follows this container,
 * not the host's viewport. The screen owns its whole frame, so the document
 * element is the container (outer page padding included). `null` until
 * measured, which callers treat as "wide" so the full-page layout never flashes.
 */
export function useContainerWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => setWidth(root.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  return width;
}
