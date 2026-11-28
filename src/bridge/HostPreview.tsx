import { ErrorNotice } from "@cadence/screen-ui";
import { useEffect,useId,useRef,useState } from "react";
import { getScope } from "./scope";
import { serviceCall, type SavedPreviewSource } from "./services";
/** Hosted previews refer to saved content; native keeps its existing inert-document command. */
export default function HostPreview({ title, document: html, source, mode, device = "desktop" }: {
  title: string;
  document: string;
  source: SavedPreviewSource | null;
  mode: "draft" | "saved";
  device?: "desktop" | "mobile";
}) {
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
        const anchor = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        const args = source === null
          ? { preview_id: previewId, document: html, anchor, mode }
          : { preview_id: previewId, source, anchor };
        void serviceCall(scope, "screen.preview.show", args).then(() => { if (live && revision === showRevision) { setReady(true); setError(null); } }, e => { if (live && revision === showRevision) { setReady(false); setError(e instanceof Error ? e.message : "Host preview is unavailable"); } });
      }, 100);
    };
    const resize = new ResizeObserver(show); resize.observe(node.current);
    window.addEventListener("scroll", show, true); window.addEventListener("resize", show);
    show();
    return () => { live = false; clearTimeout(timer); resize.disconnect(); window.removeEventListener("scroll", show, true); window.removeEventListener("resize", show); void serviceCall(scope, "screen.preview.clear", { preview_id: previewId }).catch(() => undefined); };
  }, [html, source, mode, device, previewId]);
  return <div ref={node} className="crm-preview-frame" role="region" aria-label={title} data-device={device} style={{ maxWidth: device === "mobile" ? 375 : undefined, minHeight: "24rem" }}>
    {error ? <ErrorNotice bare>{error}</ErrorNotice> : !ready ? <p role="status">Requesting isolated host preview…</p> : <span className="sr-only">{title} shown on the host&apos;s inert surface</span>}
  </div>;
}
