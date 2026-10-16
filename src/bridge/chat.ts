import { type DisplayScope } from "./scope";
import { serviceSlot } from "./services";
export const campaignChat = {
  open: (scope: DisplayScope, campaignId: string) => serviceSlot(scope, "chat.campaign.open", { campaign_id: campaignId }),
  brief: (scope: DisplayScope, campaignId: string, brief: string) => serviceSlot(scope, "chat.campaign.brief", { campaign_id: campaignId, brief }),
};
