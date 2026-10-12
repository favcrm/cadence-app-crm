import { ErrorNotice,Loading,NavigationProvider } from "@cadence/screen-ui";
import { FrameNavigationAdapter,patchRoute } from "../../bridge/route";
import { scopeError,useScope } from "../../bridge/scope";
import Campaigns from "./campaigns/CrmCampaigns";
import "./crm-campaign.css";
import "./crm-drawer.css";
import Customers from "./customers/Customers";
import Segments from "./segments/Segments";
export default function CrmScreen() {
  const snapshot = useScope();
  if (!snapshot) return scopeError() ? <ErrorNotice>{scopeError()}</ErrorNotice> : <Loading>Waiting for the verified CRM mount…</Loading>;
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
  return <NavigationProvider adapter={FrameNavigationAdapter}>
    <main className="app-outlet crm" key={`${scope.installId}:${scope.contextId}:${snapshot.digest}`}>
      {route.section === "customers" ? <Customers {...props} /> : route.section === "segments" ? <Segments {...props} /> : <Campaigns {...props} />}
    </main>
  </NavigationProvider>;
}
