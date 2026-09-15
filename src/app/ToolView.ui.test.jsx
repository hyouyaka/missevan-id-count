import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const testState = vi.hoisted(() => ({
  actions: [],
  registration: null,
  registrationStarted: null,
  storage: new Map(),
  output: null,
  results: null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/app/AppIcon", () => ({ AppIcon: () => null }));
vi.mock("@/app/BackgroundTaskCenter", () => ({ BackgroundTaskCenter: () => null }));
vi.mock("@/app/ChangelogDialog", () => ({
  ChangelogDialog: () => null,
  useChangelogDialog: () => ({
    changelogMode: "latest",
    changelogOpen: false,
    openChangelog: vi.fn(),
    setChangelogOpen: vi.fn(),
    showChangelogHistory: vi.fn(),
  }),
}));
vi.mock("@/app/DramaCompare", () => ({
  DramaCompareBasket: () => null,
  DramaCompareDialog: () => null,
}));
vi.mock("@/app/MessageDialog", () => ({ MessageDialog: () => null }));
vi.mock("@/app/navigation", () => ({
  LazyRouteFallback: () => null,
  MainNavigationDrawer: () => null,
  getInitialDrawerExpandedRootKeys: () => [],
}));
vi.mock("@/app/favoritesStorage", () => ({
  listFavorites: vi.fn(async () => []),
  removeFavoriteWithSnapshots: vi.fn(),
  saveFavorite: vi.fn(),
}));
vi.mock("@/app/ranksData", () => ({
  fetchRanksData: vi.fn(),
  getCachedRanksData: vi.fn(),
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }) => <>{children}</>,
  AlertDescription: ({ children }) => <>{children}</>,
  AlertTitle: ({ children }) => <>{children}</>,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }) => <>{children}</>,
  AlertDialogAction: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }) => <>{children}</>,
  AlertDialogDescription: ({ children }) => <>{children}</>,
  AlertDialogFooter: ({ children }) => <>{children}</>,
  AlertDialogHeader: ({ children }) => <>{children}</>,
  AlertDialogMedia: ({ children }) => <>{children}</>,
  AlertDialogTitle: ({ children }) => <>{children}</>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }) => <>{children}</>,
  SheetTrigger: ({ children }) => <>{children}</>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <>{children}</>,
  TabsList: ({ children }) => <>{children}</>,
  TabsTrigger: ({ children }) => <>{children}</>,
}));
vi.mock("@/app/SearchPanel", () => ({
  SearchPanel: ({ onUpdatePlatformResults }) => (<>
    <button
      type="button"
      onClick={() => onUpdatePlatformResults(
        "missevan",
        [{ id: "42", search_source: "missevan_api", title: "待登记作品", metrics_status: "loaded" }],
        "search",
        { keyword: "待登记作品", matchedCount: 1 }
      )}
    >
      写入 API 搜索结果
    </button>
    <button type="button" onClick={() => onUpdatePlatformResults("manbo", [{ id: "mb-77", title: "漫播保留", metrics_status: "loaded" }], "search", { keyword: "漫播" })}>
      写入漫播搜索结果
    </button>
  </>),
}));
vi.mock("@/app/SearchWorkspace", () => ({
  default: ({ output, panelRefs, results }) => {
    testState.output = output;
    testState.results = results;
    testState.actions.push(output.currentAction || "");
    return (
      <section ref={panelRefs.results}>
        <button
          type="button"
          onClick={() => results.onStartIdStatistics(["sound-42"], {
            platform: "missevan",
            selectedEpisodes: [{
              drama_id: "42",
              drama_title: "待登记作品",
              duration: 60,
              episode_title: "第一集",
              sound_id: "sound-42",
            }],
          })}
        >
          启动 ID 统计
        </button>
        <button type="button" onClick={output.onCancelStatistics}>取消统计</button>
        {output.historyEntries?.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => output.onReplayHistoryEntry(entry)}
          >
            重跑 {entry.id}
          </button>
        ))}
        <output data-testid="stats-action">{output.currentAction}</output>
        <output data-testid="stats-running">{String(output.isRunning)}</output>
        <output data-testid="history-disabled">{String(output.historyActionsDisabled)}</output>
        <output data-testid="result-ids">{(results.results || []).map((item) => item.id).join(",")}</output>
        <output data-testid="selected-ids">{(results.selectedEpisodes || []).map((item) => item.sound_id).join(",")}</output>
        <div ref={panelRefs.output} />
      </section>
    );
  },
}));

