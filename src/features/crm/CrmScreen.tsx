import { ErrorNotice,Loading,NavigationProvider } from "@cadence/screen-ui";
import { useEffect,useState } from "react";
import { FrameNavigationAdapter,patchRoute } from "../../bridge/route";
import { scopeError,useScope } from "../../bridge/scope";
import Campaigns from "./campaigns/CrmCampaigns";
import "./crm-layout.css";
import "./crm-campaign.css";
import "./crm-drawer.css";
import Customers from "./customers/Customers";
import Segments from "./segments/Segments";
import { CrmLocaleProvider } from "./locale";
// Waiting longer than this for the first verified host push means the host
// is unreachable; the screen says so explicitly instead of spinning forever.
const HOST_PUSH_TIMEOUT_MS = 15000;
export default function CrmScreen() {
  const snapshot = useScope();
  const [unreachable, setUnreachable] = useState(false);
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
  const { scope, route, actions } = snapshot;
  const prefix = route.section === "customers" ? "records" : route.section === "segments" ? "segments" : "content";
  const viewer = { operator: actions.includes(`${prefix}.list`), readOnly: !actions.includes(route.section === "customers" ? "records.create" : route.section === "segments" ? "segments.save" : "content.save") };
  const props = {
    scope, viewer, view: route.view, recordId: route.record_id,
    onView: (view: "list" | "new") => { void patchRoute({ view, record_id: null }).catch(() => undefined); },
    onSelect: (id: string | null) => { void patchRoute({ view: "list", record_id: id }).catch(() => undefined); },
    onRecordCreated: (id: string) => { void patchRoute({ view: "list", record_id: id, segment_id: null }).catch(() => undefined); },
  };
  // Scope retirement destroys every draft/cache; section navigation doesn't
  // retire the bridge or the persistent host chat.
  return <CrmLocaleProvider locale={snapshot.presentationLocale}><NavigationProvider adapter={FrameNavigationAdapter}>
    <main className="app-outlet crm" key={`${scope.installId}:${snapshot.digest}`}>
      {route.section === "customers" ? <Customers {...props} /> : route.section === "segments" ? <Segments {...props} /> : <Campaigns {...props} />}
    </main>
  </NavigationProvider></CrmLocaleProvider>;
}
