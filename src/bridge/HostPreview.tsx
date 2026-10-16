import { ErrorNotice } from "@cadence/screen-ui";
import { useEffect,useId,useRef,useState } from "react";
import { getScope } from "./scope";
import { serviceCall } from "./services";
/** App owns the document. Only the guarded host may render its inert HTML. */
export default function HostPreview({ title, document: html, mode, device = "desktop" }: { title: string; document: string; mode: "draft" | "saved"; device?: "desktop" | "mobile" }) {
  const node = useRef<HTMLDivElement>(null);
  const previewId = `preview-${useId().replace(/[^a-z0-9-]/gi, "").toLowerCase()}`;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const scope = getScope()?.scope;
    if (!scope || !node.current) return;
    let live = true;
    let showRevision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReady(false); setError(null);
    const show = () => {
      const revision = ++showRevision;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rect = node.current?.getBoundingClientRect();
        if (!live || !rect) return;
        void serviceCall(scope, "screen.preview.show", { preview_id: previewId, document: html, anchor: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, mode }).then(() => { if (live && revision === showRevision) { setReady(true); setError(null); } }, e => { if (live && revision === showRevision) { setReady(false); setError(e instanceof Error ? e.message : "Host preview is unavailable"); } });
      }, 100);
    };
    const resize = new ResizeObserver(show); resize.observe(node.current);
    window.addEventListener("scroll", show, true); window.addEventListener("resize", show);
    show();
    return () => { live = false; clearTimeout(timer); resize.disconnect(); window.removeEventListener("scroll", show, true); window.removeEventListener("resize", show); void serviceCall(scope, "screen.preview.clear", { preview_id: previewId }).catch(() => undefined); };
  }, [html, mode, device, previewId]);
  return <div ref={node} className="crm-preview-frame" role="region" aria-label={title} data-device={device} style={{ maxWidth: device === "mobile" ? 375 : undefined, minHeight: "24rem" }}>
    {error ? <ErrorNotice bare>{error}</ErrorNotice> : !ready ? <p role="status">Requesting isolated host preview…</p> : <span className="sr-only">{title} shown on the host&apos;s inert surface</span>}
  </div>;
}
