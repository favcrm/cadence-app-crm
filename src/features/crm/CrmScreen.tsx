import { ErrorNotice,Loading,NavigationProvider } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import { closeDrawer,openDrawer } from "../../bridge/drawer";
import { getSurface,useSurface,type DrawerSurface } from "../../bridge/presentation";
import { FrameNavigationAdapter,patchRoute } from "../../bridge/route";
import { scopeError,useScope } from "../../bridge/scope";
import Campaigns from "./campaigns/CrmCampaigns";
import "./crm-layout.css";
import "./crm-campaign.css";
import "./crm-drawer.css";
import Customers,{ CustomerDrawer } from "./customers/Customers";
import Segments,{ SegmentDrawer } from "./segments/Segments";
import { CrmLocaleProvider } from "./locale";
// Waiting longer than this for the first verified host push means the host
// is unreachable; the screen says so explicitly instead of spinning forever.
const HOST_PUSH_TIMEOUT_MS = 15000;
export default function CrmScreen() {
  const snapshot = useScope();
  const [unreachable, setUnreachable] = useState(false);
  const surface = useSurface();
  // `requested` is the detail surface we asked the host to present; `shown`
  // is the one the host actually put in its overlay. They are separate so a
  // refused open cannot masquerade as a host close — and a host close cannot
  // trigger another open request for the same detail (reopen loop).
  const requested = useRef<string | null>(null);
  const shown = useRef<string | null>(null);
  const suppressed = useRef<string | null>(null);
  const wasModal = useRef(false);
  const restoreFocus = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  // An explicit open refusal falls back to the embedded detail (old hosts and
  // non-capable peers) instead of a blank host overlay or a fake success.
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    if (snapshot) return;
    const timer = setTimeout(() => setUnreachable(true), HOST_PUSH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);
  const route = snapshot?.route ?? null;
  const drawerSurface: DrawerSurface | null = route === null || route.record_id === null
    ? null
    : route.section === "customers" ? "customer" : route.section === "segments" ? "segment" : null;
  const detailKey = drawerSurface === null || route === null ? null : `${drawerSurface}:${route.record_id}`;
  // The host owns the independent overlay only when it negotiated surfaces and
  // advertised both drawer verbs on this live mount. Otherwise the ordinary
  // embedded drawer stays in the frame (legacy/outlet hosts).
  const independent = surface.negotiated && snapshot?.drawerOpen === true;
  const child = surface.negotiated && surface.role === "drawer";
  useEffect(() => {
    if (fallback !== null && fallback !== detailKey) setFallback(null);
  }, [fallback, detailKey]);
  // A host that did present the overlay owns the detail; never keep an
  // embedded copy behind it (even if a lost reply once looked like a refusal).
  useEffect(() => {
    if (surface.modal && fallback !== null) setFallback(null);
  }, [surface.modal, fallback]);
  // A host close (trusted control/scrim/Escape) arrives as modal true -> false.
  // Reconcile the still-selected detail exactly once and suppress the open
  // effect until the route settles, so dismissal never reopens the panel.
  useEffect(() => {
    if (surface.role !== "primary") return;
    const was = wasModal.current;
    wasModal.current = surface.modal;
    if (surface.modal) {
      if (detailKey !== null) shown.current = detailKey;
      return;
    }
    if (!was || shown.current === null) return;
    const presented = shown.current;
    shown.current = null;
    restoreFocus.current = true;
    const sameSelection = detailKey !== null && detailKey === presented;
    if (sameSelection) suppressed.current = presented;
    if (requested.current === presented) requested.current = null;
    // Only the selection is dismissed: a concurrent section navigation keeps
    // its own target, so the two patches never fight.
    if (sameSelection) void patchRoute({ view: "list", record_id: null }).catch(() => undefined);
  }, [detailKey, surface.modal, surface.role]);
  // Ask once for the host's independent overlay when a Customer/Segment detail
  // opens, including a direct detail route. While the overlay is open or the
  // selection is being dismissed, never re-request. Geometry changes never
  // re-request, and a drawer child never opens another drawer.
  useEffect(() => {
    if (surface.role !== "primary" || !independent) return;
    if (detailKey === null || drawerSurface === null) {
      requested.current = null;
      suppressed.current = null;
      // A host-driven route that no longer selects a detail must not leave
      // the child overlay presenting a dead surface; close it exactly once.
      if (surface.modal && shown.current !== null) {
        shown.current = null;
        restoreFocus.current = true;
        void closeDrawer();
      }
      return;
    }
    if (surface.modal) {
      // The host is presenting this selection: keep the request key aligned
      // with it (detail-to-detail) so a later close cannot reopen the old one.
      requested.current = detailKey;
      shown.current = detailKey;
      return;
    }
    if (suppressed.current !== null && suppressed.current !== detailKey) suppressed.current = null;
    if (fallback === detailKey) return;
    if (requested.current === detailKey || shown.current === detailKey ||
        suppressed.current === detailKey) return;
    restoreFocus.current = false;
    requested.current = detailKey;
    const key = detailKey;
    const target = drawerSurface;
    void openDrawer(target).then((ok) => {
      if (ok || requested.current !== key) return;
      requested.current = null;
      setFallback(key);
    });
  }, [detailKey, drawerSurface, fallback, independent, surface.modal, surface.role]);
  // Exit focus waits for both the host overlay (modal false) and the route
  // (list): the background is inert and the detail still the selection until
  // then, so focusing earlier lands on body. Prefer the row that opened the
  // detail, else the section heading (the shared drawer shell's fallback).
  useEffect(() => {
    if (surface.role !== "primary" || !restoreFocus.current || surface.modal || detailKey !== null) return;
    restoreFocus.current = false;
    const back = opener.current;
    opener.current = null;
    const target = back && back.isConnected && !back.closest("[inert]")
      ? back
      : document.querySelector<HTMLElement>("[data-outlet-heading]");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }, [detailKey, surface.modal, surface.role]);
  // Frame retirement must not leave a dead surface behind: a drawer closes its
  // own host panel; the primary frame owns no panel to close.
  useEffect(() => () => {
    const state = getSurface();
    if (state.negotiated && state.role === "drawer") void closeDrawer();
  }, []);
  if (!snapshot) {
    if (scopeError()) return <ErrorNotice>{scopeError()}</ErrorNotice>;
    return unreachable
      ? <ErrorNotice>The Cadence host is unreachable. Reopen this app once the host is available.</ErrorNotice>
      : <Loading>Waiting for the verified CRM mount…</Loading>;
  }
  const { scope, route: current, actions } = snapshot;
  const prefix = current.section === "customers" ? "records" : current.section === "segments" ? "segments" : "content";
  const viewer = { operator: actions.includes(`${prefix}.list`), readOnly: !actions.includes(current.section === "customers" ? "records.create" : current.section === "segments" ? "segments.save" : "content.save") };
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const closeChild = () => {
    // Explicit close keeps its discard semantics and releases the host panel;
    // the primary reconciles the route when it observes modal=false.
    void closeDrawer();
    void patchRoute({ view: "list", record_id: null }).catch(() => undefined);
  };
  if (child) {
    // A host-owned drawer frame renders ONLY the existing detail module for
    // the verified route: no list, no list queries/scroll memory, no nested
    // drawer request, no campaign content.
    const recordId = current.record_id;
    const detail = recordId === null ? null
      : current.section === "customers" ? (
          <CustomerDrawer
            scope={scope}
            recordId={recordId}
            viewer={viewer}
            canWrite={canWrite}
            onClose={closeChild}
          />
        )
      : current.section === "segments" ? (
          <SegmentDrawer
            scope={scope}
            segmentId={recordId}
            viewer={viewer}
            canWrite={canWrite}
            onClose={closeChild}
            onOpen={(id) => { void patchRoute({ view: "list", record_id: id }).catch(() => undefined); }}
          />
        )
      : null;
    return <CrmLocaleProvider locale={snapshot.presentationLocale}><NavigationProvider adapter={FrameNavigationAdapter}>
      <main className="app-outlet crm" data-surface="drawer" key={`${scope.installId}:${snapshot.digest}`}>
        {detail}
      </main>
    </NavigationProvider></CrmLocaleProvider>;
  }
  const embedded = independent && drawerSurface !== null && (surface.modal || fallback !== detailKey) ? null : current.record_id;
  const props = {
    scope, viewer, view: current.view, recordId: embedded,
    onView: (view: "list" | "new") => {
      if (surface.role === "primary" && surface.negotiated && surface.modal) {
        restoreFocus.current = true;
        void closeDrawer();
      }
      void patchRoute({ view, record_id: null }).catch(() => undefined);
    },
    onSelect: (id: string | null) => {
      // Explicit close keeps its discard semantics and also releases the host
      // panel; the route change alone would leave the board drawing a list.
      if (id === null) {
        if (surface.role === "primary" && surface.negotiated && surface.modal) {
          restoreFocus.current = true;
          void closeDrawer();
        }
      } else {
        restoreFocus.current = false;
        opener.current = document.activeElement instanceof HTMLElement && document.activeElement.closest(".crm-surface")
          ? document.activeElement
          : null;
      }
      void patchRoute({ view: "list", record_id: id }).catch(() => undefined);
    },
    onRecordCreated: (id: string) => { void patchRoute({ view: "list", record_id: id, segment_id: null }).catch(() => undefined); },
  };
  // Scope retirement destroys every draft/cache; section navigation doesn't
  // retire the bridge or the persistent host chat. The host surface is an
  // attribute only: an independent child overlay never remounts this frame,
  // its list or its draft.
  return <CrmLocaleProvider locale={snapshot.presentationLocale}><NavigationProvider adapter={FrameNavigationAdapter}>
    <main className="app-outlet crm" data-surface="primary" data-modal={surface.modal ? "true" : "false"} key={`${scope.installId}:${snapshot.digest}`}>
      {current.section === "customers" ? <Customers {...props} /> : current.section === "segments" ? <Segments {...props} /> : <Campaigns {...props} />}
    </main>
  </NavigationProvider></CrmLocaleProvider>;
}