import { ToolView } from "@/app/ToolView";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "X-Backend-Version": "1.0.0", "Content-Type": "application/json" },
  });
}

function replayHistoryEntry(id, replay) {
  return {
    id,
    platform: "missevan",
    createdAt: Date.now(),
    taskType: replay.operation === "revenue" ? "revenue" : replay.operation === "play_count" ? "play_count" : "id",
    summaryMetrics: [],
    items: [],
    replay,
  };
}

function setHistory(entries) {
  globalThis.localStorage.setItem("missevan-counter.history.v1", JSON.stringify({
    version: 1,
    missevan: entries,
    manbo: [],
  }));
}

beforeEach(() => {
  testState.actions = [];
  testState.registration = createDeferred();
  testState.registrationStarted = createDeferred();
  testState.output = null;
  testState.results = null;
  testState.storage = new Map();
  const storage = {
    getItem: (key) => testState.storage.get(key) ?? null,
    setItem: (key, value) => testState.storage.set(key, String(value)),
    removeItem: (key) => testState.storage.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  window.history.replaceState({}, "", "/?view=search&platform=missevan");
  setHistory([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("cancelling while API-search ID registration waits cannot continue the old statistics run", async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) {
      return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    }
    if (path.includes("/register-new-drama-ids")) {
      testState.registrationStarted.resolve(options.signal);
      return testState.registration.promise;
    }
    if (path.includes("/stat-tasks")) {
      throw new Error(`stale run unexpectedly started a stats task: ${path}`);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "写入 API 搜索结果" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "启动 ID 统计" })).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "启动 ID 统计" }));
  const registrationSignal = await testState.registrationStarted.promise;
  await waitFor(() => expect(screen.getByTestId("stats-running")).toHaveTextContent("true"));

  fireEvent.click(screen.getByRole("button", { name: "取消统计" }));
  await waitFor(() => expect(screen.getByTestId("stats-action")).toHaveTextContent("统计已取消"));
  expect(registrationSignal.aborted).toBe(true);
  const scrollCountBeforeRegistrationResolves = scrollIntoView.mock.calls.length;

  await act(async () => {
    testState.registration.resolve(jsonResponse({ success: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(screen.getByTestId("stats-running")).toHaveTextContent("false"));
  expect(screen.getByTestId("stats-action")).toHaveTextContent("统计已取消");
  expect(testState.actions).not.toContain("开始统计弹幕与去重 ID");
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/stat-tasks"))).toHaveLength(0);
  expect(scrollIntoView).toHaveBeenCalledTimes(scrollCountBeforeRegistrationResolves);
});

function freshDrama(episodes, viewCount = 999) {
  return {
    success: true,
    id: "42",
    info: {
      drama: { id: "42", name: "最新作品", view_count: viewCount },
      episodes: { episode: episodes },
    },
  };
}

function stubReplayRequests(overrides = {}) {
  const completed = { taskId: "review-task", taskType: "id", status: "completed", result: { idResults: [] } };
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/search-card-metrics")) return overrides.metrics?.(options) ?? Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    if (path.includes("/getdramacards")) return overrides.cards?.(options) ?? Promise.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "任务卡" }] }));
    if (path.includes("/getdramas")) return overrides.details?.(options) ?? Promise.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选择" }, { sound_id: "other", name: "其他" }])]));
    if (path.endsWith("/cancel")) return Promise.resolve(jsonResponse({ success: true }));
    if (path.includes("/stat-tasks") && options.method === "POST") return overrides.task?.(options) ?? Promise.resolve(jsonResponse(completed));
    if (path.includes("/stat-tasks/review-task")) return overrides.snapshot?.(options) ?? Promise.resolve(jsonResponse(completed));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test.each(["missevan", "manbo"])("%s replay loads card metrics and keeps them when cards arrive late", async (platform) => {
  const cards = createDeferred();
  const metrics = createDeferred();
  const fetchMock = stubReplayRequests({ cards: () => cards.promise, metrics: () => metrics.promise });
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => testState.output.onReplayHistoryEntry({
    ...replayHistoryEntry("metrics", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] }),
    platform,
  }));
  await waitFor(() => expect(testState.results.results[0]?.metrics_status).toBe("loading"));
  const metricCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/search-card-metrics"));
  expect(metricCalls()).toHaveLength(1);
  expect(JSON.parse(metricCalls()[0][1].body)).toMatchObject({ platform, id: "42" });
  const freshMetrics = { view_count: 5678, subscription_num: 234, reward_num: 56, diamond_value: 789, pay_count: 67, member_listen_count: 89 };
  await act(async () => metrics.resolve(jsonResponse({ success: true, metrics: freshMetrics })));
  await waitFor(() => expect(testState.results.results[0]).toMatchObject({ ...freshMetrics, metrics_status: "ready" }));
  await act(async () => cards.resolve(jsonResponse({ success: true, results: [{ id: "42", cover: "late-cover", view_count: 1, subscription_num: 1, metrics_status: "pending" }] })));
  expect(testState.results.results[0]).toMatchObject({ ...freshMetrics, cover: "late-cover", metrics_status: "ready" });
  expect(testState.results.selectedEpisodes.map((episode) => episode.sound_id)).toEqual(["picked"]);
  expect(metricCalls()).toHaveLength(1);
});

