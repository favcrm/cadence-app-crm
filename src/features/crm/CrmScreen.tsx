import { EmptyState,ErrorNotice,Loading,NavigationProvider } from "@cadence/screen-ui";
import { useEffect,useState } from "react";
import { useOwnerRefused } from "../../bridge/ownerGate";
import { FrameNavigationAdapter,patchRoute } from "../../bridge/route";
import { readRecordParam } from "../../domain/routeParams";
import { scopeError,useCanvasReadOnly,useScope } from "../../bridge/scope";
import Campaigns from "./campaigns/CrmCampaigns";
import "./crm-layout.css";
import "./crm-campaign.css";
import "./crm-drawer.css";
import Customers from "./customers/Customers";
import Segments from "./segments/Segments";
import { CrmLocaleProvider,useTranslate } from "./locale";
// Waiting longer than this for the first verified host push means the host
// is unreachable; the screen says so explicitly instead of spinning forever.
const HOST_PUSH_TIMEOUT_MS = 15000;
/** A member is refused an owner-only section's reads: one calm state in place of it, nothing partial, no retry. */
function OwnerOnly({ section }: { section: "segments" | "campaigns" }) {
  const t = useTranslate();
  return <EmptyState name="owner-only" title={section === "segments" ? t("Only workspace owners can view segments.") : t("Only workspace owners can view campaigns.")}>{t("Ask a workspace owner if you need this.")}</EmptyState>;
}
export default function CrmScreen() {
  const snapshot = useScope();
  const ownerRefused = useOwnerRefused();
  const canvas = useCanvasReadOnly();
  const [unreachable, setUnreachable] = useState(false);
  // Dismiss a selected detail at once even if the host refuses the route
  // patch. The next section/record route clears the dismissal.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const detail = snapshot?.route.record_id == null ? null : `${snapshot.route.section}:${snapshot.route.record_id}`;
  useEffect(() => { setDismissed(null); }, [detail]);
  // The `segment` and `campaign` views name a record in an `id` param: open it
  // as the route's record and drop the param. Customers take no `id`.
  const route = snapshot?.route;
  const named = route && route.record_id === null && route.view === "list" && route.section !== "customers" ? readRecordParam(route.params) : null;
  useEffect(() => {
    if (named === null) return;
    void patchRoute({ view: "list", record_id: named, params: {} }).catch(() => undefined);
  }, [named, route?.section]);
  useEffect(() => {
    if (snapshot) return;
    const timer = setTimeout(() => setUnreachable(true), HOST_PUSH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);
  if (!snapshot) {
    if (scopeError()) return <ErrorNotice>{scopeError()}</ErrorNotice>;
    return unreachable
      ? <ErrorNotice>The Cadence host is unreachable. Reopen this app once the host is available.</ErrorNotice>
      : <Loading>Waiting for the verified CRM mount…</Loading>;
  }
  const { scope, route: current, actions } = snapshot;
  const prefix = current.section === "customers" ? "records" : current.section === "segments" ? "segments" : "content";
  const viewer = {
    operator: actions.includes(`${prefix}.list`),
    canvas,
    readOnly: canvas || !actions.includes(current.section === "customers" ? "records.create" : current.section === "segments" ? "segments.save" : "content.save"),
    canCreate: !canvas && actions.includes("records.create"),
    canUpdate: !canvas && actions.includes("records.update"),
  };
  const gated = current.section !== "customers" && ownerRefused.has(current.section) ? current.section : null;
  // The route selects a full customer page or an in-frame segment drawer.
  const props = {
    scope, viewer, view: current.view, recordId: detail !== null && detail === dismissed ? null : current.record_id,
    onView: (view: "list" | "new") => { void patchRoute({ view, record_id: null }).catch(() => undefined); },
    onSelect: (id: string | null) => {
      setDismissed(id === null ? detail : null);
      void patchRoute({ view: "list", record_id: id }).catch(() => undefined);
    },
    onRecordCreated: (id: string) => { void patchRoute({ view: "list", record_id: id, segment_id: null }).catch(() => undefined); },
  };
  // Scope retirement destroys every draft/cache; section navigation doesn't
  // retire the bridge or the persistent host chat.
  return <CrmLocaleProvider locale={snapshot.presentationLocale}><NavigationProvider adapter={FrameNavigationAdapter}>
    <main className={canvas ? "app-outlet crm crm-canvas" : "app-outlet crm"} key={`${scope.installId}:${snapshot.digest}`} data-state={gated ? "owner-only" : undefined}>
      {gated ? <OwnerOnly section={gated} /> : current.section === "customers" ? <Customers {...props} /> : current.section === "segments" ? <Segments {...props} /> : <Campaigns {...props} />}
    </main>
  </NavigationProvider></CrmLocaleProvider>;
}
