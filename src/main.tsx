import { ErrorNotice } from "@cadence/screen-ui";
import "@cadence/screen-ui/styles.css";
import { createRoot } from "react-dom/client";
import { channel } from "./bridge/channel";
import { installSandboxFormActions } from "./bridge/sandboxForms";
import CrmScreen from "./features/crm/CrmScreen";
const outlet = document.getElementById("root") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
const root = createRoot(outlet);
try { installSandboxFormActions(document); channel.start(); root.render(<CrmScreen />); }
catch (e) { root.render(<ErrorNotice>{e instanceof Error ? e.message : "CRM bridge unavailable"}</ErrorNotice>); }