test("replay keeps completed metrics when episode details arrive after cards", async () => {
  const details = createDeferred();
  const fetchMock = stubReplayRequests({ details: () => details.promise });
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(replayHistoryEntry("metrics-before-details", {
    version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }],
  })); });
  await waitFor(() => expect(testState.results.results[0]).toMatchObject({ metrics_status: "ready", subscription_num: 123, reward_num: 45 }));
  await act(async () => details.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选择" }, { sound_id: "other", name: "其他" }], 1)])));
  await waitFor(() => expect(testState.results.selectedEpisodes.map((episode) => episode.sound_id)).toEqual(["picked"]));
  expect(testState.results.results[0]).toMatchObject({ title: "最新作品", metrics_status: "ready", view_count: 999, subscription_num: 123, reward_num: 45 });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/search-card-metrics"))).toHaveLength(1);
});

test("refresh replaces only the task platform and preserves the other platform results", async () => {
  stubReplayRequests();
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "写入漫播搜索结果" }));
  act(() => testState.results.onPlatformChange("manbo"));
  await waitFor(() => expect(testState.results.results.map((item) => item.id)).toEqual(["mb-77"]));
  await act(async () => testState.output.onReplayHistoryEntry(replayHistoryEntry("cross-platform", {
    version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }],
  })));
  expect(testState.results.platform).toBe("missevan");
  expect(testState.results.results.map((item) => item.id)).toEqual(["42"]);
  expect(testState.results.selectedEpisodes.map((item) => item.sound_id)).toEqual(["picked"]);
  act(() => testState.results.onPlatformChange("manbo"));
  await waitFor(() => expect(testState.results.results.map((item) => item.id)).toEqual(["mb-77"]));
  expect(testState.results.results[0].title).toBe("漫播保留");
});

