import { DrawerShell,type DrawerShellProps } from "@cadence/screen-ui";
import { useEffect,useRef } from "react";

const FOCUSABLE = "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex=\"0\"]";

/**
 * The Customer and Segment detail drawer: the shared shell, always drawn in
 * this frame as a full-height right drawer over a frame-wide scrim. While it
 * is open the document behind it does not scroll and Tab stays inside it.
 * Escape, the scrim and the close control are the shell's own.
 */
export default function FrameDrawer(props: Omit<DrawerShellProps, "geometry" | "scrim">) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const trap = (event: KeyboardEvent) => {
      const panel = layer.current?.querySelector<HTMLElement>(".crm-drawer-shell");
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes.at(-1);
      const active = document.activeElement;
      // The title takes the initial focus, so it counts as the cycle start.
      const atStart = active === first || active === panel.querySelector(".crm-drawer-title") || !panel.contains(active);
      if (event.shiftKey && atStart) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, []);
  return <div className="crm-frame-drawer" ref={layer}><DrawerShell {...props} geometry={{ left: 0 }} /></div>;
}
