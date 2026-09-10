import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const testState = vi.hoisted(() => ({
  actions: [],
  registration: null,
  registrationStarted: null,
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
  SearchPanel: ({ onUpdatePlatformResults }) => (
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
  ),
}));
vi.mock("@/app/SearchWorkspace", () => ({
  default: ({ output, panelRefs, results }) => {
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
        <output data-testid="stats-action">{output.currentAction}</output>
        <output data-testid="stats-running">{String(output.isRunning)}</output>
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

beforeEach(() => {
  testState.actions = [];
  testState.registration = createDeferred();
  testState.registrationStarted = createDeferred();
  window.history.replaceState({}, "", "/?view=search&platform=missevan");
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