test.each(["payload", "network"])("%s card failure keeps fresh task details and runs statistics", async (failure) => {
  const fetchMock = stubReplayRequests({ cards: () => failure === "network"
    ? Promise.reject(new Error("cards unavailable"))
    : Promise.resolve(jsonResponse({ success: false })) });
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => testState.output.onReplayHistoryEntry(replayHistoryEntry("fallback", {
    version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }],
  })));
  expect(fetchMock.mock.calls.filter(([url, options]) => String(url).includes("/stat-tasks") && options.method === "POST")).toHaveLength(1);
  expect(testState.results.results[0]).toMatchObject({ id: "42", title: "最新作品", view_count: 999, metrics_status: "ready", subscription_num: 123, reward_num: 45 });
  expect(testState.results.dramas[0].episodes.episode.map((item) => item.selected)).toEqual([true, false]);
  expect(testState.output.historyActionsDisabled).toBe(false);
});

test("late access denial cancels the running refresh task and releases history actions", async () => {
  const cards = createDeferred();
  let taskSignal;
  const fetchMock = stubReplayRequests({
    cards: () => cards.promise,
    task: () => Promise.resolve(jsonResponse({ taskId: "review-task", taskType: "id", status: "running" })),
    snapshot: (options) => {
      taskSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    },
  });
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(replayHistoryEntry("denied", {
    version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }],
  })); });
  await waitFor(() => expect(taskSignal).toBeDefined());
  expect(testState.output.historyActionsDisabled).toBe(true);
  await act(async () => cards.resolve(jsonResponse({ success: false, accessDenied: true })));
  await waitFor(() => expect(testState.output.historyActionsDisabled).toBe(false));
  expect(taskSignal.aborted).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/review-task/cancel"))).toBe(true);
});

test("failed details abort outstanding cards without creating a statistics task", async () => {
  const cards = createDeferred();
  let cardSignal;
  const fetchMock = stubReplayRequests({
    cards: (options) => { cardSignal = options.signal; return cards.promise; },
    details: () => Promise.resolve(jsonResponse([{ success: false, id: "42" }])),
  });
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => testState.output.onReplayHistoryEntry(replayHistoryEntry("failed-details", {
    version: 1, operation: "paid_id", dramaIds: ["42"],
  })));
  expect(cardSignal.aborted).toBe(true);
  expect(testState.output.historyActionsDisabled).toBe(false);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/stat-tasks"))).toBe(false);
  await act(async () => cards.resolve(jsonResponse({ success: true, results: [{ id: "42", cover: "stale" }] })));
  expect(testState.results.results).toEqual([]);
});

test.each(["failed", "cancelled"])("ToolView releases history actions when an ordinary task is %s", async (status) => {
  const registration = createDeferred();
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    if (path.includes("/register-new-drama-ids")) return registration.promise;
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.reject(new Error("statistics request failed"));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "写入 API 搜索结果" }));
  fireEvent.click(screen.getByRole("button", { name: "启动 ID 统计" }));
  await waitFor(() => expect(testState.output.historyActionsDisabled).toBe(true));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/register-new-drama-ids"))).toBe(true));
  if (status === "failed") {
    await act(async () => registration.resolve(jsonResponse({ success: true })));
  } else {
    await act(async () => testState.output.onCancelStatistics());
    await waitFor(() => expect(testState.output.historyActionsDisabled).toBe(false));
    await act(async () => registration.resolve(jsonResponse({ success: true })));
  }
  await waitFor(() => expect(testState.output.historyActionsDisabled).toBe(false));
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/stat-tasks"))).toBe(status === "failed");
});

