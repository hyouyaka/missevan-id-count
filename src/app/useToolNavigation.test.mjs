import assert from "node:assert/strict";
import test from "node:test";

import { normalizeToolRouteState } from "./app-utils.js";
import { createToolNavigationController } from "./useToolNavigation.js";

function createNavigationHarness({
  initialRoute = { view: "home" },
  routeOptions = {},
} = {}) {
  let routeState = normalizeToolRouteState(initialRoute, routeOptions);
  const historyCalls = [];
  const browserWindow = {
    location: {
      hash: "",
      pathname: "/tool",
      search: "",
    },
    history: {
      pushState(state, title, url) {
        historyCalls.push({ method: "pushState", state, title, url });
        updateLocation(url);
      },
      replaceState(state, title, url) {
        historyCalls.push({ method: "replaceState", state, title, url });
        updateLocation(url);
      },
    },
  };

  function updateLocation(url) {
    const nextUrl = new URL(url, "https://tool.test");
    browserWindow.location.pathname = nextUrl.pathname;
    browserWindow.location.search = nextUrl.search;
    browserWindow.location.hash = nextUrl.hash;
  }

  const controller = createToolNavigationController({
    getRouteOptions: () => routeOptions,
    getRouteState: () => routeState,
    getWindow: () => browserWindow,
    setRouteState(nextRouteState) {
      routeState = nextRouteState;
    },
  });

  return {
    browserWindow,
    controller,
    getRouteState: () => routeState,
    historyCalls,
    setLocation(url) {
      updateLocation(url);
    },
  };
}

test("consecutive navigation reads the latest route state", () => {
  const harness = createNavigationHarness();

  harness.controller.navigateToolRoute({
    view: "search",
    q: "first query",
    platform: "manbo",
  });
  harness.controller.navigateToolRoute({ q: "second query" });

  assert.deepEqual(harness.getRouteState(), normalizeToolRouteState({
    view: "search",
    q: "second query",
    platform: "manbo",
  }));
  assert.deepEqual(
    harness.historyCalls.map((call) => call.method),
    ["pushState", "pushState"]
  );
  assert.match(harness.historyCalls[1].url, /q=second\+query/);
  assert.match(harness.historyCalls[1].url, /platform=manbo/);
});

test("a detail replace seed survives a no-op and replaces the next detail update", () => {
  const harness = createNavigationHarness();

  harness.controller.navigateCurrentPlatform("ranks");
  assert.equal(harness.controller.getPendingDetailRouteReplace(), true);

  harness.controller.navigateToolRoute({ view: "ranks" });
  assert.equal(harness.controller.getPendingDetailRouteReplace(), true);

  harness.controller.navigateToolRoute({ category: "growth", rank: "growth_weekly" });

  assert.deepEqual(
    harness.historyCalls.map((call) => call.method),
    ["pushState", "replaceState"]
  );
  assert.equal(harness.controller.getPendingDetailRouteReplace(), false);
  assert.equal(harness.getRouteState().category, "growth");
  assert.equal(harness.getRouteState().rank, "growth_weekly");
});

test("URL application clears a pending detail replace seed", () => {
  const harness = createNavigationHarness();

  harness.controller.navigateCurrentPlatform("ongoing");
  assert.equal(harness.controller.getPendingDetailRouteReplace(), true);

  harness.setLocation("/tool?view=search&q=restored&platform=manbo");
  const appliedRoute = harness.controller.applyCurrentPlatformFromUrl();

  assert.equal(harness.controller.getPendingDetailRouteReplace(), false);
  assert.equal(appliedRoute.view, "search");
  assert.equal(appliedRoute.q, "restored");
  assert.equal(appliedRoute.platform, "manbo");
});
