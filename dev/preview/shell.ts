import "@cadence/screen-ui/styles.css";
import "./shell.css";

const board = document.querySelector<HTMLElement>("#preview-board")!;
const menu = document.querySelector<HTMLButtonElement>("#sidebar-toggle")!;
const scrim = document.querySelector<HTMLButtonElement>("#sidebar-scrim")!;
const assistantToggle = document.querySelector<HTMLButtonElement>("#assistant-toggle")!;
function closeNavigation() {
  board.dataset.sidebarOpen = "false";
  menu.setAttribute("aria-expanded", "false");
  scrim.hidden = true;
}
function selectPanel(panel: string) {
  board.dataset.panel = panel;
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".mobile-panels [data-panel]")) tab.setAttribute("aria-pressed", String(tab.dataset.panel === panel));
  window.dispatchEvent(new Event("preview-layout"));
}
menu.addEventListener("click", () => {
  const open = board.dataset.sidebarOpen !== "true";
  board.dataset.sidebarOpen = String(open);
  menu.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  if (open) document.querySelector<HTMLButtonElement>("[data-section][aria-pressed=true]")?.focus();
});
scrim.addEventListener("click", () => { closeNavigation(); menu.focus(); });
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && board.dataset.sidebarOpen === "true") { closeNavigation(); menu.focus(); }
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.addEventListener("click", () => { closeNavigation(); selectPanel("work"); });
for (const button of document.querySelectorAll<HTMLButtonElement>(".mobile-panels [data-panel]")) button.addEventListener("click", () => selectPanel(button.dataset.panel!));
assistantToggle.addEventListener("click", () => {
  const collapsed = board.dataset.chatCollapsed !== "true";
  board.dataset.chatCollapsed = String(collapsed);
  assistantToggle.setAttribute("aria-expanded", String(!collapsed));
  assistantToggle.textContent = collapsed ? "Show assistant" : "Hide assistant";
  window.dispatchEvent(new Event("preview-layout"));
});
document.querySelector(".assistant-composer")!.addEventListener("submit", event => event.preventDefault());
document.querySelector("#reset-fixtures")!.addEventListener("click", () => {
  if (confirm("Reset all local customer, segment and campaign changes, and clear the chat draft? No live data is affected.")) location.reload();
});
window.addEventListener("preview-route", event => {
  const section = (event as CustomEvent<string>).detail;
  document.querySelector("#workspace-title")!.textContent = section[0].toUpperCase() + section.slice(1);
});
window.addEventListener("preview-action", event => {
  document.querySelector("#preview-activity")!.textContent = (event as CustomEvent<string>).detail;
});