test("paid replay refreshes the work and submits newly paid episodes", async () => {
  const entry = replayHistoryEntry("paid", { version: 1, operation: "paid_id", dramaIds: ["42"] });
  const bodies = [];
  const detailBodies = [];
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return Promise.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "最新作品", metrics_status: "loaded" }] }));
    if (path.includes("/getdramas")) {
      detailBodies.push(JSON.parse(options.body));
      return Promise.resolve(jsonResponse([freshDrama([
        { sound_id: "old", name: "旧付费", need_pay: true },
        { sound_id: "new", name: "新增付费", need_pay: true },
      ])]));
    }
    if (path.includes("/stat-tasks") && options.method === "POST") {
      bodies.push(JSON.parse(options.body));
      return Promise.resolve(jsonResponse({ taskId: "paid-task", taskType: "id", status: "completed", result: { idResults: [] } }));
    }
    if (path.includes("/stat-tasks/paid-task")) return Promise.resolve(jsonResponse({ taskId: "paid-task", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(detailBodies).toEqual([{ drama_ids: ["42"], force_refresh: true, sound_id_map: {} }]);
  expect(fetchMock.mock.calls.some(([url, options]) => String(url).includes("/getdramacards") && JSON.parse(options.body).suppressUsageLog === true)).toBe(true);
  expect(bodies[0].episodes.map((item) => item.sound_id)).toEqual(["old", "new"]);
  expect(bodies[0].source).toBe("42payIDrefresh");
});

test("late replay cards patch after statistics completes without losing refreshed selection", async () => {
  const cards = createDeferred();
  const entry = replayHistoryEntry("late-cards", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] });
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return cards.promise;
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选中" }, { sound_id: "other", name: "未选" }])]));
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/stat-tasks/done")) return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(screen.getByTestId("stats-running")).toHaveTextContent("false"));
  expect(screen.getByTestId("selected-ids")).toHaveTextContent("picked");
  await act(async () => { cards.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "任务卡", cover: "late-cover", view_count: 1 }] })); });
  await waitFor(() => expect(screen.getByTestId("result-ids")).toHaveTextContent("42"));
  expect(testState.results.results[0]).toMatchObject({ cover: "late-cover", view_count: 999 });
  expect(testState.results.dramas[0].episodes.episode.map((episode) => episode.selected)).toEqual([true, false]);
  expect(screen.getByTestId("selected-ids")).toHaveTextContent("picked");
});

test("replay cards may arrive before fresh details and still preserve the selected episode", async () => {
  const details = createDeferred();
  const entry = replayHistoryEntry("cards-first", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] });
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return Promise.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "卡先到" }] }));
    if (path.includes("/getdramas")) return details.promise;
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/stat-tasks/done")) return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(screen.getByTestId("result-ids")).toHaveTextContent("42"));
  await act(async () => { details.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选择" }, { sound_id: "other", name: "其他" }])])); });
  await waitFor(() => expect(screen.getByTestId("selected-ids")).toHaveTextContent("picked"));
});

test("a new search prevents late replay cards from overwriting its results", async () => {
  const cards = createDeferred();
  const entry = replayHistoryEntry("late-search", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] });
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return cards.promise;
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选择" }])]));
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/stat-tasks/done")) return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(screen.getByTestId("selected-ids")).toHaveTextContent("picked"));
  fireEvent.click(screen.getByRole("button", { name: "写入 API 搜索结果" }));
  await act(async () => { cards.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "旧卡", cover: "stale-cover" }] })); });
  await waitFor(() => expect(screen.getByTestId("result-ids")).toHaveTextContent("42"));
  expect(testState.results.results[0]).toMatchObject({ title: "待登记作品" });
  expect(testState.results.results[0].cover).not.toBe("stale-cover");
});

test("cancelling a completed replay prevents its late cards from overwriting current results", async () => {
  const cards = createDeferred();
  const entry = replayHistoryEntry("late-cancel", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] });
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return cards.promise;
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([{ sound_id: "picked", name: "选择" }])]));
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/stat-tasks/done")) return Promise.resolve(jsonResponse({ taskId: "done", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(screen.getByTestId("stats-running")).toHaveTextContent("false"));
  act(() => { testState.output.onCancelStatistics(); });
  await act(async () => { cards.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "旧卡", cover: "stale-cover" }] })); });
  expect(testState.results.results[0]?.cover).not.toBe("stale-cover");
});

