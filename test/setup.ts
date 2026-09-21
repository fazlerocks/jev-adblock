/* Minimal in-memory chrome.* stub for unit tests. */
type Area = Record<string, unknown>;

function makeStorageArea(): chrome.storage.StorageArea & { __data: Area } {
  const data: Area = {};
  const get = async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === null || keys === undefined) return { ...data };
    if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    const out: Area = {};
    for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
    return out;
  };
  const set = async (items: Area) => {
    Object.assign(data, JSON.parse(JSON.stringify(items)));
  };
  const remove = async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
  };
  const clear = async () => {
    for (const k of Object.keys(data)) delete data[k];
  };
  return { get, set, remove, clear, __data: data } as unknown as chrome.storage.StorageArea & { __data: Area };
}

const listeners: Array<(...a: unknown[]) => unknown> = [];

const chromeStub = {
  runtime: {
    id: "test-extension-id",
    getURL: (p: string) => `chrome-extension://test-extension-id/${p}`,
    sendMessage: async () => undefined,
    onMessage: { addListener: (fn: (...a: unknown[]) => unknown) => listeners.push(fn) },
    openOptionsPage: async () => undefined,
    onInstalled: { addListener: () => undefined },
  },
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
    onChanged: { addListener: () => undefined },
  },
  alarms: { create: async () => undefined, onAlarm: { addListener: () => undefined } },
  tabs: {
    query: async () => [],
    get: async () => ({}),
    sendMessage: async () => undefined,
    reload: async () => undefined,
    onRemoved: { addListener: () => undefined },
  },
  action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  scripting: { executeScript: async () => [], insertCSS: async () => undefined },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

beforeEach(async () => {
  await chromeStub.storage.local.clear();
  await chromeStub.storage.session.clear();
});
