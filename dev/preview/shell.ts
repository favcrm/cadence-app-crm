import "@cadence/screen-ui/styles.css";
import "./shell.css";

const board = document.querySelector<HTMLElement>("#preview-board")!;
const menu = document.querySelector<HTMLButtonElement>("#sidebar-toggle")!;
const scrim = document.querySelector<HTMLButtonElement>("#sidebar-scrim")!;
const assistantCollapse = document.querySelector<HTMLButtonElement>("#assistant-collapse")!;
const assistantExpand = document.querySelector<HTMLButtonElement>("#assistant-expand")!;
const desktopLayout = window.matchMedia("(min-width: 1024px)");

function setAssistantCollapsed(collapsed: boolean) {
  board.dataset.chatCollapsed = String(collapsed);
  for (const control of [assistantCollapse, assistantExpand]) control.setAttribute("aria-expanded", String(!collapsed));
  window.dispatchEvent(new Event("preview-layout"));
  // Move focus to whichever control stays visible, so keyboard users are
  // never left on an element the collapsed layout hides.
  (collapsed ? assistantExpand : assistantCollapse).focus({ preventScroll: true });
}

function syncAssistantExpanded() {
  // Narrow layouts always show the selected panel; only desktop has a rail.
  const expanded = desktopLayout.matches ? board.dataset.chatCollapsed !== "true" : true;
  for (const control of [assistantCollapse, assistantExpand]) control.setAttribute("aria-expanded", String(expanded));
}

assistantCollapse.addEventListener("click", () => setAssistantCollapsed(true));
assistantExpand.addEventListener("click", () => setAssistantCollapsed(false));
desktopLayout.addEventListener("change", syncAssistantExpanded);
syncAssistantExpanded();

// The familiar collapse icon carries a CSS hint on hover and keyboard
// focus. Escape dismisses whichever hint is currently showing (pointer or
// keyboard) without moving focus; the next hover/focus shows it again.
for (const control of document.querySelectorAll<HTMLElement>("[data-hint]")) {
  control.addEventListener("blur", () => control.classList.remove("hint-dismissed"));
  control.addEventListener("mouseleave", () => control.classList.remove("hint-dismissed"));
}
window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  for (const control of document.querySelectorAll<HTMLElement>("[data-hint]")) {
    if (control.matches(":hover, :focus-visible")) control.classList.add("hint-dismissed");
  }
});
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