test.each([
  ["paid", { version: 1, operation: "paid_id", dramaIds: ["42"] }, "42payIDrefresh", "id"],
  ["custom", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] }, "customrefresh", "id"],
  ["play", { version: 1, operation: "play_count", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] }, "customrefresh", "play_count"],
  ["revenue", { version: 1, operation: "revenue", source: "42earn", dramaIds: ["42"] }, "42earnrefresh", "revenue"],
  ["empty", { version: 1, operation: "id", source: "", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] }, "refresh", "id"],
])("%s replay keeps its saved source base when refreshing", async (_name, replay, expectedSource, taskType) => {
  const bodies = [];
  const result = taskType === "play_count"
    ? { playCountResults: [{ dramaId: "42", title: "最新作品", playCount: 900 }], playCountTotal: 900 }
    : taskType === "revenue"
      ? { revenueResults: [{ dramaId: "42", title: "最新作品", estimatedRevenueYuan: 1, paidUserCount: 1 }] }
      : { idResults: [{ dramaId: "42", title: "最新作品", users: 1, danmaku: 1 }] };
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramacards")) return Promise.resolve(jsonResponse({ success: true, results: [{ id: "42", title: "卡" }] }));
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama(
      _name === "custom" || _name === "empty"
        ? [{ sound_id: "picked", name: "全部当前付费集", need_pay: true }]
        : [{ sound_id: "picked", name: "选中", need_pay: true }, { sound_id: "new-paid", name: "新增", need_pay: true }], 900
    )]));
    if (path.includes("/stat-tasks") && options.method === "POST") {
      bodies.push(JSON.parse(options.body));
      return Promise.resolve(jsonResponse({ taskId: `source-${bodies.length}`, taskType, status: "completed", result }));
    }
    if (path.includes("/stat-tasks/source-")) return Promise.resolve(jsonResponse({ taskId: `source-${bodies.length}`, taskType, status: "completed", result }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(replayHistoryEntry(`source-${_name}`, replay)); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].source).toBe(expectedSource);
  await waitFor(() => expect(testState.output.historyEntries).toHaveLength(1));
  const stored = JSON.parse(globalThis.localStorage.getItem("missevan-counter.history.v1"));
  expect(stored.missevan[0].replay.source ?? "").toBe(expectedSource.slice(0, -7));
  if (_name === "custom") {
    await act(async () => { testState.output.onReplayHistoryEntry(testState.output.historyEntries[0]); });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].source).toBe("customrefresh");
    await waitFor(() => expect(testState.output.historyEntries).toHaveLength(2));
    expect(testState.output.historyEntries.every((entry) => entry.replay.source === "custom")).toBe(true);
  }
});

