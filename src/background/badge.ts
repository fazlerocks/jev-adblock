import type { Status } from "../shared/types";

export async function setBadge(tabId: number, status: Status, count: number): Promise<void> {
  let text = "";
  let color = "#635bff";
  switch (status) {
    case "ok":
      text = count > 0 ? String(count) : "";
      break;
    case "invalid_key":
    case "budget_exhausted":
    case "circuit_open":
    case "offline":
      text = "!";
      color = "#d9534f";
      break;
    case "paused":
    case "disabled":
      text = "II";
      color = "#8a8f98";
      break;
    default:
      text = "";
  }
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    /* tab may be gone */
  }
}
