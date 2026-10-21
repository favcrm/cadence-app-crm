import {
type AudienceScope
} from "../audienceClient";
import NewCampaignDialog from "../campaign/NewCampaignDialog";
import "../crm-campaign.css";
import type { Viewer } from "../viewer";


import { currentRoute } from "../../../bridge/route";
import CampaignDetail from "./CampaignDetail";
import CampaignList from "./CampaignList";

export default function CrmCampaigns({
  scope,
  viewer,
  view,
  recordId,
  onView,
  onSelect,
  onRecordCreated,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  view: "list" | "new";
  recordId: string | null;
  onView: (view: "list" | "new") => void;
  onSelect: (recordId: string | null) => void;
  onRecordCreated?: (recordId: string) => void;
}) {
  return (
    <div className="crm-list" data-section="campaigns">
      {recordId !== null ? (
        <CampaignDetail
          key={`${scope.installId}:${recordId}`}
          scope={scope}
          viewer={viewer}
          campaignId={recordId}
          onBack={() => onSelect(null)}
          onCloned={onSelect}
        />
      ) : (
        <>
          <CampaignList
            scope={scope}
            viewer={viewer}
            onSelect={onSelect}
            onNew={() => onView("new")}
          />
          {view === "new" && viewer.operator && !viewer.readOnly && (
            <NewCampaignDialog
              scope={scope}
              initialSegmentId={currentRoute().segment_id}
              onCreated={(id) => {
                if (onRecordCreated) onRecordCreated(id);
                else {
                  onView("list");
                  onSelect(id);
                }
              }}
              onCancel={() => onView("list")}
            />
          )}
        </>
      )}
    </div>
  );
}