test("ToolView releases history action busy state after an ordinary run finishes", async () => {
  const registration = createDeferred();
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/register-new-drama-ids")) return registration.promise;
    if (path.includes("/stat-tasks") && options.method === "POST") return Promise.resolve(jsonResponse({ taskId: "ordinary", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/stat-tasks/ordinary")) return Promise.resolve(jsonResponse({ taskId: "ordinary", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "写入 API 搜索结果" }));
  fireEvent.click(await screen.findByRole("button", { name: "启动 ID 统计" }));
  await waitFor(() => expect(screen.getByTestId("history-disabled")).toHaveTextContent("true"));
  await act(async () => { registration.resolve(jsonResponse({ success: true })); });
  await waitFor(() => expect(screen.getByTestId("history-disabled")).toHaveTextContent("false"));
});

test("cancelling replay preparation prevents a delayed refreshed work from starting a task", async () => {
  const deferred = createDeferred();
  let refreshSignal;
  const entry = replayHistoryEntry("delayed", { version: 1, operation: "paid_id", dramaIds: ["42"] });
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) { refreshSignal = options.signal; return deferred.promise; }
    if (path.includes("/stat-tasks")) throw new Error("cancelled preparation must not start a task");
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  act(() => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/getdramas"))).toBe(true));
  act(() => { testState.output.onReplayHistoryEntry(replayHistoryEntry("other", { version: 1, operation: "paid_id", dramaIds: ["99"] })); });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/getdramas"))).toHaveLength(1);
  act(() => { testState.output.onCancelReplayPreparation(); });
  expect(refreshSignal.aborted).toBe(true);
  await act(async () => { deferred.resolve(jsonResponse([freshDrama([{ sound_id: "late", need_pay: true }])])); await Promise.resolve(); });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/stat-tasks"))).toHaveLength(0);
});

test("custom replay preserves its exact range and does not create a task when an episode is missing", async () => {
  const entry = replayHistoryEntry("custom", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["kept", "gone"] }] });
  const fetchMock = vi.fn((url) => {
    const path = String(url);
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([{ sound_id: "kept", name: "保留" }])]));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    if (path.includes("/stat-tasks")) throw new Error("must not shrink custom replay");
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/getdramas"))).toBe(true));
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/stat-tasks"))).toHaveLength(0);
});

test("custom replay submits only its saved episode when refreshed work gains episodes", async () => {
  const entry = replayHistoryEntry("fixed", { version: 1, operation: "id", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["kept"] }] });
  const bodies = [];
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([{ sound_id: "kept", name: "原选" }, { sound_id: "added", name: "新集" }])]));
    if (path.includes("/stat-tasks") && options.method === "POST") { bodies.push(JSON.parse(options.body)); return Promise.resolve(jsonResponse({ taskId: "fixed-task", taskType: "id", status: "completed", result: { idResults: [] } })); }
    if (path.includes("/stat-tasks/fixed-task")) return Promise.resolve(jsonResponse({ taskId: "fixed-task", taskType: "id", status: "completed", result: { idResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].episodes.map((episode) => episode.sound_id)).toEqual(["kept"]);
});

test("play-count replay uses fresh totals and the complete refreshed episode context", async () => {
  const entry = replayHistoryEntry("play", { version: 1, operation: "play_count", source: "custom", dramas: [{ dramaId: "42", episodeIds: ["picked"] }] });
  const bodies = [];
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const path = String(url);
    if (path.includes("/getdramas")) return Promise.resolve(jsonResponse([freshDrama([
      { sound_id: "picked", name: "选择", view_count: 10 }, { sound_id: "other", name: "未选", view_count: 20 },
    ], 1234)]));
    if (path.includes("/stat-tasks") && options.method === "POST") { bodies.push(JSON.parse(options.body)); return Promise.resolve(jsonResponse({ taskId: "play-task", taskType: "play_count", status: "completed", result: { playCountResults: [] } })); }
    if (path.includes("/stat-tasks/play-task")) return Promise.resolve(jsonResponse({ taskId: "play-task", taskType: "play_count", status: "completed", result: { playCountResults: [] } }));
    if (path.includes("/search-card-metrics")) return Promise.resolve(jsonResponse({ success: true, metrics: { view_count: 999, subscription_num: 123, reward_num: 45 } }));
    if (path.includes("/app-config")) return Promise.resolve(jsonResponse({ frontendVersion: "1.0.0", backendVersion: "1.0.0" }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<ToolView initialAppConfig={{ frontendVersion: "1.0.0", backendVersion: "1.0.0" }} />);
  await screen.findByRole("button", { name: "启动 ID 统计" });
  await act(async () => { testState.output.onReplayHistoryEntry(entry); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].playCountDramas[0]).toMatchObject({ drama_id: "42", total_view_count: 1234 });
  expect(bodies[0].playCountDramas[0].episodes.map((item) => [item.sound_id, item.selected])).toEqual([["picked", true], ["other", false]]);
});
