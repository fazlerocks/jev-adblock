import type { HiddenItem, TabState } from "../shared/types";

const KEY = "tabState";
type Map = Record<string, TabState>;

async function readAll(): Promise<Map> {
  const r = await chrome.storage.session.get(KEY);
  return (r[KEY] ?? {}) as Map;
}

async function writeAll(m: Map): Promise<void> {
  await chrome.storage.session.set({ [KEY]: m });
}

export async function getTabState(tabId: number): Promise<TabState | undefined> {
  return (await readAll())[String(tabId)];
}

export async function resetTabState(tabId: number, host: string): Promise<TabState> {
  const m = await readAll();
  const s: TabState = { host, hidden: [], analysed: 0, batches: 0, ruleHidden: 0, pageTokens: 0 };
  m[String(tabId)] = s;
  await writeAll(m);
  return s;
}

export async function updateTabState(tabId: number, host: string, fn: (s: TabState) => void): Promise<TabState> {
  const m = await readAll();
  let s = m[String(tabId)];
  if (!s || s.host !== host) s = { host, hidden: [], analysed: 0, batches: 0, ruleHidden: 0, pageTokens: 0 };
  if (s.pageTokens === undefined) s.pageTokens = 0;
  fn(s);
  m[String(tabId)] = s;
  await writeAll(m);
  return s;
}

export async function setHiddenItems(tabId: number, host: string, items: HiddenItem[], ruleHidden: number, analysed: number, sensitive = false): Promise<TabState> {
  return updateTabState(tabId, host, (s) => {
    s.hidden = items;
    s.ruleHidden = ruleHidden;
    s.analysed = analysed;
    s.sensitive = sensitive;
  });
}

export async function removeHidden(tabId: number, predicate: (h: HiddenItem) => boolean): Promise<void> {
  const m = await readAll();
  const s = m[String(tabId)];
  if (!s) return;
  s.hidden = s.hidden.filter((h) => !predicate(h));
  await writeAll(m);
}

export async function dropTab(tabId: number): Promise<void> {
  const m = await readAll();
  if (String(tabId) in m) {
    delete m[String(tabId)];
    await writeAll(m);
  }
}
