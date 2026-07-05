import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCwIcon,
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  CalculatorIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChartNoAxesColumnIncreasingIcon,
  Clock3Icon,
  PlayCircleIcon,
  HeartIcon,
  HouseIcon,
  MicIcon,
  MonitorIcon,
  ShoppingCartIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  ScrollTextIcon,
  StarIcon,
  Trash2Icon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AppIcon } from "@/app/AppIcon";
import { ChangelogDialog, useChangelogDialog } from "@/app/ChangelogDialog";
import { FavoritesPanel } from "@/app/FavoritesPanel";
import { FeedbackView } from "@/app/FeedbackView";
import { HomeView } from "@/app/HomeView";
import { MessageDialog } from "@/app/MessageDialog";
import { OutputPanel } from "@/app/OutputPanel";
import { SearchPanel } from "@/app/SearchPanel";
import { SearchResults, MetricLegend } from "@/app/SearchResults";
import { PlatformIdIcon } from "@/app/platformTabLabel";
import { fetchRankTrendData } from "@/app/rankTrendData";
import { canParseShareUrl, decryptShareUrl, extractResolvedId } from "@/utils/manboCrypto";
import {
  createFavoriteKey,
  listFavorites,
  removeFavoriteWithSnapshots,
  saveFavorite,
} from "@/app/favoritesStorage";
import {
  buildOngoingNavigationMenu,
  buildRanksNavigationMenu,
  buildRevenueSummary,
  buildToolRouteUrl,
  buildVersionedUrl,
  buildPlayCountDramasFromDramas,
  collectSelectedEpisodesFromDramas,
  createPlatformState,
  createRuntimeMeta,
  createStatsHistoryEntry,
  createStatsState,
  extractResponseItems,
  formatPlainNumber,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  getScrollBehavior,
  isAbortError,
  loadPersistedHistoryEntries,
  mergeAppConfig,
  MISSEVAN_DESKTOP_ACCESS_HINT,
  normalizeToolRouteState,
  normalizeVersion,
  readToolRouteStateFromLocation,
  readJsonResponse,
  resolveIdStatisticsSource,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  selectDramaEpisodesByMode,
  STATS_HISTORY_LIMIT,
} from "@/app/app-utils";
import { fetchRanksData, getCachedRanksData } from "@/app/ranksData";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LazyImage } from "@/components/ui/lazy-image";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

const RanksPanel = lazy(() =>
  import("@/app/RanksPanel").then((module) => ({ default: module.RanksPanel }))
);

const OngoingPanel = lazy(() =>
  import("@/app/OngoingPanel").then((module) => ({ default: module.OngoingPanel }))
);

function getStatsRequestErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "统计失败，请稍后重试。";
}

const mainNavigationIconMap = {
  home: HouseIcon,
  search: CalculatorIcon,
  ongoing: Clock3Icon,
  ranks: ChartNoAxesColumnIncreasingIcon,
  favorites: StarIcon,
  feedback: MessageSquarePlusIcon,
};

function LazyRouteFallback({ title = "正在加载页面", description = "正在准备页面内容。" }) {
  return (
    <div className="grid gap-4 sm:gap-5">
      <Alert className="border-border/70 bg-card/92">
        <RefreshCwIcon className="size-4 animate-spin" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </div>
  );
}

function MainNavigationTabLabel({ platform }) {
  const Icon = mainNavigationIconMap[platform.key];
  const isPlatformIcon = platform.key === "missevan" || platform.key === "manbo";
  return (
    <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
      {isPlatformIcon ? (
        <PlatformIdIcon aria-hidden="true" platform={platform.key} className="size-3.5 shrink-0 sm:size-4" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" />
      ) : null}
      <span className="min-w-0 truncate">{platform.label}</span>
    </span>
  );
}

function isRoutePatchActive(routePatch, currentRoute) {
  if (!routePatch || !currentRoute) {
    return false;
  }
  return Object.entries(routePatch).every(([key, value]) => currentRoute[key] === value);
}

function getFirstNavigationItem(items) {
  return Array.isArray(items) && items.length ? items[0] : null;
}

function getNavigationItem(items, key) {
  return (Array.isArray(items) ? items : []).find((item) => item.key === key) || getFirstNavigationItem(items);
}

function getDefaultRoutePatchForMenu(menu) {
  return getFirstNavigationItem(menu)?.routePatch || null;
}

function getInitialDrawerExpandedRootKeys(currentRoute, isDesktopBrowser) {
  if (isDesktopBrowser) {
    return ["missevan", "manbo"];
  }
  if ((currentRoute?.view === "ongoing" || currentRoute?.view === "ranks") && (currentRoute?.platform === "missevan" || currentRoute?.platform === "manbo")) {
    return [currentRoute.platform];
  }
  return [];
}

function MainNavigationMenuItem({
  item,
  currentRoute,
  className = "",
  activeClassName = "",
  activateOnHover = true,
  branchActive = false,
  childrenHintClassName = "size-3.5 shrink-0 -rotate-90 opacity-70",
  childrenHintPosition = "end",
  onActivateBranch,
  onExpandBranch,
  onNavigate,
  navigateBranchesOnClick = false,
  showChildrenHint = true,
}) {
  const hasChildren = Array.isArray(item?.children) && item.children.length > 0;
  const activeRoutePatch = item?.activeRoutePatch || item?.routePatch;
  const isActive = activeRoutePatch
    ? isRoutePatchActive(activeRoutePatch, currentRoute)
    : currentRoute?.view === item?.key;
  const bodyButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`${className} ${onExpandBranch ? "min-w-0 flex-1" : ""} ${isActive ? activeClassName : ""}`}
      aria-current={isActive ? "page" : undefined}
      onPointerEnter={activateOnHover && hasChildren ? onActivateBranch : undefined}
      onFocus={activateOnHover && hasChildren ? onActivateBranch : undefined}
      onClick={() => {
        if (hasChildren && !navigateBranchesOnClick && !branchActive) {
          onActivateBranch?.();
          return;
        }
        if (item?.routePatch) {
          onNavigate(item.routePatch);
        } else {
          onActivateBranch?.();
        }
      }}
    >
      {showChildrenHint && hasChildren && childrenHintPosition === "start" ? (
        <ChevronDownIcon aria-hidden="true" className={childrenHintClassName} />
      ) : null}
      <span className="inline-flex min-w-0 flex-1 items-center justify-start gap-1.5">
        {item?.platform ? <MainNavigationTabLabel platform={item.platform} /> : <span className="min-w-0 truncate">{item?.label}</span>}
      </span>
      {showChildrenHint && hasChildren && childrenHintPosition === "end" && !onExpandBranch ? (
        <ChevronDownIcon aria-hidden="true" className={childrenHintClassName} />
      ) : null}
    </Button>
  );

  if (!(showChildrenHint && hasChildren && onExpandBranch)) {
    return bodyButton;
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {bodyButton}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
        aria-label={`${item.label}${branchActive ? "收起" : "展开"}`}
        onPointerEnter={activateOnHover && hasChildren ? onActivateBranch : undefined}
        onFocus={activateOnHover && hasChildren ? onActivateBranch : undefined}
        onClick={onExpandBranch}
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-3.5 transition-transform ${branchActive ? "rotate-180" : "-rotate-90"}`}
        />
      </Button>
    </div>
  );
}

function DesktopMainNavigationMenu({
  platforms,
  currentRoute,
  ongoingMenu,
  ranksMenu,
  ranksMenuStatus,
  onRequestRanksMenu,
  onNavigateRoute,
}) {
  const [openKey, setOpenKey] = useState("");
  const [activePlatformKey, setActivePlatformKey] = useState("");
  const [menuAnchorStyle, setMenuAnchorStyle] = useState({ left: "0px" });
  const [hoverCapable, setHoverCapable] = useState(true);
  const rootRef = useRef(null);
  const triggerRefs = useRef({});
  const closeTimerRef = useRef(null);
  const menuItemClassName = "h-8 min-w-[7rem] justify-start gap-2 px-2.5 text-[13px] font-medium text-foreground";
  const activeItemClassName = "bg-accent text-accent-foreground";

  const openMenu = openKey === "ongoing" || openKey === "ranks";
  const sourceMenu = openKey === "ongoing" ? ongoingMenu : openKey === "ranks" ? ranksMenu : [];
  const activePlatform = activePlatformKey ? getNavigationItem(sourceMenu, activePlatformKey) : null;

  function cancelCloseMenu() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function closeMenu() {
    cancelCloseMenu();
    setOpenKey("");
    setActivePlatformKey("");
  }

  function scheduleCloseMenu() {
    cancelCloseMenu();
    closeTimerRef.current = window.setTimeout(() => {
      closeMenu();
    }, 260);
  }

  function updateMenuAnchor(platformKey) {
    const trigger = triggerRefs.current[platformKey];
    const root = rootRef.current;
    if (!trigger || !root) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setMenuAnchorStyle({
      left: `${Math.max(0, Math.round(triggerRect.left - rootRect.left))}px`,
    });
  }

  function handleOpen(platformKey) {
    cancelCloseMenu();
    updateMenuAnchor(platformKey);
    if (platformKey === "ranks") {
      onRequestRanksMenu?.();
    }
    if (platformKey === "ongoing" || platformKey === "ranks") {
      setOpenKey(platformKey);
      setActivePlatformKey("");
    } else {
      closeMenu();
    }
  }

  function handleToggleTouchMenu(platformKey) {
    cancelCloseMenu();
    updateMenuAnchor(platformKey);
    if (platformKey === "ranks") {
      onRequestRanksMenu?.();
    }
    if (openKey === platformKey) {
      closeMenu();
      return;
    }
    if (platformKey === "ongoing" || platformKey === "ranks") {
      setOpenKey(platformKey);
      setActivePlatformKey("");
    }
  }

  function navigate(routePatch) {
    onNavigateRoute(routePatch);
    closeMenu();
  }

  function navigateDefaultRoute(menu, fallbackRoutePatch = null) {
    const routePatch = getDefaultRoutePatchForMenu(menu) || fallbackRoutePatch;
    if (routePatch) {
      navigate(routePatch);
    }
  }

  function activatePlatformBranch(item) {
    setActivePlatformKey(item.key);
  }

  function expandPlatformBranch(item) {
    setActivePlatformKey((current) => (current === item.key ? "" : item.key));
  }

  useEffect(() => {
    if (!openKey) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        closeMenu();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openKey]);

  useEffect(() => {
    return () => {
      cancelCloseMenu();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateHoverCapability = () => {
      setHoverCapable(mediaQuery.matches);
    };
    updateHoverCapability();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateHoverCapability);
      return () => mediaQuery.removeEventListener("change", updateHoverCapability);
    }
    mediaQuery.addListener?.(updateHoverCapability);
    return () => mediaQuery.removeListener?.(updateHoverCapability);
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative hidden sm:block"
      onPointerEnter={hoverCapable ? cancelCloseMenu : undefined}
      onPointerLeave={hoverCapable ? scheduleCloseMenu : undefined}
    >
      <div className="flex h-9 w-fit items-center gap-1 rounded-lg border border-border/80 bg-muted/55 p-0.5">
        {platforms.map((platform) => {
          const hasRouteMenu = platform.key === "ongoing" || platform.key === "ranks";
          const isActive = currentRoute?.view === platform.key;
          return (
            <Button
              ref={(element) => {
                triggerRefs.current[platform.key] = element;
              }}
              key={platform.key}
              type="button"
              variant="ghost"
              size="sm"
              className={`h-[30px] px-1.5 text-[13px] sm:px-3 sm:text-sm ${isActive ? "bg-background text-foreground shadow-sm" : ""}`}
              aria-expanded={hasRouteMenu && openKey === platform.key ? true : undefined}
              aria-current={isActive ? "page" : undefined}
              onPointerEnter={hoverCapable ? () => handleOpen(platform.key) : undefined}
              onFocus={hoverCapable ? () => handleOpen(platform.key) : undefined}
              onClick={() => {
                if (hasRouteMenu && !hoverCapable) {
                  handleToggleTouchMenu(platform.key);
                  return;
                }
                if (hasRouteMenu) {
                  navigateDefaultRoute(platform.key === "ongoing" ? ongoingMenu : ranksMenu, { view: platform.key });
                } else {
                  navigate({ view: platform.key });
                }
              }}
            >
              <MainNavigationTabLabel platform={platform} />
              {hasRouteMenu ? <ChevronDownIcon aria-hidden="true" className="ml-1 size-3.5" /> : null}
            </Button>
          );
        })}
      </div>

      {openMenu ? (
        <>
          <div className="absolute top-full z-30 h-3 w-36" style={menuAnchorStyle} />
          <div className="absolute top-full z-40 mt-2 flex items-start gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-[var(--shadow-panel)]" style={menuAnchorStyle}>
          {openKey === "ranks" && ranksMenuStatus === "loading" ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">加载中</div>
          ) : openKey === "ranks" && ranksMenuStatus === "error" ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">榜单暂不可用</div>
          ) : (
            <>
              <div className="grid min-w-[7.5rem] gap-1">
                {sourceMenu.map((item) => (
                  <MainNavigationMenuItem
                    key={item.key}
                    item={item}
                    currentRoute={currentRoute}
                    className={menuItemClassName}
                    activeClassName={activeItemClassName}
                    activateOnHover={hoverCapable}
                    branchActive={activePlatformKey === item.key}
                    onActivateBranch={() => activatePlatformBranch(item)}
                    onExpandBranch={!hoverCapable ? () => expandPlatformBranch(item) : undefined}
                    onNavigate={navigate}
                    navigateBranchesOnClick={true}
                  />
                ))}
              </div>
              {activePlatformKey && activePlatform?.children?.length ? (
                <div className="grid min-w-[7.5rem] gap-1 border-l border-border/70 pl-1.5">
                  {activePlatform.children.map((item) => (
                    <MainNavigationMenuItem
                      key={item.key}
                      item={item}
                      currentRoute={currentRoute}
                      className={menuItemClassName}
                      activeClassName={activeItemClassName}
                      onNavigate={navigate}
                      navigateBranchesOnClick={true}
                      showChildrenHint={false}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MainNavigationDrawer({
  platforms,
  currentRoute,
  ongoingMenu,
  ranksMenu,
  ranksMenuStatus,
  defaultExpandedRootKeys = [],
  drawerRootItemClassName,
  drawerChildItemClassName,
  drawerUtilityItemClassName,
  mobileMenuActiveItemClassName,
  onRequestRanksMenu,
  onCommitRoute,
  onOpenChangelog,
  onOpenFeedback,
  featureSuggestionUrl,
  desktopApp,
  desktopAppUrl,
}) {
  const [expandedRootKeys, setExpandedRootKeys] = useState(() => new Set(defaultExpandedRootKeys));
  const didRequestInitialDrawerRanksRef = useRef(false);
  const rootItems = platforms.map((platform) => {
    if (platform.key === "missevan" || platform.key === "manbo") {
      return buildDrawerPlatformItem(platform);
    }
    return {
      key: platform.key,
      label: platform.label,
      platform,
      routePatch: { view: platform.key },
    };
  });

  function getPlatformOngoingItem(platform) {
    const platformOngoingItem = getNavigationItem(ongoingMenu, platform.key);
    return {
      key: `${platform.key}-ongoing`,
      label: "更新",
      routePatch: platformOngoingItem?.routePatch || { view: "ongoing", platform: platform.key, window: "7d" },
      activeRoutePatch: platformOngoingItem?.activeRoutePatch || { view: "ongoing", platform: platform.key },
    };
  }

  function getPlatformRankItems(platform) {
    const platformRankMenu = (Array.isArray(ranksMenu) ? ranksMenu : []).find((item) => item.key === platform.key);
    return (Array.isArray(platformRankMenu?.children) ? platformRankMenu.children : []).map((category) => ({
      key: `${platform.key}-${category.key}`,
      label: category.label,
      routePatch: category.routePatch,
      activeRoutePatch: category.activeRoutePatch,
    }));
  }

  function buildDrawerPlatformItem(platform) {
    const children = [getPlatformOngoingItem(platform), ...getPlatformRankItems(platform)];
    return {
      key: platform.key,
      label: platform.label,
      platform,
      leafPatch: getFirstNavigationItem(children)?.routePatch || { view: "ongoing", platform: platform.key, window: "7d" },
      hasSubmenu: true,
      children,
    };
  }

  useEffect(() => {
    if (!didRequestInitialDrawerRanksRef.current && defaultExpandedRootKeys.some((key) => key === "missevan" || key === "manbo")) {
      didRequestInitialDrawerRanksRef.current = true;
      onRequestRanksMenu?.();
    }
  }, []);

  function toggleRoot(key) {
    if (key === "missevan" || key === "manbo") {
      onRequestRanksMenu?.();
    }
    setExpandedRootKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function navigate(routePatch) {
    onCommitRoute(routePatch);
    setExpandedRootKeys(new Set());
  }

  function isMobileItemActive(item) {
    if (item?.key === "missevan" || item?.key === "manbo") {
      return (currentRoute?.view === "ongoing" || currentRoute?.view === "ranks") && currentRoute?.platform === item.key;
    }
    const activeRoutePatch = item?.activeRoutePatch || item?.leafPatch || item?.routePatch;
    return activeRoutePatch ? isRoutePatchActive(activeRoutePatch, currentRoute) : false;
  }

  function handleMobileItemClick(item, hasChildren, onToggle) {
    if (hasChildren) {
      onToggle?.();
      return;
    }
    const routePatch = item?.leafPatch || item?.routePatch;
    if (!hasChildren && routePatch) {
      navigate(routePatch);
    }
  }

  function renderMobileItem(item, { expanded = false, onToggle, indent = false } = {}) {
    const hasChildren = item?.hasSubmenu === true || (Array.isArray(item.children) && item.children.length > 0);
    const itemClassName = indent ? drawerChildItemClassName : drawerRootItemClassName;
    if (!hasChildren) {
      const routePatch = item?.routePatch || item?.leafPatch || null;
      return (
        <MainNavigationMenuItem
          key={item.key}
          item={{ ...item, routePatch }}
          currentRoute={currentRoute}
          className={`${itemClassName} ${indent ? "pl-5" : ""}`}
          activeClassName={mobileMenuActiveItemClassName}
          activateOnHover={false}
          onNavigate={navigate}
          showChildrenHint={false}
        />
      );
    }
    const isActive = isMobileItemActive(item) || expanded;
    return (
      <Button
        key={item.key}
        type="button"
        variant="ghost"
        size="sm"
        className={`${itemClassName} ${indent ? "pl-5" : ""} pr-8 ${isActive ? mobileMenuActiveItemClassName : ""}`}
        aria-expanded={expanded}
        aria-current={isMobileItemActive(item) ? "page" : undefined}
        onClick={() => handleMobileItemClick(item, hasChildren, onToggle)}
      >
        <span className="inline-flex min-w-0 flex-1 items-center justify-start gap-1.5">
          {item?.platform ? <MainNavigationTabLabel platform={item.platform} /> : <span className="min-w-0 truncate">{item?.label}</span>}
        </span>
        {expanded ? (
          <ChevronUpIcon aria-hidden="true" className="ml-auto size-3.5 shrink-0 opacity-70" />
        ) : (
          <ChevronDownIcon aria-hidden="true" className="ml-auto size-3.5 shrink-0 opacity-70" />
        )}
      </Button>
    );
  }

  return (
    <div
      id="main-navigation-drawer"
      className="fixed right-0 top-0 z-50 h-dvh w-[230px] max-w-[calc(100vw-0.75rem)] overflow-y-auto overscroll-contain border-l border-border bg-background p-3 shadow-[var(--shadow-panel)] sm:w-[260px]"
    >
      <div className="grid min-h-full content-start gap-1">
        {rootItems.map((item) => (
          <div key={item.key} className="grid gap-1">
            {renderMobileItem(item, {
              expanded: expandedRootKeys.has(item.key),
              onToggle: () => toggleRoot(item.key),
            })}
            {expandedRootKeys.has(item.key) ? (
              <div className="ml-2 grid gap-1 border-l border-border/70 pl-2">
                {item.children.map((menuItem) => renderMobileItem(menuItem, { indent: true }))}
                {(item.key === "missevan" || item.key === "manbo") && ranksMenuStatus === "loading" ? (
                  <div className="px-2.5 py-2 text-sm text-muted-foreground">加载中</div>
                ) : (item.key === "missevan" || item.key === "manbo") && ranksMenuStatus === "error" ? (
                  <div className="px-2.5 py-2 text-sm text-muted-foreground">榜单暂不可用</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-border/80" />
        {!desktopApp && featureSuggestionUrl ? (
          <Button type="button" variant="ghost" size="sm" className={drawerUtilityItemClassName} onClick={onOpenFeedback}>
            <MainNavigationTabLabel platform={{ key: "feedback", label: "建议反馈" }} />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" className={drawerUtilityItemClassName} onClick={onOpenChangelog}>
          <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
            <ScrollTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">更新日志</span>
          </span>
        </Button>
        {desktopAppUrl ? (
          <Button type="button" variant="ghost" size="sm" className={drawerUtilityItemClassName} asChild>
            <a href={desktopAppUrl} rel="noreferrer" target="_blank">
              <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
                <MonitorIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">桌面版</span>
              </span>
            </a>
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" className={drawerUtilityItemClassName} disabled>
            <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
              <MonitorIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">桌面版</span>
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

function createIdleBackgroundTask() {
  return {
    isRunning: false,
    status: "idle",
    type: "",
    title: "",
    description: "",
    progress: 0,
    action: "",
    resultTarget: "",
    highlighted: false,
  };
}

function BackgroundTaskCenter({ task, isDesktopApp, onOpenResults, onDismiss }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (task?.isRunning && !wasRunningRef.current) {
      setDesktopCollapsed(false);
    }
    wasRunningRef.current = Boolean(task?.isRunning);
  }, [task?.isRunning]);

  if (!task?.isRunning && !task?.highlighted) {
    return null;
  }

  const title = task.title || (task.type === "favorites_refresh" ? "收藏刷新" : "后台任务");
  const action = task.action || task.description || (task.isRunning ? "运行中" : "已完成");
  const progress = Number(task.progress ?? 0) || 0;
  const statusText = task.isRunning ? "进行中" : task.status === "failed" ? "失败" : task.status === "cancelled" ? "已取消" : "已完成";

  function handleDesktopDismiss() {
    if (task?.isRunning) {
      setDesktopCollapsed(true);
      return;
    }
    onDismiss?.();
  }

  function renderDetail({ allowRunningDismiss = false } = {}) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="truncate text-xs text-muted-foreground">{action}</div>
          </div>
          <Badge variant={task.isRunning ? "default" : "secondary"} className="shrink-0">{statusText}</Badge>
        </div>
        <Progress value={progress} className="h-2.5 rounded-full bg-muted" indicatorClassName="bg-primary" />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{progress}%</span>
          <div className="flex items-center gap-1.5">
            {task.resultTarget ? (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                data-touch="compact"
                className="relative overflow-visible after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
                onClick={onOpenResults}
              >
                查看结果
              </Button>
            ) : null}
            {allowRunningDismiss || !task.isRunning ? (
              <Button type="button" size="xs" variant="ghost" onClick={allowRunningDismiss ? handleDesktopDismiss : onDismiss}>
                收起
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-3 mobile-fixed-bottom z-40 hidden sm:block">
        {desktopCollapsed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="展开后台任务中心"
            className={`pointer-events-auto mx-auto flex max-w-max items-center gap-2 rounded-full border-border/80 bg-surface-floating px-3 shadow-[var(--shadow-panel)] backdrop-blur-xl ${isDesktopApp ? "ring-1 ring-primary/16" : ""}`}
            onClick={() => setDesktopCollapsed(false)}
          >
            <RefreshCwIcon aria-hidden="true" className={task.isRunning ? "size-3.5 animate-spin" : "size-3.5"} />
            <span className="max-w-40 truncate text-xs font-medium">{title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{progress}%</span>
            <Badge variant={task.isRunning ? "default" : "secondary"} className="shrink-0">{statusText}</Badge>
            <span className="text-xs text-primary">展开</span>
          </Button>
        ) : (
          <div className={`pointer-events-auto mx-auto max-w-xl rounded-lg border border-border/80 bg-surface-floating p-3 shadow-[var(--shadow-panel)] backdrop-blur-xl ${isDesktopApp ? "ring-1 ring-primary/16" : ""}`}>
            {renderDetail({ allowRunningDismiss: true })}
          </div>
        )}
      </div>
      <div className="fixed mobile-fixed-bottom right-3 z-40 sm:hidden">
        <Button
          type="button"
          variant={task.isRunning ? "secondary" : "outline"}
          size="icon-lg"
          aria-expanded={mobileOpen}
          aria-label="后台任务中心"
          className="relative shadow-[var(--shadow-panel)]"
          onClick={() => setMobileOpen((current) => !current)}
        >
          <RefreshCwIcon aria-hidden="true" className={task.isRunning ? "size-4 animate-spin" : "size-4"} />
          <span className="absolute -right-1.5 -top-1 min-w-7 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.58rem] font-semibold leading-none text-primary-foreground tabular-nums">
            {`${progress}%`}
          </span>
        </Button>
        {mobileOpen ? (
          <div className="absolute bottom-12 right-0 w-[min(21rem,calc(100vw-1.5rem))] rounded-lg border border-border/80 bg-surface-floating p-3 shadow-[var(--shadow-panel)] backdrop-blur-xl">
            {renderDetail()}
          </div>
        ) : null}
      </div>
    </>
  );
}

const MAX_COMPARE_ITEMS = 6;
const COMPARE_WINDOWS = ["3d", "7d", "30d"];
const COMPARE_CHART_MODES = [
  { key: "absolute", label: "绝对值" },
  { key: "increment", label: "增量" },
];
const COMPARE_METRICS = [
  { key: "view_count", label: "播放量", icon: PlayCircleIcon },
  { key: "subscription_num", label: "追剧人数", icon: HeartIcon },
  { key: "danmaku_uid_count", label: "付费ID数", icon: UsersRoundIcon },
  { key: "pay_count", label: "付费/收听人数", icon: ShoppingCartIcon },
];
const comparePalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--accent-rose)",
  "var(--accent-neutral)",
];

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function formatTrendDate(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized.slice(5, 7)}/${normalized.slice(8, 10)}`
    : normalized || "未知";
}

function formatSignedPlainNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "暂无";
  }
  return `${number > 0 ? "+" : ""}${formatPlainNumber(number)}`;
}

function formatOptionalPlainNumber(value) {
  if (value == null || String(value).trim() === "") {
    return "暂无";
  }
  return formatPlainNumber(value);
}

function formatComparePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return "暂无";
  }
  const rounded = Math.round(percent * 1000) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(Math.abs(rounded) >= 100 ? 0 : 1)}%`;
}

function getCompareItemKey(item) {
  return `${String(item?.compareKind ?? "drama").trim()}:${String(item?.platform ?? "").trim()}:${String(item?.id ?? "").trim()}`;
}

function getMetricFromTrend(trendData, windowKey, metricKey) {
  const metrics = Array.isArray(trendData?.windows?.[windowKey]?.metrics)
    ? trendData.windows[windowKey].metrics
    : [];
  return metrics.find((metric) => metric.key === metricKey) || null;
}

function hasCompareMetricValues(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  return history.some((point) => point?.value != null && String(point.value).trim() !== "");
}

function isCompareMetricAvailableForItem(item, windowKey, metricKey) {
  const metric = getMetricFromTrend(item?.trendData, windowKey, metricKey);
  return Boolean(metric && metric.available !== false && hasCompareMetricValues(metric));
}

function getMetricLatestValue(trendData, windowKey, metricKey) {
  const metric = getMetricFromTrend(trendData, windowKey, metricKey);
  const history = Array.isArray(metric?.history) ? metric.history : [];
  const latest = [...history].reverse().find((point) => point?.value != null && String(point.value).trim() !== "");
  return latest?.value ?? null;
}

function getCompareAxisTick(value, metricKey) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  if (metricKey === "view_count" || Math.abs(number) >= 10000) {
    const wan = number / 10000;
    return `${wan.toLocaleString("zh-CN", { maximumFractionDigits: Math.abs(wan) >= 100 ? 0 : 1 })}万`;
  }
  return formatPlainNumber(Math.round(number));
}

function buildCompareChartMetrics(items, windowKey, metricOption) {
  if (!metricOption?.key) {
    return [];
  }
  return items
    .map((item, index) => {
      const metric = getMetricFromTrend(item.trendData, windowKey, metricOption.key);
      if (!metric) {
        return null;
      }
      return {
        ...metric,
        key: `${item.key}:${metricOption.key}`,
        label: item.title,
        item,
        color: item.compareColor || comparePalette[index % comparePalette.length],
      };
    })
    .filter(Boolean);
}

function CompareTrendChart({ items, windowKey, metricOption, chartMode, chartUtils }) {
  const {
    buildTrendChartLines,
    filterNonZeroTrendMetrics,
    getTrendAxisLabelMarkers,
    getTrendAxisY,
  } = chartUtils || {};

  if (
    typeof buildTrendChartLines !== "function" ||
    typeof filterNonZeroTrendMetrics !== "function" ||
    typeof getTrendAxisLabelMarkers !== "function" ||
    typeof getTrendAxisY !== "function"
  ) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
        正在加载趋势图
      </div>
    );
  }

  const chartMetrics = filterNonZeroTrendMetrics(buildCompareChartMetrics(items, windowKey, metricOption));
  const chartData = buildTrendChartLines(chartMetrics, { chartMode });
  const axis = chartData?.axis || chartData?.axes?.left;
  const axisLabelMarkers = getTrendAxisLabelMarkers(chartData?.lines?.[0]?.markers || [], windowKey);

  if (!metricOption?.key || !chartMetrics.length || !axis?.domain || !Array.isArray(chartData?.lines) || !chartData.lines.length) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
        当前指标暂无可对比趋势
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-card)]">
      <div className="relative h-56 overflow-visible rounded-md bg-background">
        <svg aria-label="剧集对比趋势图" className="size-full" preserveAspectRatio="none" viewBox="0 0 320 170">
          {(axis.ticks || []).map((tick) => (
            <line
              key={`compare-grid-${tick}`}
              x1="44"
              x2="302"
              y1={getTrendAxisY(tick, axis.domain)}
              y2={getTrendAxisY(tick, axis.domain)}
              stroke="var(--border)"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          ))}
          {chartData.lines.map((line) => (
            <g key={line.metric.key}>
              {(line.segments || []).map((segment, index) => (
                <polyline
                  key={`${line.metric.key}-${index}`}
                  fill="none"
                  points={segment.map(({ position }) => `${position.x},${position.y}`).join(" ")}
                  stroke={line.metric.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-y-0 left-1 top-0 w-12 text-[0.52rem] font-medium text-muted-foreground">
          {(axis.ticks || []).map((tick) => {
            const y = getTrendAxisY(tick, axis.domain);
            return (
              <span
                key={`compare-axis-${tick}`}
                className="absolute right-1 -translate-y-1/2 tabular-nums"
                style={{ top: `${(y / 170) * 100}%` }}
              >
                {getCompareAxisTick(tick, metricOption.key)}
              </span>
            );
          })}
        </div>
        {chartData.lines.flatMap((line) =>
          (line.markers || []).map(({ point, position }) => (
              <span
                key={`${line.metric.key}-${point.date}`}
                aria-hidden="true"
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
                style={{
                  borderColor: line.metric.color,
                  left: `${(position.x / 320) * 100}%`,
                  top: `${(position.y / 170) * 100}%`,
                }}
              />
            ))
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-[0.58rem] text-muted-foreground">
          {axisLabelMarkers.map(({ point, position }) => (
            <span
              key={`compare-date-${point.date}`}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(position.x / 320) * 100}%` }}
            >
              {formatTrendDate(point.date)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
        {chartData.lines.map((line) => (
          <span key={`compare-legend-${line.metric.key}`} className="inline-flex min-w-0 items-center gap-1">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: line.metric.color }} />
            <span className="max-w-28 truncate">{line.metric.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DramaCompareDialog({ open, onOpenChange, items, frontendVersion, handleVersionResponse }) {
  const [selectedMetric, setSelectedMetric] = useState("view_count");
  const [selectedWindow, setSelectedWindow] = useState("7d");
  const [selectedChartMode, setSelectedChartMode] = useState("absolute");
  const [trendItems, setTrendItems] = useState([]);
  const [trendChartUtils, setTrendChartUtils] = useState(null);
  const [selectedCompareItemKeys, setSelectedCompareItemKeys] = useState(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const handleVersionResponseRef = useRef(handleVersionResponse);
  const compareItemsKey = items.map((item) => item.key).join("|");

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    if (open) {
      setSelectedMetric("view_count");
      setSelectedWindow("7d");
      setSelectedChartMode("absolute");
      setSelectedCompareItemKeys(new Set(items.map((item) => item.key)));
    }
  }, [open, compareItemsKey, items]);

  useEffect(() => {
    if (!open || !items.length) {
      setTrendItems([]);
      return;
    }
    let cancelled = false;
    async function loadCompareTrends() {
      setIsLoading(true);
      setErrorMessage("");
      const loaded = [];
      try {
        const chartUtils = await import("@/app/rankTrendChartUtils");
        for (const item of items) {
          const { response, data } = await fetchRankTrendData({
            platform: item.platform,
            id: item.id,
            frontendVersion,
          });
          handleVersionResponseRef.current?.({
            ...data,
            backendVersion: getBackendVersionFromResponse(response, data),
            frontendVersion,
          });
          if (!response.ok || !data?.success) {
            continue;
          }
          loaded.push({ ...item, trendData: data });
        }
        if (!cancelled) {
          setTrendChartUtils(chartUtils);
          setTrendItems(loaded);
          setErrorMessage(loaded.length ? "" : "对比趋势数据暂不可用。");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load compare trends", error);
          setTrendItems([]);
          setErrorMessage("对比趋势数据暂不可用。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    loadCompareTrends();
    return () => {
      cancelled = true;
    };
  }, [open, compareItemsKey, frontendVersion]);

  const isPeakSeriesCompare = trendItems.some((item) => item.compareKind === "peak_series") ||
    (!trendItems.length && items.some((item) => item.compareKind === "peak_series"));
  const availableMetricOptions = COMPARE_METRICS.filter((option) => {
    if (!trendItems.length) {
      return isPeakSeriesCompare ? option.key === "view_count" : true;
    }
    if (isPeakSeriesCompare) {
      return option.key === "view_count" && trendItems.every((item) => isCompareMetricAvailableForItem(item, selectedWindow, option.key));
    }
    return trendItems.every((item) => isCompareMetricAvailableForItem(item, selectedWindow, option.key));
  });
  const selectedMetricOption =
    availableMetricOptions.find((option) => option.key === selectedMetric) ||
    availableMetricOptions[0] ||
    null;
  const hasSelectedMetricOption = Boolean(selectedMetricOption);
  const coloredCompareItems = items.map((item, index) => ({
    ...item,
    compareColor: comparePalette[index % comparePalette.length],
  }));
  const colorByCompareKey = new Map(coloredCompareItems.map((item) => [item.key, item.compareColor]));
  const coloredTrendItems = trendItems.map((item) => ({
    ...item,
    compareColor: colorByCompareKey.get(item.key) || item.compareColor,
  }));
  const visibleTrendItems = coloredTrendItems.filter((item) => selectedCompareItemKeys.has(item.key));

  useEffect(() => {
    if (selectedMetricOption?.key && selectedMetricOption.key !== selectedMetric) {
      setSelectedMetric(selectedMetricOption.key);
    }
  }, [selectedMetric, selectedMetricOption?.key]);

  function toggleCompareItemLine(itemKey) {
    setSelectedCompareItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        scrollable
        className="w-[calc(100vw-1.5rem)] max-w-[58rem] gap-3 overflow-x-hidden p-3 pt-4 sm:p-4"
      >
        <AlertDialogCancel
          aria-label="关闭剧集对比"
          className="absolute right-3 top-3"
          size="icon-xs"
          title="关闭"
          variant="secondary"
        >
          <XIcon />
        </AlertDialogCancel>
        <AlertDialogHeader className="gap-1 place-items-start pr-8 text-left">
          <AlertDialogTitle className="text-base">剧集对比</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            查看已选剧集的历史趋势对比。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid min-w-0 gap-3 w-full">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
            <Tabs value={selectedMetric} onValueChange={setSelectedMetric} className="min-w-0 w-full sm:flex-1">
              <TabsList
                className="grid h-auto w-full min-w-0 items-center justify-stretch text-xs!"
                style={{ gridTemplateColumns: `repeat(${Math.max(availableMetricOptions.length, 1)}, minmax(0, 1fr))` }}
              >
              {availableMetricOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <TabsTrigger
                    key={option.key}
                    className="h-[26px] min-w-0 px-1.5 text-xs! sm:px-2.5"
                    title={option.label}
                    value={option.key}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            </Tabs>
            <Tabs value={selectedWindow} onValueChange={setSelectedWindow} className="w-fit shrink-0">
              <TabsList className="inline-flex h-[34px] w-fit items-center justify-center text-xs!">
                {COMPARE_WINDOWS.map((key) => (
                  <TabsTrigger key={key} data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value={key}>
                    {key.replace("d", "日")}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={selectedChartMode} onValueChange={setSelectedChartMode} className="w-fit shrink-0">
              <TabsList className="inline-flex h-[34px] w-fit items-center justify-center text-xs!">
                {COMPARE_CHART_MODES.map((mode) => (
                  <TabsTrigger key={mode.key} data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value={mode.key}>
                    {mode.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
            {coloredCompareItems.map((item) => {
              const lineColor = item.compareColor;
              const trendItem = trendItems.find((entry) => entry.key === item.key);
              const itemIdText = item.compareKind === "peak_series"
                ? (
                    Array.isArray(item.dramaIds) && item.dramaIds.length
                      ? item.dramaIds.join("，")
                      : Array.isArray(trendItem?.trendData?.dramaIds) && trendItem.trendData.dramaIds.length
                        ? trendItem.trendData.dramaIds.join("，")
                        : item.id
                  )
                : item.id;
              return (
                <div
                  key={item.key}
                className="relative flex w-[120px] shrink-0 flex-col items-center gap-2 rounded-lg border border-border/80 bg-card p-2 text-center sm:w-48 sm:flex-row sm:pr-7 sm:text-left"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/50">
                  {item.cover ? (
                    <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[0.65rem] text-muted-foreground">暂无封面</div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center sm:items-start">
                  <div className="line-clamp-2 text-xs font-semibold leading-4 text-foreground">{item.title}</div>
                  <div className="mt-1 flex min-w-0 items-start justify-start gap-1 text-left text-[0.68rem] leading-4 text-muted-foreground">
                    <PlatformIdIcon platform={item.platform} className="size-3.5 shrink-0" />
                    <span className="line-clamp-2 min-w-0 break-all text-left">{itemIdText}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-start justify-start gap-1 text-left text-[0.68rem] leading-4 text-muted-foreground">
                    <MicIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="line-clamp-2 min-w-0 break-words text-left">{item.mainCvText || "CV 暂无"}</span>
                  </div>
                </div>
                <label className="absolute right-2 top-2 inline-flex items-center gap-1" title="显示/隐藏曲线">
                  <input
                    type="checkbox"
                    aria-label={`显示${item.title}曲线`}
                    checked={selectedCompareItemKeys.has(item.key)}
                    className="size-3.5 rounded border-border"
                    style={{ accentColor: lineColor }}
                    onChange={() => toggleCompareItemLine(item.key)}
                  />
                </label>
              </div>
              );
            })}
          </div>
          {isLoading || (!errorMessage && hasSelectedMetricOption && !trendChartUtils) ? (
            <Alert>
              <RefreshCwIcon className="size-4 animate-spin" />
              <AlertTitle>正在读取对比趋势</AlertTitle>
              <AlertDescription>正在读取已选剧集的历史数据</AlertDescription>
            </Alert>
          ) : errorMessage || !hasSelectedMetricOption ? (
            <Alert className="border-destructive/30 bg-destructive/10">
              <AlertTitle>对比暂不可用</AlertTitle>
              <AlertDescription>{errorMessage || "对比趋势数据暂不可用。"}</AlertDescription>
            </Alert>
          ) : (
            <CompareTrendChart
              items={visibleTrendItems}
              windowKey={selectedWindow}
              metricOption={selectedMetricOption}
              chartMode={selectedChartMode}
              chartUtils={trendChartUtils}
            />
          )}
          {hasSelectedMetricOption ? (
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border/80 bg-card">
            <table className="w-full table-fixed text-[0.68rem] sm:text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="w-[36%] px-2 py-2 text-left font-medium sm:px-3">剧集</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{selectedMetricOption.label}</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{selectedWindow.replace("d", "日")}变化</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{selectedWindow.replace("d", "日")}增幅</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {coloredCompareItems.map((item) => {
                  const trendItem = coloredTrendItems.find((entry) => entry.key === item.key);
                  const metric = getMetricFromTrend(trendItem?.trendData, selectedWindow, selectedMetricOption.key);
                  return (
                    <tr key={`compare-row-${item.key}`}>
                      <td className="px-2 py-2 sm:px-3">
                        <span className="flex w-full min-w-0 items-center gap-1.5">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.compareColor }} />
                          <span className="min-w-0 truncate font-medium text-foreground">{item.title}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatOptionalPlainNumber(getMetricLatestValue(trendItem?.trendData, selectedWindow, selectedMetricOption.key))}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatSignedPlainNumber(metric?.delta)}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatComparePercent(metric?.deltaPercent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : null}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DramaCompareBasket({ items, open, onOpenChange, onOpenCompare, onRemoveItem, onClear }) {
  if (!items.length) {
    return null;
  }
  const latestItem = items.at(-1);
  const compareBasketTitleSummary = items.map((item) => item.title).filter(Boolean).join("，");
  const previewItems = items.slice(-4);

  if (!open) {
    return (
      <div className="fixed mobile-compare-basket right-3 z-30 sm:bottom-3 sm:left-3 sm:right-auto">
        <button
          type="button"
          className="hidden max-w-72 items-center gap-2 rounded-lg border border-border/80 bg-surface-floating p-2 text-left shadow-[var(--shadow-panel)] backdrop-blur-xl sm:flex"
          aria-label="展开对比"
          onClick={() => onOpenChange(true)}
        >
          <div className="flex shrink-0 items-center pl-2">
            {previewItems.map((item, index) => (
              <div
                key={`compare-preview-${item.key}`}
                className={`size-9 overflow-hidden rounded-md border border-background bg-muted shadow-sm ${index === 0 ? "" : "-ml-2"}`}
              >
                {item.cover ? (
                  <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
                ) : (
                  <ArrowLeftRightIcon aria-hidden="true" className="m-2 size-5 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">对比 {items.length}/{MAX_COMPARE_ITEMS}</div>
            <div className="truncate text-xs text-muted-foreground">{compareBasketTitleSummary || latestItem.title}</div>
          </div>
        </button>
        <Button
          type="button"
          variant="compare"
          size="icon-lg"
          className="relative shadow-[var(--shadow-panel)] sm:hidden"
          aria-label="展开对比"
          onClick={() => onOpenChange(true)}
        >
          <ArrowLeftRightIcon aria-hidden="true" className="size-4" />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.58rem] font-semibold leading-none text-primary-foreground tabular-nums">
            {items.length}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed mobile-compare-basket right-3 z-30 w-[min(60vw,18rem)] sm:bottom-3 sm:left-3 sm:right-auto sm:w-80">
      <div className="grid gap-2 rounded-lg border border-border/80 bg-surface-floating p-2 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-semibold text-foreground">对比 {items.length}/{MAX_COMPARE_ITEMS}</div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="icon-xs" variant="ghost" aria-label="清空对比" title="清空" onClick={onClear}>
              <Trash2Icon />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="compare"
              data-touch="compact"
              onClick={onOpenCompare}
              className="relative overflow-visible text-sm! after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
            >
              <ArrowLeftRightIcon data-icon="inline-start" />
              对比
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="收起对比" title="收起" onClick={() => onOpenChange(false)}>
              <ChevronDownIcon />
            </Button>
          </div>
        </div>
        <div className="grid max-h-[13.5rem] overflow-y-auto gap-1.5 pr-0.5">
          {items.map((item) => (
            <div key={`basket-row-${item.key}`} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/45 p-1.5">
              <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
              {item.cover ? (
                <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
              ) : null}
              </div>
              <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{item.title}</div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`移出${item.title}`}
                title={`移出${item.title}`}
                onClick={() => onRemoveItem(item.key)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ToolView({ initialAppConfig }) {
  const initialToolViewOptions = {
    desktopApp: initialAppConfig?.desktopApp === true,
    missevanEnabled: initialAppConfig?.missevanEnabled !== false,
  };
  const [toolRouteState, setToolRouteState] = useState(() =>
    typeof window === "undefined"
      ? normalizeToolRouteState({}, initialToolViewOptions)
      : readToolRouteStateFromLocation(window.location, initialToolViewOptions)
  );
  const currentPlatform = toolRouteState.view;
  const [activeSearchPlatform, setActiveSearchPlatform] = useState(() =>
    initialAppConfig?.missevanEnabled === false ? "manbo" : "missevan"
  );
  const [sharedSearchForm, setSharedSearchForm] = useState({
    keyword: "",
    manualInput: "",
  });
  const [sharedOutputPlatform, setSharedOutputPlatform] = useState(() =>
    initialAppConfig?.missevanEnabled === false ? "manbo" : "missevan"
  );
  const [appConfig, setAppConfig] = useState({
    ...getDefaultAppConfig(),
    ...(initialAppConfig || {}),
  });
  const [platformStates, setPlatformStates] = useState(() => {
    const persistedHistory = loadPersistedHistoryEntries();
    return {
      missevan: {
        ...createPlatformState(),
        historyEntries: persistedHistory.missevan,
      },
      manbo: {
        ...createPlatformState(),
        historyEntries: persistedHistory.manbo,
      },
    };
  });
  const [notice, setNotice] = useState(null);
  const [searchJumpStatus, setSearchJumpStatus] = useState(null);
  const [searchMetricLegendOpen, setSearchMetricLegendOpen] = useState(false);
  const [globalSearchPending, setGlobalSearchPending] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState([]);
  const [favoriteRefreshState, setFavoriteRefreshState] = useState({
    isRunning: false,
    progress: 0,
    currentTitle: "",
  });
  const [backgroundTask, setBackgroundTask] = useState(() => createIdleBackgroundTask());
  const [compareItems, setCompareItems] = useState([]);
  const [compareBasketOpen, setCompareBasketOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [favoriteRefreshRevision, setFavoriteRefreshRevision] = useState(0);
  const [cancelFavoriteRequest, setCancelFavoriteRequest] = useState(null);
  const [mainDrawerOpen, setMainDrawerOpen] = useState(false);
  const [isDesktopBrowser, setIsDesktopBrowser] = useState(false);
  const [mainNavigationRanksData, setMainNavigationRanksData] = useState(null);
  const [mainNavigationRanksStatus, setMainNavigationRanksStatus] = useState("idle");
  const { changelogOpen, openChangelog, setChangelogOpen } = useChangelogDialog(appConfig.frontendVersion);

  const currentPlatformRef = useRef(currentPlatform);
  const toolRouteStateRef = useRef(toolRouteState);
  const pendingDetailRouteReplaceRef = useRef(false);
  const activeSearchPlatformRef = useRef(activeSearchPlatform);
  const sharedOutputPlatformRef = useRef(sharedOutputPlatform);
  const appConfigRef = useRef(appConfig);
  const platformStatesRef = useRef(platformStates);
  const favoriteRefreshStateRef = useRef(favoriteRefreshState);
  const backgroundTaskRef = useRef(backgroundTask);
  const runtimeMetaRef = useRef({
    missevan: createRuntimeMeta(),
    manbo: createRuntimeMeta(),
  });
  const resultsPanelRef = useRef(null);
  const outputPanelRef = useRef(null);

  function addDramaToCompareBasket(rawItem) {
    const compareKind = String(rawItem?.compareKind ?? "drama").trim() || "drama";
    const rawTitle = String(rawItem?.title ?? rawItem?.name ?? "").trim() || "未命名剧集";
    const normalized = {
      compareKind: String(rawItem?.compareKind ?? "drama").trim() || "drama",
      platform: String(rawItem?.platform ?? "").trim(),
      id: String(rawItem?.id ?? rawItem?.dramaId ?? rawItem?.trendLookupId ?? "").trim(),
      title: compareKind === "peak_series" && !rawTitle.startsWith("系列：") ? `系列：${rawTitle}` : rawTitle,
      cover: String(rawItem?.cover ?? rawItem?.coverUrl ?? "").trim(),
      mainCvText: String(rawItem?.mainCvText ?? rawItem?.main_cv_text ?? "").replace(/^主要CV：/, "").trim(),
      dramaIds: (Array.isArray(rawItem?.dramaIds) ? rawItem.dramaIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    };
    if (!normalized.platform || !normalized.id) {
      toast.warning("这部剧集暂时不能加入对比。");
      return;
    }
    const key = getCompareItemKey(normalized);
    setCompareItems((current) => {
      if (normalized.compareKind === "peak_series" && current.some((item) => item.compareKind !== normalized.compareKind)) {
        toast.warning("巅峰榜系列只能和其他巅峰榜系列对比。");
        return current;
      }
      if (normalized.compareKind !== "peak_series" && current.some((item) => item.compareKind === "peak_series")) {
        toast.warning("普通剧集不能和巅峰榜系列混合对比。");
        return current;
      }
      if (current.some((item) => item.key === key)) {
        toast.info("已在对比中。");
        return current;
      }
      if (current.length >= MAX_COMPARE_ITEMS) {
        toast.warning(`对比最多添加 ${MAX_COMPARE_ITEMS} 部剧集。`);
        return current;
      }
      toast.success("已加入对比。");
      return [...current, { ...normalized, key }];
    });
  }

  function removeDramaFromCompareBasket(key) {
    setCompareItems((current) => current.filter((item) => item.key !== key));
  }

  function clearCompareBasket() {
    setCompareItems([]);
    setCompareBasketOpen(false);
    setCompareDialogOpen(false);
  }

  function logCompareUsage(items = []) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    fetch(buildVersionedUrl("/usage-log", appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "compare",
        platforms: items.map((item) => item.platform),
        dramaIds: items.map((item) => item.id),
        dramaTitles: items.map((item) => item.title),
        compareKinds: items.map((item) => item.compareKind),
      }),
    }).catch((error) => {
      console.error("Failed to log compare usage", error);
    });
  }

  function openCompareDialogFromBasket() {
    logCompareUsage(compareItems);
    setCompareDialogOpen(true);
  }

  useEffect(() => {
    currentPlatformRef.current = currentPlatform;
  }, [currentPlatform]);

  useEffect(() => {
    toolRouteStateRef.current = toolRouteState;
  }, [toolRouteState]);

  useEffect(() => {
    function handleToolViewPopState() {
      applyCurrentPlatformFromUrl();
    }

    window.addEventListener("popstate", handleToolViewPopState);
    return () => {
      window.removeEventListener("popstate", handleToolViewPopState);
    };
  }, []);

  useEffect(() => {
    activeSearchPlatformRef.current = activeSearchPlatform;
  }, [activeSearchPlatform]);

  useEffect(() => {
    sharedOutputPlatformRef.current = sharedOutputPlatform;
  }, [sharedOutputPlatform]);

  useEffect(() => {
    appConfigRef.current = appConfig;
    if (typeof document !== "undefined") {
      document.title = appConfig.titleZh || appConfig.brandName;
    }
    const normalizedRoute = normalizeToolRouteState(toolRouteStateRef.current, appConfig);
    const currentRoute = toolRouteStateRef.current;
    if (
      normalizedRoute.view !== currentRoute.view ||
      normalizedRoute.platform !== currentRoute.platform ||
      normalizedRoute.window !== currentRoute.window ||
      normalizedRoute.category !== currentRoute.category ||
      normalizedRoute.rank !== currentRoute.rank
    ) {
      navigateToolRoute(normalizedRoute, { replace: true });
    }
  }, [appConfig]);

  useEffect(() => {
    platformStatesRef.current = platformStates;
  }, [platformStates]);

  useEffect(() => {
    favoriteRefreshStateRef.current = favoriteRefreshState;
  }, [favoriteRefreshState]);

  useEffect(() => {
    backgroundTaskRef.current = backgroundTask;
  }, [backgroundTask]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateDesktopState = () => {
      setIsDesktopBrowser(mediaQuery.matches);
    };
    updateDesktopState();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateDesktopState);
      return () => mediaQuery.removeEventListener("change", updateDesktopState);
    }
    mediaQuery.addListener?.(updateDesktopState);
    return () => mediaQuery.removeListener?.(updateDesktopState);
  }, []);

  useEffect(() => {
    savePersistedHistoryEntries({
      missevan: platformStates.missevan?.historyEntries || [],
      manbo: platformStates.manbo?.historyEntries || [],
    });
  }, [platformStates.missevan?.historyEntries, platformStates.manbo?.historyEntries]);

  const searchPlatforms = [
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
  ];
  const webPlatforms = [
    { key: "home", label: "首页" },
    { key: "search", label: "统计" },
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
    { key: "favorites", label: "收藏" },
  ];
  const desktopPlatforms = [
    { key: "search", label: "统计" },
    { key: "favorites", label: "收藏" },
  ];
  const visibleSearchPlatforms = searchPlatforms.filter((platform) => {
    return platform.key !== "missevan" || appConfig.missevanEnabled;
  });
  const visiblePlatforms = appConfig.desktopApp ? desktopPlatforms : webPlatforms;
  const drawerRootItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-sm! font-medium text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-base! font-medium text-foreground visited:text-foreground hover:text-foreground";
  const drawerChildItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-[0.82rem]! font-medium text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-sm! font-medium text-foreground visited:text-foreground hover:text-foreground";
  const drawerUtilityItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-[0.82rem]! font-normal! text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-sm! font-normal! text-foreground visited:text-foreground hover:text-foreground";
  const mobileMenuActiveItemClassName = "bg-accent text-accent-foreground before:absolute before:inset-y-1.5 before:left-1 before:w-1 before:rounded-full before:bg-primary";
  const defaultExpandedRootKeys = useMemo(
    () => getInitialDrawerExpandedRootKeys(toolRouteState, isDesktopBrowser && !appConfig.desktopApp),
    [appConfig.desktopApp, isDesktopBrowser, toolRouteState.platform, toolRouteState.view]
  );
  const ongoingNavigationMenu = useMemo(() => buildOngoingNavigationMenu(), []);
  const ranksNavigationMenu = useMemo(
    () => buildRanksNavigationMenu(mainNavigationRanksData),
    [mainNavigationRanksData]
  );
  const activeBrowsePlatform = activeSearchPlatform === "manbo" || appConfig.missevanEnabled ? activeSearchPlatform : "manbo";

  const currentBrowseState = currentPlatform === "search" ? platformStates[activeBrowsePlatform] : null;
  const sharedOutputState = platformStates[sharedOutputPlatform];
  const sharedStatsState = sharedOutputState?.stats || null;
  const sharedRevenueSummary = sharedStatsState?.revenueSummary || buildRevenueSummary(sharedStatsState?.revenueResults || [], sharedOutputPlatform);
  const sharedHistoryEntries = getMergedHistoryEntries();
  useEffect(() => {
    closeMainDrawer();
  }, [currentPlatform]);

  useEffect(() => {
    if (!mainDrawerOpen) {
      return undefined;
    }

    function handleMainDrawerKeyDown(event) {
      if (event.key === "Escape") {
        setMainDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", handleMainDrawerKeyDown);
    return () => {
      window.removeEventListener("keydown", handleMainDrawerKeyDown);
    };
  }, [mainDrawerOpen]);

  function getActiveWorkPlatform() {
    return activeSearchPlatformRef.current === "manbo" || appConfigRef.current.missevanEnabled
      ? activeSearchPlatformRef.current
      : "manbo";
  }

  function closeMainDrawer() {
    setMainDrawerOpen(false);
  }

  function applyCurrentPlatformFromUrl() {
    if (typeof window === "undefined") {
      return;
    }
    const nextState = readToolRouteStateFromLocation(window.location, appConfigRef.current);
    pendingDetailRouteReplaceRef.current = false;
    toolRouteStateRef.current = nextState;
    currentPlatformRef.current = nextState.view;
    setToolRouteState(nextState);
  }

  function navigateToolRoute(patch, options = {}) {
    const nextState = normalizeToolRouteState(
      {
        ...toolRouteStateRef.current,
        ...(patch || {}),
      },
      appConfigRef.current
    );
    const currentState = toolRouteStateRef.current;
    const isDetailRoute = currentState.view === "ongoing" || currentState.view === "ranks";
    const isDetailUpdate =
      currentState.view === nextState.view &&
      (currentState.platform !== nextState.platform ||
        currentState.window !== nextState.window ||
        currentState.category !== nextState.category ||
        currentState.rank !== nextState.rank);
    const replace =
      options?.replace === true || (pendingDetailRouteReplaceRef.current && isDetailRoute && isDetailUpdate);
    if (
      currentState.view === nextState.view &&
      currentState.platform === nextState.platform &&
      currentState.window === nextState.window &&
      currentState.category === nextState.category &&
      currentState.rank === nextState.rank
    ) {
      return;
    }
    if (typeof window !== "undefined") {
      const nextUrl = buildToolRouteUrl(window.location, nextState, appConfigRef.current);
      window.history[
        replace ? "replaceState" : "pushState"
      ]({ toolRoute: nextState }, "", nextUrl);
    }
    pendingDetailRouteReplaceRef.current = options?.seedDetailReplace === true;
    toolRouteStateRef.current = nextState;
    currentPlatformRef.current = nextState.view;
    setToolRouteState(nextState);
  }

  function navigateCurrentPlatform(nextPlatform) {
    navigateToolRoute(
      { view: nextPlatform },
      { seedDetailReplace: nextPlatform === "ongoing" || nextPlatform === "ranks" }
    );
  }

  function navigateToolRouteFromMenu(routePatch) {
    navigateToolRoute(routePatch);
    scrollToPageTop();
    setMainDrawerOpen(false);
  }

  function navigateHomeRoute(routePatch) {
    navigateToolRoute(routePatch);
    scrollToPageTop();
  }

  function openHomeFromHeader() {
    navigateCurrentPlatform(appConfigRef.current.desktopApp ? "search" : "home");
    scrollToPageTop();
    setMainDrawerOpen(false);
  }

  const mainMenuButtonLabel = mainDrawerOpen ? "关闭菜单" : "打开菜单";
  const headerHomeLabel = appConfig.desktopApp ? "返回统计页" : "返回首页";

  function commitGlobalSearchNavigation() {
    navigateToolRoute({ view: "search" });
    setMainDrawerOpen(false);
  }

  async function loadMainNavigationRanks() {
    if (appConfigRef.current.desktopApp || mainNavigationRanksStatus === "loading") {
      return;
    }
    const cachedPayload = getCachedRanksData(appConfigRef.current.frontendVersion);
    const hasCachedPayload = Boolean(cachedPayload?.data?.success);
    if (hasCachedPayload) {
      setMainNavigationRanksData(cachedPayload.data);
      setMainNavigationRanksStatus("ready");
    } else {
      setMainNavigationRanksStatus("loading");
    }
    try {
      const { response, data } = await fetchRanksData(appConfigRef.current.frontendVersion, { revalidate: true });
      const backendVersion = getBackendVersionFromResponse(response, data);
      updateVersionStatusFromResponse({
        ...data,
        backendVersion,
        frontendVersion: appConfigRef.current.frontendVersion,
      });
      if (!response.ok || !data?.success) {
        if (!hasCachedPayload) {
          setMainNavigationRanksData(null);
          setMainNavigationRanksStatus("error");
        }
        return;
      }
      setMainNavigationRanksData(data);
      setMainNavigationRanksStatus("ready");
    } catch (error) {
      console.error("Failed to load main navigation ranks", error);
      if (!hasCachedPayload) {
        setMainNavigationRanksData(null);
        setMainNavigationRanksStatus("error");
      }
    }
  }

  function openDrawerChangelog() {
    openChangelog();
    setMainDrawerOpen(false);
  }

  function openDrawerFeedback() {
    if (appConfig.desktopApp || !appConfig.featureSuggestionUrl) {
      return;
    }
    navigateToolRoute({ view: "feedback" });
    setMainDrawerOpen(false);
  }

  function resolveStatsPlatform(platform) {
    return platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : getActiveWorkPlatform();
  }

  function openSearchPlatform(platform) {
    const normalizedPlatform = platform === "manbo" ? "manbo" : "missevan";
    setActiveSearchPlatform(normalizedPlatform);
    navigateCurrentPlatform("search");
  }

  function renderMissevanDesktopLink(config = appConfig) {
    const desktopAppUrl = String(config?.desktopAppUrl || "").trim();
    if (!desktopAppUrl) {
      return "桌面版";
    }
    return (
      <a className="font-medium text-primary underline underline-offset-4" href={desktopAppUrl} rel="noreferrer" target="_blank">
        桌面版
      </a>
    );
  }

  function renderMissevanAccessDeniedMessage(config = appConfig) {
    const plainMessage = getMissevanAccessDeniedMessage(config, appConfig.cooldownHours);
    return (
      <span aria-label={plainMessage}>
        当前所有备份节点都在冷却中，请{getRemainingCooldownMinutes(config, appConfig.cooldownHours)}分钟之后再来，或使用
        {renderMissevanDesktopLink(config)}。
      </span>
    );
  }

  function scrollToPanel(ref) {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        ref.current?.scrollIntoView?.({ behavior: getScrollBehavior(), block: "start" });
      });
    });
  }

  function scrollToPageTop() {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: getScrollBehavior() });
    });
  }

  function scrollToDramaResult(dramaId) {
    if (typeof window === "undefined" || dramaId == null) {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector(`[data-search-result-id="${CSS.escape(String(dramaId))}"]`)
          ?.scrollIntoView?.({ behavior: getScrollBehavior(), block: "start" });
      });
    });
  }

  function applyVersionStatus(frontendVersion, backendVersion, versionMismatch = null) {
    setAppConfig((current) => ({
      ...current,
      frontendVersion: normalizeVersion(frontendVersion),
      backendVersion: normalizeVersion(backendVersion),
      versionMismatch:
        versionMismatch == null
          ? normalizeVersion(frontendVersion) !== normalizeVersion(backendVersion)
          : Boolean(versionMismatch),
    }));
  }

  function updateVersionStatusFromResponse(data) {
    if (!data || typeof data !== "object") {
      return data;
    }
    applyVersionStatus(
      normalizeVersion(data.frontendVersion ?? appConfigRef.current.frontendVersion),
      normalizeVersion(data.backendVersion ?? "0.0.0"),
      data.versionMismatch
    );
    return data;
  }

  async function loadAppConfig() {
    try {
      const response = await fetch(buildVersionedUrl("/app-config", appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      if (!response.ok) {
        setAppConfig((current) => mergeAppConfig(current));
        return;
      }
      const config = await response.json();
      const merged = mergeAppConfig(appConfigRef.current, {
        ...config,
        backendVersion: getBackendVersionFromResponse(response, config),
      });
      setAppConfig(merged);
      if (!merged.missevanEnabled && activeSearchPlatformRef.current === "missevan") {
        setActiveSearchPlatform("manbo");
      }
      if (!merged.missevanEnabled && sharedOutputPlatformRef.current === "missevan") {
        setSharedOutputPlatform("manbo");
      }
    } catch (_) {
      setAppConfig((current) => mergeAppConfig(current));
    }
  }

  async function reloadFavoriteItems() {
    try {
      setFavoriteItems(await listFavorites());
    } catch (error) {
      console.error("Failed to load favorites", error);
      toast.error("读取收藏失败。");
    }
  }

  const favoriteKeySet = useMemo(
    () => new Set((Array.isArray(favoriteItems) ? favoriteItems : []).map((item) => item.key)),
    [favoriteItems]
  );
  const statisticsActionsDisabled = Boolean(backgroundTask.isRunning);
  const favoriteActionsDisabled = favoriteRefreshState.isRunning;

  async function handleFavoriteRefreshSettled() {
    setFavoriteRefreshRevision((current) => current + 1);
    await reloadFavoriteItems();
  }

  function buildFavoriteLogPayload(item, action) {
    const platform = item?.platform === "manbo" ? "manbo" : item?.platform === "missevan" ? "missevan" : "";
    const dramaId = String(item?.dramaId ?? item?.id ?? "").trim();
    return {
      platform,
      action,
      dramaId,
      dramaName: item?.title || item?.name || "",
      source: item?.source || item?.favoriteSource || (currentPlatformRef.current === "search" ? "search" : currentPlatformRef.current) || "unknown",
    };
  }

  async function logFavoriteUsage(item, action) {
    const payload = buildFavoriteLogPayload(item, action);
    if (!payload.platform || !payload.dramaId) {
      return;
    }
    try {
      await fetch(buildVersionedUrl("/usage-log", appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Failed to log favorite action", error);
    }
  }

  async function confirmRemoveFavorite() {
    const request = cancelFavoriteRequest;
    if (!request) {
      return;
    }
    if (favoriteRefreshStateRef.current.isRunning) {
      toast.warning("收藏刷新中，请稍后再操作。");
      setCancelFavoriteRequest(null);
      return;
    }
    const platform = request.platform === "manbo" ? "manbo" : request.platform === "missevan" ? "missevan" : "";
    const dramaId = String(request.dramaId ?? request.id ?? "").trim();
    try {
      await removeFavoriteWithSnapshots(platform, dramaId);
      await logFavoriteUsage(request, "favorite_remove");
      await reloadFavoriteItems();
      toast.success("已取消收藏，并删除历史统计记录。");
    } catch (error) {
      console.error("Failed to remove favorite", error);
      toast.error("取消收藏失败。");
    } finally {
      setCancelFavoriteRequest(null);
    }
  }

  async function toggleFavorite(item) {
    if (favoriteRefreshStateRef.current.isRunning) {
      toast.warning("收藏刷新中，请稍后再操作。");
      return;
    }
    const platform = item?.platform === "manbo" ? "manbo" : item?.platform === "missevan" ? "missevan" : "";
    const dramaId = String(item?.dramaId ?? item?.id ?? "").trim();
    const key = createFavoriteKey(platform, dramaId);
    if (!key) {
      toast.error("收藏失败，作品信息不完整。");
      return;
    }
    try {
      if (favoriteKeySet.has(key)) {
        setCancelFavoriteRequest({
          ...item,
          platform,
          dramaId,
          title: item?.title || item?.name || "",
        });
      } else {
        const favorite = await saveFavorite({
          platform,
          dramaId,
          title: item?.title || item?.name || "",
          cover: item?.cover || "",
          paymentLabel: item?.paymentLabel || item?.payment_label || "",
          contentTypeLabel: item?.contentTypeLabel || item?.content_type_label || "",
          dramaUpdatedAt: item?.dramaUpdatedAt || item?.drama_updated_at || item?.updated_at || "",
          mainCvText: item?.mainCvText || item?.main_cv_text || "",
        });
        await logFavoriteUsage({ ...item, ...favorite }, "favorite_add");
        toast.success("已加入收藏。");
        await reloadFavoriteItems();
      }
    } catch (error) {
      console.error("Failed to toggle favorite", error);
      toast.error("收藏操作失败。");
    }
  }

  function notifyTaskCancel(taskId) {
    if (!taskId) return;
    const url = `/stat-tasks/${taskId}/cancel`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url);
        return;
      }
    } catch (_) {
    }
    fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }

  function notifyAllActiveStatsTaskCancels() {
    Object.values(platformStatesRef.current).forEach((state) => {
      if (state?.stats?.activeTaskId) {
        notifyTaskCancel(state.stats.activeTaskId);
      }
    });
  }

  useEffect(() => {
    loadAppConfig();
    reloadFavoriteItems();
    const pageExitHandler = () => {
      notifyAllActiveStatsTaskCancels();
    };
    window.addEventListener("pagehide", pageExitHandler);
    window.addEventListener("beforeunload", pageExitHandler);
    return () => {
      Object.values(runtimeMetaRef.current).forEach((meta) => {
        meta.activeAbortController?.abort?.();
        if (meta.activeElapsedTimer) {
          clearInterval(meta.activeElapsedTimer);
          meta.activeElapsedTimer = null;
        }
      });
      window.removeEventListener("pagehide", pageExitHandler);
      window.removeEventListener("beforeunload", pageExitHandler);
    };
  }, []);

  function updatePlatformState(platform, updater) {
    setPlatformStates((current) => {
      const nextSlice = updater(current[platform]);
      return { ...current, [platform]: nextSlice };
    });
  }

  function updateSharedSearchForm(patch) {
    setSharedSearchForm((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateSearchFormForPlatform(platform, patch) {
    updatePlatformState(platform, (state) => ({
      ...state,
      searchForm: {
        ...state.searchForm,
        ...patch,
      },
    }));
  }

  function resetOutputs(platform) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: createStatsState(),
    }));
  }

  function resetSearchFlow(platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: "search",
      searchKeyword: "",
      searchNextOffset: 0,
      searchHasMore: false,
      searchCurrentPage: 1,
      searchPageSize: 5,
      searchTotalMatched: 0,
      searchPageCache: {},
      isLoadingMoreResults: false,
      searchResults: [],
      dramas: [],
      selectedEpisodesSnapshot: [],
    }));
  }

  function setSearchResults(platform, results, source = "search", meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    const pageSize = Number(meta?.limit ?? normalizedResults.length ?? 5) || 5;
    const offset = Number(meta?.offset ?? 0) || 0;
    const page = source === "search" ? Math.floor(offset / Math.max(1, pageSize)) + 1 : 1;
    const totalMatched = source === "search" ? Number(meta?.matchedCount ?? meta?.totalMatched ?? normalizedResults.length) || 0 : 0;
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: source === "manual" ? "manual" : "search",
      searchKeyword: source === "search" ? String(meta?.keyword ?? state.searchForm.keyword ?? "").trim() : "",
      searchNextOffset: source === "search" ? Number(meta?.nextOffset ?? normalizedResults.length) || 0 : 0,
      searchHasMore: source === "search" ? Boolean(meta?.hasMore) : false,
      searchCurrentPage: page,
      searchPageSize: Math.max(1, pageSize),
      searchTotalMatched: totalMatched,
      searchPageCache: source === "search" ? { [page]: normalizedResults } : {},
      isLoadingMoreResults: false,
      searchResults: normalizedResults,
    }));
    if (normalizedResults.length > 0) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setManualSearchResults(platform, results, meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: "manual",
      searchKeyword: "",
      searchNextOffset: 0,
      searchHasMore: false,
      searchCurrentPage: 1,
      searchPageSize: Math.max(1, Number(meta?.limit ?? normalizedResults.length ?? 1) || 1),
      searchTotalMatched: 0,
      searchPageCache: {},
      isLoadingMoreResults: false,
      searchResults: normalizedResults,
      dramas: [],
      selectedEpisodesSnapshot: [],
    }));
    if (normalizedResults.length > 0 && meta?.scroll !== false) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setResults(nextResults, platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResults: nextResults,
      searchPageCache:
        state.searchResultSource === "search"
          ? {
              ...state.searchPageCache,
              [state.searchCurrentPage || 1]: nextResults,
            }
          : state.searchPageCache,
    }));
  }

  function setDramas(nextDramas, platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      dramas: nextDramas,
    }));
  }

  function updateSelection(selectedEpisodes, platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      selectedEpisodesSnapshot: selectedEpisodes,
    }));
  }

  function appendHistoryEntry(platform, entry, taskId = "") {
    if (!entry) {
      return "";
    }

    const meta = runtimeMetaRef.current[platform];
    const normalizedTaskId = String(taskId || "").trim();
    if (normalizedTaskId) {
      meta.completedHistoryTaskIds ||= new Set();
      if (meta.completedHistoryTaskIds.has(normalizedTaskId)) {
        return "";
      }
      meta.completedHistoryTaskIds.add(normalizedTaskId);
    }

    updatePlatformState(platform, (state) => {
      const nextEntries = [entry, ...(Array.isArray(state.historyEntries) ? state.historyEntries : [])];
      return {
        ...state,
        historyEntries: nextEntries.slice(0, STATS_HISTORY_LIMIT),
      };
    });

    return entry.id;
  }

  function recordCompletedStatsHistory(platform, taskType, taskId, snapshot) {
    const normalizedTaskId = String(taskId || snapshot?.taskId || "").trim();
    const result = snapshot?.result || {};
    const baseStats = platformStatesRef.current[platform]?.stats || createStatsState();
    const completedStats = {
      ...baseStats,
      activeTaskType: taskType,
      totalDanmaku: Number(snapshot?.totalDanmaku ?? baseStats.totalDanmaku ?? 0),
      totalUsers: Number(snapshot?.totalUsers ?? baseStats.totalUsers ?? 0),
      playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : baseStats.playCountResults,
      playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
        ? Number(result.playCountSelectedEpisodeCount ?? baseStats.playCountSelectedEpisodeCount ?? 0)
        : baseStats.playCountSelectedEpisodeCount,
      playCountTotal: Array.isArray(result.playCountResults) ? Number(result.playCountTotal ?? 0) : baseStats.playCountTotal,
      playCountFailed: Array.isArray(result.playCountResults) ? Boolean(result.playCountFailed) : baseStats.playCountFailed,
      idResults: Array.isArray(result.idResults) ? result.idResults : baseStats.idResults,
      idSelectedEpisodeCount: Array.isArray(result.idResults)
        ? Number(result.idSelectedEpisodeCount ?? baseStats.idSelectedEpisodeCount ?? 0)
        : baseStats.idSelectedEpisodeCount,
      revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : baseStats.revenueResults,
      revenueSummary: Array.isArray(result.revenueResults)
        ? resolveRevenueSummaryForHistory(result.revenueResults, platform, result.revenueSummary || null)
        : baseStats.revenueSummary,
    };

    const historyEntry = createStatsHistoryEntry(platform, completedStats, {
      taskType,
      createdAt: Date.now(),
    });
    const historyEntryId = appendHistoryEntry(platform, historyEntry, normalizedTaskId);
    if (historyEntryId) {
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentHistoryEntryId: historyEntryId,
        },
      }));
    }
  }

  function deleteHistoryEntry(platform, entryId) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: (Array.isArray(state.historyEntries) ? state.historyEntries : []).filter((entry) => entry.id !== entryId),
    }));
  }

  function clearHistoryEntries(platform) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: [],
    }));
  }

  function clearAllHistoryEntries() {
    clearHistoryEntries("missevan");
    clearHistoryEntries("manbo");
  }

  function getMergedHistoryEntries() {
    return ["missevan", "manbo"]
      .flatMap((platform) =>
        (Array.isArray(platformStates[platform]?.historyEntries) ? platformStates[platform].historyEntries : []).map((entry) => ({
          ...entry,
          platform: entry.platform || platform,
          platformLabel: (entry.platform || platform) === "manbo" ? "漫播" : "猫耳",
        }))
      )
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
  }

  function activateSharedOutputPlatform(platform) {
    setSharedOutputPlatform(platform);
    sharedOutputPlatformRef.current = platform;
  }

  function isAnyBackgroundTaskRunning() {
    return Boolean(
      backgroundTaskRef.current?.isRunning ||
        favoriteRefreshStateRef.current?.isRunning ||
        Object.values(platformStatesRef.current || {}).some((state) => state?.stats?.isRunning)
    );
  }

  function warnIfBackgroundTaskRunning() {
    if (!isAnyBackgroundTaskRunning()) {
      return false;
    }
    toast.warning("后台任务运行中，请等待完成后再开始新的统计。");
    return true;
  }

  function openBackgroundTaskResult() {
    const target = backgroundTaskRef.current?.resultTarget;
    if (target === "favorites") {
      navigateCurrentPlatform("favorites");
      return;
    }
    if (target === "stats") {
      navigateCurrentPlatform("search");
      scrollToPanel(outputPanelRef);
    }
  }

  function getAllSearchResults(state) {
    if (state?.searchResultSource !== "search") {
      return state?.searchResults || [];
    }
    const pageCache = state?.searchPageCache || {};
    const merged = new Map();
    Object.keys(pageCache)
      .map((key) => Number(key))
      .filter((key) => Number.isFinite(key))
      .sort((left, right) => left - right)
      .forEach((page) => {
        (Array.isArray(pageCache[page]) ? pageCache[page] : []).forEach((item) => {
          merged.set(String(item.id), item);
        });
      });
    return Array.from(merged.values());
  }

  function getPlatformResultCount(platform) {
    const state = platformStates[platform];
    if (!state) {
      return 0;
    }
    if (state.searchResultSource === "search") {
      return Number(state.searchTotalMatched || getAllSearchResults(state).length || state.searchResults?.length || 0) || 0;
    }
    return Number(state.searchResults?.length ?? 0) || 0;
  }

  function updateSearchPage(platform, page, results, meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchNextOffset: Number(meta?.nextOffset ?? state.searchNextOffset) || 0,
      searchHasMore: Boolean(meta?.hasMore),
      searchCurrentPage: page,
      searchPageSize: Number(meta?.limit ?? state.searchPageSize ?? 5) || 5,
      searchTotalMatched: Number(meta?.matchedCount ?? meta?.totalMatched ?? state.searchTotalMatched ?? normalizedResults.length) || 0,
      searchPageCache: {
        ...state.searchPageCache,
        [page]: normalizedResults.map((item) => {
          const previous = (state.searchPageCache?.[page] || []).find((cached) => String(cached.id) === String(item.id));
          return {
            ...item,
            checked: previous?.checked ?? item.checked,
          };
        }),
      },
      isLoadingMoreResults: false,
      searchResults: normalizedResults.map((item) => {
        const previous = (state.searchPageCache?.[page] || []).find((cached) => String(cached.id) === String(item.id));
        return {
          ...item,
          checked: previous?.checked ?? item.checked,
        };
      }),
    }));
  }

  function mergeSearchResults(existingResults = [], incomingResults = []) {
    const existingById = new Map(existingResults.map((item) => [String(item.id), item]));
    const mergedById = new Map();
    existingResults.forEach((item) => {
      mergedById.set(String(item.id), item);
    });
    incomingResults.forEach((item) => {
      const previous = existingById.get(String(item.id));
      mergedById.set(String(item.id), {
        ...item,
        checked: previous?.checked ?? item.checked,
      });
    });
    return Array.from(mergedById.values());
  }

  async function parseVersionedJsonResponse(response) {
    const data = await response.json();
    updateVersionStatusFromResponse({
      frontendVersion: appConfigRef.current.frontendVersion,
      backendVersion: getBackendVersionFromResponse(response, data),
      versionMismatch: data?.versionMismatch,
    });
    return data;
  }

  async function buildManboImportItems(rawItems) {
    return Promise.all(
      rawItems.map(async (raw) => {
        if (!canParseShareUrl(raw)) {
          return { raw };
        }
        const payload = await decryptShareUrl(raw);
        const resolved = extractResolvedId(payload, raw);
        if (resolved?.dramaId) {
          return {
            raw: String(resolved.dramaId),
            resolvedShareData: resolved.payload || payload,
          };
        }
        if (resolved?.setId) {
          return {
            raw: String(resolved.setId),
            resolvedShareData: resolved.payload || payload,
          };
        }
        return {
          raw,
          resolvedShareData: resolved?.payload || payload,
        };
      })
    );
  }

  async function importRawItemsIntoPlatform(targetPlatform, rawItems, options = {}) {
    const normalizedPlatform = targetPlatform === "manbo" ? "manbo" : "missevan";
    const normalizedRawItems = Array.from(
      new Set(
        (Array.isArray(rawItems) ? rawItems : [])
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      )
    );
    if (!normalizedRawItems.length) {
      toast.error("导入失败，请检查输入内容。");
      return;
    }

    if (
      normalizedPlatform === "missevan" &&
      !appConfigRef.current.desktopApp &&
      Number(appConfigRef.current.cooldownUntil ?? 0) > Date.now()
    ) {
      await refreshCooldownState();
      toast.error("猫耳当前受限，暂时无法导入。");
      return;
    }

    setSearchJumpStatus({
      platform: normalizedPlatform,
      name: "",
    });

    try {
      const items =
        normalizedPlatform === "manbo"
          ? await buildManboImportItems(normalizedRawItems)
          : normalizedRawItems.map((raw) => ({ raw }));
      const endpoint = normalizedPlatform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await parseVersionedJsonResponse(response);
      const results = Array.isArray(data?.results)
        ? data.results.map((item) => ({
            ...item,
            platform: item?.platform || normalizedPlatform,
          }))
        : [];

      if (!response.ok || !data?.success || !results.length) {
        if (normalizedPlatform === "missevan" && data?.accessDenied) {
          await refreshCooldownState();
        }
        toast.error(normalizedPlatform === "manbo" ? "Manbo 导入失败，请检查输入内容。" : "猫耳导入失败，请检查输入内容。");
        return;
      }

      const visibleImportInput = normalizedRawItems.length === 1 ? normalizedRawItems[0] : normalizedRawItems.join(", ");
      const manualInput = normalizedRawItems.join("\n");
      updateSharedSearchForm({
        keyword: visibleImportInput,
        manualInput,
      });
      updateSearchFormForPlatform(normalizedPlatform, {
        keyword: visibleImportInput,
        manualInput,
      });
      setManualSearchResults(normalizedPlatform, results, { limit: normalizedRawItems.length, scroll: false });
      navigateToolRoute({ view: "search" });
      openSearchPlatform(normalizedPlatform);
      scrollToPanel(resultsPanelRef);
      if (data.failedItems?.length) {
        toast.warning(`以下内容导入失败：${data.failedItems.join(" | ")}`);
      } else if (data.failedIds?.length) {
        toast.warning(`以下作品ID导入失败：${data.failedIds.join(", ")}`);
      }
    } catch (error) {
      console.error("Failed to cross import items", error);
      toast.error("导入失败，请检查输入内容或稍后重试。");
    } finally {
      setSearchJumpStatus(null);
    }
  }

  function normalizeDramaSearchTitles(titles, dramaIds, fallbackTitle) {
    const normalizedTitles = (Array.isArray(titles) ? titles : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    const fallback = String(fallbackTitle ?? "").trim();
    if (!normalizedTitles.length && fallback) {
      return dramaIds.map(() => fallback);
    }
    if (normalizedTitles.length === 1 && dramaIds.length > 1) {
      return dramaIds.map(() => normalizedTitles[0]);
    }
    return normalizedTitles.slice(0, dramaIds.length);
  }

  async function openDramaInSearch({ platform, id, ids, titles, name, paymentLabel, contentTypeLabel, usageAction, usageSource }) {
    const targetPlatform = platform === "manbo" ? "manbo" : "missevan";
    const dramaIds = Array.from(
      new Set(
        (Array.isArray(ids) && ids.length ? ids : [id])
          .map((item) => String(item ?? "").trim())
          .filter((item) => /^\d+$/.test(item))
      )
    );
    const manualInput = dramaIds.join("\n");
    const visibleImportInput = dramaIds.length === 1 ? dramaIds[0] : dramaIds.join(", ");
    const dramaName = String(name ?? "").trim();
    const dramaTitles = normalizeDramaSearchTitles(titles, dramaIds, dramaName);
    const normalizedUsageAction = ["ranks_open_search_result", "ongoing_open_search_result"].includes(String(usageAction ?? "").trim())
      ? String(usageAction).trim()
      : "";
    const normalizedUsageSource = String(usageSource ?? "").trim().slice(0, 40);
    if (!dramaIds.length) {
      toast.error("打开搜索结果失败，请稍后重试。");
      return;
    }

    if (targetPlatform === "missevan" && !appConfigRef.current.desktopApp && Number(appConfigRef.current.cooldownUntil ?? 0) > Date.now()) {
      updatePlatformState("missevan", (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentAction: getMissevanAccessDeniedMessage(appConfigRef.current),
        },
      }));
      toast.error(renderMissevanAccessDeniedMessage(appConfigRef.current));
      return;
    }

    setSearchJumpStatus({
      platform: targetPlatform,
      name: dramaName,
    });

    try {
      const endpoint = targetPlatform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
      const usageFields = {
        ...(dramaTitles.length ? { titles: dramaTitles } : {}),
        ...(normalizedUsageAction ? { usageAction: normalizedUsageAction } : {}),
        ...(normalizedUsageSource ? { source: normalizedUsageSource } : {}),
      };
      const body = targetPlatform === "manbo"
        ? { items: dramaIds.map((dramaId) => ({ raw: dramaId })), ...usageFields }
        : { drama_ids: dramaIds, ...usageFields };
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await parseVersionedJsonResponse(response);
      const results = Array.isArray(data?.results)
        ? data.results.map((item) => ({
            ...item,
            platform: item?.platform || targetPlatform,
            payment_label: item?.payment_label || paymentLabel,
            content_type_label: item?.content_type_label || contentTypeLabel,
          }))
        : [];

      if (!response.ok || !data?.success || !results.length) {
        if (targetPlatform === "missevan" && data?.accessDenied) {
          if (!appConfigRef.current.desktopApp) {
            await refreshCooldownState();
          }
          updatePlatformState("missevan", (state) => ({
            ...state,
            stats: {
              ...state.stats,
              currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : getMissevanAccessDeniedMessage(appConfigRef.current),
            },
          }));
          if (appConfigRef.current.desktopApp) {
            toast.error(MISSEVAN_DESKTOP_ACCESS_HINT);
          } else {
            toast.error(renderMissevanAccessDeniedMessage(appConfigRef.current));
          }
          return;
        }
        toast.error("打开搜索结果失败，请稍后重试。");
        return;
      }

      resetSearchFlow("missevan");
      resetSearchFlow("manbo");
      updateSharedSearchForm({
        keyword: visibleImportInput,
        manualInput,
      });
      updateSearchFormForPlatform(targetPlatform, {
        keyword: visibleImportInput,
        manualInput,
      });
      setManualSearchResults(targetPlatform, results, { limit: dramaIds.length, scroll: false });
      navigateToolRoute({ view: "search" });
      openSearchPlatform(targetPlatform);
      scrollToPanel(resultsPanelRef);
    } catch (error) {
      console.error("Failed to open drama in search", error);
      toast.error("打开搜索结果失败，请稍后重试。");
    } finally {
      setSearchJumpStatus(null);
    }
  }

  function beginRun(platform) {
    const meta = runtimeMetaRef.current[platform];
    meta.activeRunId += 1;
    meta.activeAbortController = new AbortController();
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
    }
    const startedAt = Date.now();
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: true,
        startedAt,
        elapsedMs: 0,
      },
    }));
    setBackgroundTask({
      isRunning: true,
      status: "running",
      type: "statistics",
      title: platform === "manbo" ? "漫播统计任务" : "猫耳统计任务",
      description: "正在准备统计",
      progress: 0,
      action: "正在准备统计",
      resultTarget: "stats",
      highlighted: true,
    });
    meta.activeElapsedTimer = setInterval(() => {
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: state.stats.isRunning
          ? {
              ...state.stats,
              elapsedMs: Date.now() - startedAt,
            }
          : state.stats,
      }));
    }, 1000);
    return {
      runId: meta.activeRunId,
      signal: meta.activeAbortController.signal,
    };
  }

  function cancelPollingRun(platform) {
    const meta = runtimeMetaRef.current[platform];
    const taskId = platformStatesRef.current[platform]?.stats?.activeTaskId || "";
    const wasRunning = Boolean(platformStatesRef.current[platform]?.stats?.isRunning || taskId);
    meta.activeAbortController?.abort?.();
    meta.activeAbortController = null;
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
      meta.activeElapsedTimer = null;
    }
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        elapsedMs: state.stats.startedAt > 0 ? Date.now() - state.stats.startedAt : state.stats.elapsedMs,
      },
    }));
    setBackgroundTask((current) =>
      wasRunning && current.type === "statistics"
        ? {
            ...current,
            isRunning: false,
            status: "cancelled",
            title: "统计已取消",
            action: "统计已取消",
            highlighted: true,
          }
        : current
    );
    return taskId;
  }

  async function cancelActiveRun(platform = getActiveWorkPlatform()) {
    const taskId = cancelPollingRun(platform);
    if (taskId) {
      notifyTaskCancel(taskId);
    }
  }

  function finishRun(platform, runId, status = "completed") {
    const meta = runtimeMetaRef.current[platform];
    if (runId !== meta.activeRunId) {
      return;
    }
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
      meta.activeElapsedTimer = null;
    }
    meta.activeAbortController = null;
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        elapsedMs: state.stats.startedAt > 0 ? Date.now() - state.stats.startedAt : state.stats.elapsedMs,
      },
    }));
    setBackgroundTask((current) => {
      if (current.type !== "statistics") {
        return current;
      }
      if (current.status === "cancelled") {
        return current;
      }
      if (status === "idle") {
        return createIdleBackgroundTask();
      }
      if (status === "completed") {
        toast.success("统计完成，结果已更新。");
      }
      return {
        ...current,
        isRunning: false,
        status,
        title: status === "completed" ? "统计完成" : "统计失败",
        action: status === "completed" ? "结果已更新，可前往查看。" : "统计未完成，请稍后重试。",
        progress: status === "completed" ? 100 : current.progress,
        resultTarget: "stats",
        highlighted: true,
      };
    });
  }

  function isRunActive(platform, runId) {
    return platformStatesRef.current[platform]?.stats?.isRunning && runtimeMetaRef.current[platform].activeRunId === runId;
  }

  async function postJson(url, payload, signal, errorMessage) {
    const response = await fetch(buildVersionedUrl(url, appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `${errorMessage}: ${response.status}`);
    }
    updateVersionStatusFromResponse({
      backendVersion: getBackendVersionFromResponse(response, data),
      frontendVersion: appConfigRef.current.frontendVersion,
    });
    return data;
  }

  async function getJson(url, signal, errorMessage) {
    const response = await fetch(buildVersionedUrl(url, appConfigRef.current.frontendVersion), {
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`${errorMessage}: ${response.status}`);
    }
    const data = await response.json();
    updateVersionStatusFromResponse({
      backendVersion: getBackendVersionFromResponse(response, data),
      frontendVersion: appConfigRef.current.frontendVersion,
    });
    return data;
  }

  function buildTaskSnapshotUrl(taskId) {
    return `/stat-tasks/${String(taskId ?? "").trim()}?_ts=${Date.now()}`;
  }

  async function waitForTaskPoll(signal, delayMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }

  function applyTaskSnapshot(platform, snapshot) {
    const progress = Number(snapshot?.progress ?? 0);
    const queuePosition = Number(snapshot?.queuePosition ?? 0);
    const currentAction =
      snapshot?.status === "queued" && queuePosition > 0
        ? `任务排队中，前方 ${queuePosition} 个任务`
        : snapshot?.currentAction || "统计中";
    setBackgroundTask((current) =>
      current.type === "statistics"
        ? {
            ...current,
            isRunning: snapshot?.status !== "completed" && snapshot?.status !== "cancelled" && snapshot?.status !== "failed",
            status: snapshot?.status || current.status || "running",
            progress,
            action: currentAction,
            description: currentAction,
            resultTarget: "stats",
            highlighted: true,
          }
        : current
    );
    updatePlatformState(platform, (state) => {
      const result = snapshot?.result || {};
      return {
        ...state,
        stats: {
          ...state.stats,
          progress,
          currentAction,
          totalDanmaku: Number(snapshot?.totalDanmaku ?? state.stats.totalDanmaku ?? 0),
          totalUsers: Number(snapshot?.totalUsers ?? state.stats.totalUsers ?? 0),
          playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : state.stats.playCountResults,
          playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
            ? Number(result.playCountSelectedEpisodeCount ?? state.stats.playCountSelectedEpisodeCount ?? 0)
            : state.stats.playCountSelectedEpisodeCount,
          playCountTotal: Array.isArray(result.playCountResults) ? Number(result.playCountTotal ?? 0) : state.stats.playCountTotal,
          playCountFailed: Array.isArray(result.playCountResults) ? Boolean(result.playCountFailed) : state.stats.playCountFailed,
          idResults: Array.isArray(result.idResults) ? result.idResults : state.stats.idResults,
          suspectedOverflowEpisodes: Array.isArray(result.idResults)
            ? Array.isArray(result.suspectedOverflowEpisodes)
              ? result.suspectedOverflowEpisodes
              : []
            : Array.isArray(result.revenueResults)
              ? Array.isArray(result.revenueSummary?.suspectedOverflowEpisodes)
                ? result.revenueSummary.suspectedOverflowEpisodes
                : []
              : state.stats.suspectedOverflowEpisodes,
          idSelectedEpisodeCount: Array.isArray(result.idResults)
            ? Number(result.idSelectedEpisodeCount ?? state.stats.idSelectedEpisodeCount ?? 0)
            : state.stats.idSelectedEpisodeCount,
          revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : state.stats.revenueResults,
          revenueSummary: Array.isArray(result.revenueResults) ? result.revenueSummary || null : state.stats.revenueSummary,
        },
      };
    });
  }

  async function startStatsTask(platform, taskType, payload, runId, signal) {
    const task = await postJson(
      "/stat-tasks",
      {
        platform,
        taskType,
        ...payload,
      },
      signal,
      "Failed to create stats task"
    );
    if (!isRunActive(platform, runId)) {
      return;
    }
    const taskId = String(task.taskId ?? "").trim();
    const resolvedTaskType = task.taskType || taskType;
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        activeTaskId: taskId,
        activeTaskType: resolvedTaskType,
      },
    }));
    applyTaskSnapshot(platform, task);
    if (!taskId) {
      throw new Error("Stats task missing taskId");
    }

    const initialSnapshot = await getJson(buildTaskSnapshotUrl(taskId), signal, "Failed to fetch stats task");
    if (!isRunActive(platform, runId)) {
      return;
    }
    applyTaskSnapshot(platform, initialSnapshot);
    if (initialSnapshot.status === "completed" || initialSnapshot.status === "cancelled") {
      if (initialSnapshot.status === "completed") {
        recordCompletedStatsHistory(platform, resolvedTaskType, taskId, initialSnapshot);
      }
      return;
    }
    if (initialSnapshot.status === "failed") {
      throw new Error(initialSnapshot.error || "Stats task failed");
    }

    while (isRunActive(platform, runId) && platformStatesRef.current[platform]?.stats?.activeTaskId === taskId) {
      await waitForTaskPoll(signal);
      const snapshot = await getJson(buildTaskSnapshotUrl(taskId), signal, "Failed to fetch stats task");
      if (!isRunActive(platform, runId)) {
        return;
      }
      applyTaskSnapshot(platform, snapshot);
      if (snapshot.status === "completed" || snapshot.status === "cancelled") {
        if (snapshot.status === "completed") {
          recordCompletedStatsHistory(platform, resolvedTaskType, taskId, snapshot);
        }
        return;
      }
      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || "Stats task failed");
      }
    }
  }

  async function refreshCooldownState() {
    if (!appConfigRef.current.desktopApp) {
      await loadAppConfig();
    }
  }

  function getCooldownMessage() {
    return getMissevanAccessDeniedMessage(appConfigRef.current);
  }

  async function showMissevanAccessHint() {
    if (getActiveWorkPlatform() !== "missevan") return;
    if (!appConfigRef.current.desktopApp) {
      await refreshCooldownState();
    }
    const message = appConfigRef.current.desktopApp ? MISSEVAN_DESKTOP_ACCESS_HINT : getCooldownMessage();
    updatePlatformState("missevan", (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : message,
      },
    }));
    setNotice({
      title: "Missevan 当前受限",
      description: appConfigRef.current.desktopApp ? message : renderMissevanAccessDeniedMessage(appConfigRef.current),
    });
  }

  function getSearchResultById(platform, dramaId) {
    return getAllSearchResults(platformStatesRef.current[platform]).find((item) => String(item.id) === String(dramaId));
  }

  function getSearchResultsByIds(platform, dramaIds) {
    const idSet = new Set((Array.isArray(dramaIds) ? dramaIds : []).map((id) => String(id)));
    return getAllSearchResults(platformStatesRef.current[platform]).filter((item) => idSet.has(String(item.id)));
  }

  function getLoadedDramaById(platform, dramaId) {
    return platformStatesRef.current[platform]?.dramas.find((item) => String(item?.drama?.id) === String(dramaId));
  }

  function getDramasEndpoint(platform) {
    return platform === "manbo" ? "/manbo/getdramas" : "/getdramas";
  }

  function normalizeFetchedDrama(result, shouldExpandImported = false) {
    return {
      ...result.info,
      expanded: shouldExpandImported,
      episodes: {
        ...result.info.episodes,
        episode: Array.isArray(result.info?.episodes?.episode)
          ? result.info.episodes.episode.map((episode) => ({
              ...episode,
              selected: false,
            }))
          : [],
      },
    };
  }

  async function fetchDramasByIds(platform, dramaIds, signal, options = {}) {
    const requestedIds = Array.from(
      new Set(
        (Array.isArray(dramaIds) ? dramaIds : [])
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
      )
    );
    const loadedById = new Map();
    const missingIds = [];
    requestedIds.forEach((id) => {
      const loaded = (Array.isArray(options.loadedDramas) ? options.loadedDramas : []).find((item) => String(item?.drama?.id) === id)
        || getLoadedDramaById(platform, id);
      if (loaded) {
        loadedById.set(id, loaded);
        return;
      }
      missingIds.push(id);
    });

    if (!missingIds.length) {
      return requestedIds.map((id) => ({
        success: true,
        id,
        drama: loadedById.get(id),
        loaded: true,
      }));
    }

    const searchResults = Array.isArray(options.searchResults) ? options.searchResults : getAllSearchResults(platformStatesRef.current[platform]);
    const payload = { drama_ids: missingIds };
    if (platform === "missevan") {
      const soundIdMap = {};
      missingIds.forEach((id) => {
        const searchResult = searchResults.find((item) => String(item?.id) === id);
        if (Number(searchResult?.sound_id) > 0) {
          soundIdMap[id] = Number(searchResult.sound_id);
        }
      });
      payload.sound_id_map = soundIdMap;
    }

    const data = await postJson(getDramasEndpoint(platform), payload, signal, "Failed to load dramas");
    const fetchedById = new Map(
      extractResponseItems(data).map((result) => [String(result?.id ?? ""), result])
    );

    return requestedIds.map((id) => {
      const loaded = loadedById.get(id);
      if (loaded) {
        return {
          success: true,
          id,
          drama: loaded,
          loaded: true,
        };
      }
      const result = fetchedById.get(id);
      if (result?.success && result?.info) {
        return {
          success: true,
          id,
          drama: normalizeFetchedDrama(result, Boolean(options.expandImported)),
          loaded: false,
        };
      }
      return {
        success: false,
        id,
        accessDenied: Boolean(result?.accessDenied),
      };
    });
  }

  async function registerApiSearchDramaIds(platform, ids) {
    const normalizedPlatform = platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : "";
    if (!normalizedPlatform) {
      return;
    }

    const expectedSource = normalizedPlatform === "manbo" ? "manbo_api" : "missevan_api";
    const fallbackIds = getSearchResultsByIds(normalizedPlatform, ids)
      .filter((item) => item?.search_source === expectedSource)
      .map((item) => item.id);
    if (!fallbackIds.length) {
      return;
    }

    try {
      await postJson(
        "/register-new-drama-ids",
        { platform: normalizedPlatform, drama_ids: fallbackIds },
        undefined,
        "Failed to register new drama ids"
      );
    } catch (error) {
      console.error("Failed to register API search drama ids", error);
    }
  }

  async function addDramas(ids, options = {}) {
    const platform = resolveStatsPlatform(options?.platform);
    if (!ids?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    const shouldAutoCheck = options?.autoCheck === true;
    const shouldExpandImported = options?.expandImported === true;
    const selectMode = ["all", "paid"].includes(options?.selectMode) ? options.selectMode : "";
    const shouldSelectImportedEpisodes = Boolean(selectMode);
    const shouldPreserveScroll = options?.preserveScroll === true;
    const scrollToDramaId = options?.scrollToDramaId;
    let hasAccessDenied = false;
    const currentState = platformStatesRef.current[platform];
    const existingDramaMap = new Map(currentState.dramas.map((drama) => [String(drama?.drama?.id), drama]));
    const mergedDramas = [...currentState.dramas];
    const importedIdSet = new Set();
    const requestedIdSet = new Set(ids.map((id) => String(id)));

    try {
      await registerApiSearchDramaIds(platform, ids);

      const missingIds = ids
        .map((id) => String(id))
        .filter((id) => !existingDramaMap.has(String(id)));
      const batchResult = await fetchDramasByIds(platform, missingIds);
      batchResult.forEach((result) => {
        if (result?.success && result?.drama) {
          const drama = {
            ...result.drama,
            expanded: shouldExpandImported,
          };
          mergedDramas.push(drama);
          existingDramaMap.set(String(result.id), drama);
          importedIdSet.add(String(result.id));
          return;
        }
        if (result?.accessDenied) {
          hasAccessDenied = true;
        }
        console.error(`Failed to import drama ${result?.id}`);
      });

      if (shouldSelectImportedEpisodes) {
        selectDramaEpisodesByMode(mergedDramas, Array.from(requestedIdSet), {
          mode: selectMode,
          checked: true,
          expand: shouldExpandImported,
          isSelectableEpisode: (episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode),
        });
      }

      updatePlatformState(platform, (state) => ({
        ...state,
        searchResults: shouldAutoCheck
          ? state.searchResults.map((item) => ({
              ...item,
              checked: requestedIdSet.has(String(item.id)) || importedIdSet.has(String(item.id)) ? true : item.checked,
            }))
          : state.searchResults,
        searchPageCache: shouldAutoCheck
          ? Object.fromEntries(
              Object.entries(state.searchPageCache || {}).map(([page, pageResults]) => [
                page,
                Array.isArray(pageResults)
                  ? pageResults.map((item) => ({
                      ...item,
                      checked: requestedIdSet.has(String(item.id)) || importedIdSet.has(String(item.id)) ? true : item.checked,
                    }))
                  : pageResults,
              ])
            )
          : state.searchPageCache,
        dramas: mergedDramas,
        selectedEpisodesSnapshot: collectSelectedEpisodesFromDramas(mergedDramas),
      }));
      if (hasAccessDenied) {
        await showMissevanAccessHint();
      }
      if (scrollToDramaId != null) {
        scrollToDramaResult(scrollToDramaId);
      } else if (mergedDramas.length > 0 && !shouldPreserveScroll) {
        scrollToPanel(resultsPanelRef);
      }
      return {
        dramas: mergedDramas,
        importedIds: Array.from(importedIdSet),
        requestedIds: Array.from(requestedIdSet),
      };
    } catch (error) {
      console.error("Failed to import dramas", error);
      toast.error("导入作品失败，请稍后重试。");
      return {
        dramas: platformStatesRef.current[platform]?.dramas || [],
        importedIds: [],
        requestedIds: Array.from(requestedIdSet),
      };
    }
  }

  async function loadMoreSearchResults(platform = getActiveWorkPlatform()) {
    const state = platformStatesRef.current[platform];
    const keyword = String(state?.searchKeyword ?? "").trim();
    const pageSize = Number(state?.searchPageSize ?? 5) || 5;
    const offset = Number(state?.searchNextOffset ?? state?.searchResults?.length ?? 0) || 0;
    if (!keyword || state?.searchResultSource === "manual" || state?.isLoadingMoreResults || !state?.searchHasMore) {
      return;
    }

    updatePlatformState(platform, (current) => ({
      ...current,
      isLoadingMoreResults: true,
    }));

    try {
      const endpoint =
        platform === "manbo"
          ? `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`
          : `/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`;
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      const data = await parseVersionedJsonResponse(response);

      if (!data?.success) {
        if (platform === "missevan" && data?.accessDenied) {
          resetSearchFlow(platform);
          await showMissevanAccessHint();
        } else if (platform === "manbo" && data?.unavailable) {
          toast.error("漫播搜索不可用，请改用 ID 或链接导入。");
          updatePlatformState(platform, (current) => ({
            ...current,
            isLoadingMoreResults: false,
          }));
        } else {
          toast.error("加载搜索结果失败，请稍后重试。");
          updatePlatformState(platform, (current) => ({
            ...current,
            isLoadingMoreResults: false,
          }));
        }
        return;
      }

      const incomingResults = Array.isArray(data.results) ? data.results.map((item) => ({ ...item })) : [];
      const nextOffset = Number(data.meta?.nextOffset ?? offset + incomingResults.length) || 0;
      const totalMatched = Number(data.meta?.matchedCount ?? data.meta?.totalMatched ?? state.searchTotalMatched ?? 0) || 0;
      const page = Math.floor(offset / Math.max(1, pageSize)) + 1;

      updatePlatformState(platform, (current) => {
        const mergedResults = mergeSearchResults(current.searchResults || [], incomingResults);
        return {
          ...current,
          searchNextOffset: nextOffset,
          searchHasMore: Boolean(data.meta?.hasMore) && (!totalMatched || mergedResults.length < totalMatched),
          searchCurrentPage: page,
          searchPageSize: pageSize,
          searchTotalMatched: totalMatched,
          searchPageCache: {
            ...current.searchPageCache,
            [page]: incomingResults.map((item) => {
              const previous = (current.searchResults || []).find((cached) => String(cached.id) === String(item.id));
              return {
                ...item,
                checked: previous?.checked ?? item.checked,
              };
            }),
          },
          isLoadingMoreResults: false,
          searchResults: mergedResults,
        };
      });
    } catch (error) {
      console.error("Failed to load more search results", error);
      if (platform === "missevan" && error?.accessDenied) {
        await showMissevanAccessHint();
      } else {
        toast.error("加载搜索结果失败，请稍后重试。");
      }
      updatePlatformState(platform, (current) => ({
        ...current,
        isLoadingMoreResults: false,
      }));
    }
  }

  async function startPlayCountStatistics(soundIds, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const selectedEpisodeSource = Array.isArray(options?.selectedEpisodes)
      ? options.selectedEpisodes
      : platformStatesRef.current[platform].selectedEpisodesSnapshot;
    const selectedEpisodes = selectedEpisodeSource.filter((episode) => soundIds.includes(episode.sound_id));
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    if (!selectedEpisodes.length) {
      toast.warning("请先选择分集。");
      finishRun(platform, runId, "idle");
      return;
    }
    activateSharedOutputPlatform(platform);
    await registerApiSearchDramaIds(
      platform,
      selectedEpisodes.map((episode) => episode.drama_id)
    );
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始统计播放量",
        playCountSelectedEpisodeCount: selectedEpisodes.length,
      },
    }));
    scrollToPanel(outputPanelRef);
    let finalStatus = "completed";
    try {
      const payload = { episodes: selectedEpisodes };
      if (platform === "missevan") {
        const playCountDramas = buildPlayCountDramasFromDramas(platformStatesRef.current[platform].dramas);
        if (playCountDramas.length) {
          payload.playCountDramas = playCountDramas;
        }
      }
      await startStatsTask(platform, "play_count", payload, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function startIdStatisticsForEpisodes(selectedEpisodes, emptyMessage = "请先选择分集。", options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const source = resolveIdStatisticsSource({
      platform,
      dramas: platformStatesRef.current[platform]?.dramas,
      selectedEpisodes,
      source: options?.source,
    });
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    if (!selectedEpisodes.length) {
      toast.warning(emptyMessage);
      finishRun(platform, runId, "idle");
      return;
    }
    activateSharedOutputPlatform(platform);
    await registerApiSearchDramaIds(
      platform,
      selectedEpisodes.map((episode) => episode.drama_id)
    );
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始统计弹幕与去重 ID",
        idSelectedEpisodeCount: selectedEpisodes.length,
      },
    }));
    scrollToPanel(outputPanelRef);
    let finalStatus = "completed";
    try {
      await startStatsTask(
        platform,
        "id",
        { episodes: selectedEpisodes, source },
        runId,
        signal
      );
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function startIdStatisticsConcurrent(soundIds, options = {}) {
    const platform = resolveStatsPlatform(options?.platform);
    const selectedEpisodeSource = Array.isArray(options?.selectedEpisodes)
      ? options.selectedEpisodes
      : platformStatesRef.current[platform].selectedEpisodesSnapshot;
    const selectedEpisodes = selectedEpisodeSource.filter((episode) => soundIds.includes(episode.sound_id));
    await startIdStatisticsForEpisodes(selectedEpisodes, "请先选择分集。", { platform });
  }

  async function startDramaPaidIdStatistics(dramaId, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const normalizedDramaId = String(dramaId ?? "").trim();
    if (!normalizedDramaId) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const addDramasForContext = options?.addDramas || addDramas;
    const importResult = await addDramasForContext([dramaId], {
      autoCheck: true,
      expandImported: true,
      preserveScroll: true,
      selectMode: "paid",
      platform,
    });
    const nextDramas = importResult?.dramas || platformStatesRef.current[platform]?.dramas || [];
    const drama = nextDramas.find((item) => String(item?.drama?.id) === normalizedDramaId);
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    const paidEpisodes = episodes.filter((episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode));

    if (!paidEpisodes.length) {
      toast.warning("没有可统计的付费分集。");
      return;
    }

    const dramaTitle = drama?.drama?.name || "";
    const selectedPaidEpisodes = paidEpisodes.map((episode) => ({
      drama_id: normalizedDramaId,
      sound_id: episode.sound_id,
      drama_title: dramaTitle,
      episode_title: episode.name,
      duration: Number(episode.duration ?? 0),
    }));
    await startIdStatisticsForEpisodes(
      selectedPaidEpisodes,
      "没有可统计的付费分集。",
      { platform, source: options?.source }
    );
  }

  async function startRevenueEstimate(dramaIds, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    if (!dramaIds?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    activateSharedOutputPlatform(platform);
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始最低收益预估",
      },
    }));
    scrollToPanel(outputPanelRef);
    let finalStatus = "completed";
    try {
      await registerApiSearchDramaIds(platform, dramaIds);
      await startStatsTask(
        platform,
        "revenue",
        { dramaIds, source: options?.source },
        runId,
        signal
      );
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function cancelCurrentStatistics() {
    const platform = sharedOutputPlatformRef.current;
    const stats = platformStatesRef.current[platform]?.stats;
    if (!stats?.isRunning && !stats?.activeTaskId) {
      return;
    }
    await cancelActiveRun(platform);
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "统计已取消",
      },
    }));
  }

  const missevanResultCount = getPlatformResultCount("missevan");
  const manboResultCount = getPlatformResultCount("manbo");

  return (
    <div className="app-shell mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 pt-3 sm:px-5 sm:pt-[6.5rem] lg:gap-5 lg:px-6">
      {mainDrawerOpen ? (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={closeMainDrawer} aria-hidden="true" />
      ) : null}
      {mainDrawerOpen ? (
        <MainNavigationDrawer
          platforms={visiblePlatforms}
          currentRoute={toolRouteState}
          ongoingMenu={ongoingNavigationMenu}
          ranksMenu={ranksNavigationMenu}
          ranksMenuStatus={mainNavigationRanksStatus}
          defaultExpandedRootKeys={defaultExpandedRootKeys}
          drawerRootItemClassName={drawerRootItemClassName}
          drawerChildItemClassName={drawerChildItemClassName}
          drawerUtilityItemClassName={drawerUtilityItemClassName}
          mobileMenuActiveItemClassName={mobileMenuActiveItemClassName}
          onRequestRanksMenu={loadMainNavigationRanks}
          onCommitRoute={navigateToolRouteFromMenu}
          onOpenChangelog={openDrawerChangelog}
          onOpenFeedback={openDrawerFeedback}
          featureSuggestionUrl={appConfig.featureSuggestionUrl}
          desktopApp={appConfig.desktopApp}
          desktopAppUrl={appConfig.desktopAppUrl}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        className="sm:hidden fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 shrink-0 bg-background/92 backdrop-blur-xl"
        aria-expanded={mainDrawerOpen}
        aria-controls="main-navigation-drawer"
        aria-label={mainMenuButtonLabel}
        title={mainMenuButtonLabel}
        onClick={() => setMainDrawerOpen((open) => !open)}
      >
        <MenuIcon aria-hidden="true" className="size-4" />
      </Button>
      <header className="-mx-3 border-b border-border/75 bg-background/92 px-3 py-3 backdrop-blur-xl sm:fixed sm:inset-x-0 sm:top-0 sm:z-30 sm:mx-0 sm:px-5 lg:px-6">
        <div className="relative mx-auto grid max-w-7xl gap-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
          <div className="flex min-w-0 items-start gap-3 pr-14 sm:col-start-1 sm:row-start-1 sm:pr-0">
            <button
              type="button"
              aria-label={headerHomeLabel}
              className="inline-flex min-w-0 shrink-0 items-center text-left text-inherit leading-none"
              onClick={openHomeFromHeader}
            >
              <AppIcon className="size-14 self-center rounded-xl sm:size-12" />
            </button>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-primary">{appConfig.brandName}</div>
                <span className="text-xs font-semibold leading-none text-muted-foreground">
                  v{appConfig.frontendVersion}
                </span>
              </div>
              <h1 className="mt-1 min-w-0 text-[22px] font-semibold leading-tight tracking-tight sm:text-xl lg:text-2xl">
                <button
                  type="button"
                  aria-label={headerHomeLabel}
                  className="inline-flex min-w-0 text-left text-inherit leading-tight [font:inherit] [letter-spacing:inherit]"
                  onClick={openHomeFromHeader}
                >
                  <span className="min-w-0">{appConfig.titleZh}</span>
                </button>
              </h1>
            </div>
          </div>
          <SearchPanel
            className="w-full sm:col-start-2 sm:row-start-1 sm:w-full"
            descriptionClassName="sm:hidden"
            cooldownHours={appConfig.cooldownHours}
            cooldownUntil={appConfig.cooldownUntil}
            desktopAppUrl={appConfig.desktopAppUrl}
            formState={sharedSearchForm}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            isDesktopApp={appConfig.desktopApp}
            onCrossPlatformImport={({ targetPlatform, rawItems, sourcePlatform, emptyResultNotice }) =>
              importRawItemsIntoPlatform(targetPlatform, rawItems, {
                sourcePlatform,
                emptyResultNotice,
              })
            }
            onNotice={setNotice}
            onResetPlatformState={resetSearchFlow}
            onSearchCommit={commitGlobalSearchNavigation}
            onSearchPendingChange={setGlobalSearchPending}
            onSelectPlatform={setActiveSearchPlatform}
            onUpdateFormState={updateSharedSearchForm}
            onUpdatePlatformResults={(platform, results, source, meta) => setSearchResults(platform, results, source, meta)}
            placeholder="请输入关键词、ID、分享链接。"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="hidden shrink-0 sm:inline-flex sm:col-start-3 sm:row-start-1"
            aria-expanded={mainDrawerOpen}
            aria-controls="main-navigation-drawer"
            aria-label={mainMenuButtonLabel}
            title={mainMenuButtonLabel}
            onClick={() => setMainDrawerOpen((open) => !open)}
          >
            <MenuIcon aria-hidden="true" className="size-4" />
          </Button>

          {appConfig.versionMismatch ? (
            <Alert className="border-destructive/30 bg-destructive/10 sm:col-span-3">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>工具版本已更新</AlertTitle>
              <AlertDescription>
                工具已更新，请刷新或重新打开页面。若还看到此提醒，请清理缓存后再重试。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </header>

      {currentPlatform === "home" ? (
        <HomeView
          frontendVersion={appConfig.frontendVersion}
          handleVersionResponse={updateVersionStatusFromResponse}
          onNavigateRoute={navigateHomeRoute}
          onOpenSearchResult={openDramaInSearch}
        />
      ) : currentPlatform === "ranks" ? (
        <Suspense
          fallback={
            <LazyRouteFallback
              title="正在加载榜单"
              description="正在准备完整榜单页，首页榜单缓存会继续复用。"
            />
          }
        >
          <RanksPanel
            favoriteKeys={favoriteKeySet}
            favoriteActionsDisabled={favoriteActionsDisabled}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            routeState={toolRouteState}
            onRouteStateChange={navigateToolRoute}
            onToggleFavorite={toggleFavorite}
            onOpenSearchResult={openDramaInSearch}
            onAddCompareItem={addDramaToCompareBasket}
          />
        </Suspense>
      ) : currentPlatform === "ongoing" ? (
        <Suspense
          fallback={
            <LazyRouteFallback
              title="正在加载追更"
              description="正在准备完整追更页，首页连载缓存会继续复用。"
            />
          }
        >
          <OngoingPanel
            favoriteKeys={favoriteKeySet}
            favoriteActionsDisabled={favoriteActionsDisabled}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            routeState={toolRouteState}
            onRouteStateChange={navigateToolRoute}
            onToggleFavorite={toggleFavorite}
            onOpenSearchResult={openDramaInSearch}
            onAddCompareItem={addDramaToCompareBasket}
          />
        </Suspense>
      ) : currentPlatform === "feedback" ? (
        <FeedbackView featureSuggestionUrl={appConfig.featureSuggestionUrl} />
      ) : currentPlatform === "favorites" ? (
        <FavoritesPanel
          favorites={favoriteItems}
          favoriteActionsDisabled={favoriteActionsDisabled}
          statisticsActionsDisabled={statisticsActionsDisabled}
          frontendVersion={appConfig.frontendVersion}
          handleVersionResponse={updateVersionStatusFromResponse}
          isDesktopApp={appConfig.desktopApp}
          cooldownHours={appConfig.cooldownHours}
          cooldownUntil={appConfig.cooldownUntil}
          desktopAppUrl={appConfig.desktopAppUrl}
          onFavoritesChange={reloadFavoriteItems}
          onBackgroundTaskChange={setBackgroundTask}
          refreshState={favoriteRefreshState}
          refreshRevision={favoriteRefreshRevision}
          onRefreshStateChange={setFavoriteRefreshState}
          onRefreshSettled={handleFavoriteRefreshSettled}
          onToggleFavorite={toggleFavorite}
        />
      ) : (
        <div className="grid gap-4 sm:gap-5">
          <div className="hidden sm:block">
            <MetricLegend />
          </div>

          {searchMetricLegendOpen ? (
            <div id="search-metric-legend" className="sm:hidden">
              <MetricLegend />
            </div>
          ) : null}

          <section ref={resultsPanelRef} className="grid gap-3">
            <SearchResults
              dramas={currentBrowseState?.dramas || []}
              frontendVersion={appConfig.frontendVersion}
              handleVersionResponse={updateVersionStatusFromResponse}
              favoriteKeys={favoriteKeySet}
              favoriteActionsDisabled={favoriteActionsDisabled}
              statisticsActionsDisabled={statisticsActionsDisabled}
              onAddDramas={addDramas}
              onSelectionChange={updateSelection}
              onSetDramas={setDramas}
              onSetResults={setResults}
              onStartIdStatistics={startIdStatisticsConcurrent}
              onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
              onStartPlayCountStatistics={startPlayCountStatistics}
              onStartRevenueEstimate={startRevenueEstimate}
              onToggleFavorite={toggleFavorite}
              onAddCompareItem={addDramaToCompareBasket}
              onLoadMoreResults={() => loadMoreSearchResults(activeBrowsePlatform)}
              allResults={getAllSearchResults(currentBrowseState)}
              hasMoreResults={Boolean(currentBrowseState?.searchHasMore)}
              isSearchPending={globalSearchPending}
              isLoadingMoreResults={Boolean(currentBrowseState?.isLoadingMoreResults)}
              loadedResultCount={Number(currentBrowseState?.searchResults?.length ?? 0) || 0}
              platformTabs={visibleSearchPlatforms}
              activePlatform={activeBrowsePlatform}
              onPlatformChange={setActiveSearchPlatform}
              metricLegendOpen={searchMetricLegendOpen}
              onToggleMetricLegend={() => setSearchMetricLegendOpen((open) => !open)}
              platformResultCounts={{
                missevan: missevanResultCount,
                manbo: manboResultCount,
              }}
              platform={activeBrowsePlatform}
              resultSource={currentBrowseState?.searchResultSource || "search"}
              results={currentBrowseState?.searchResults || []}
              selectedEpisodes={currentBrowseState?.selectedEpisodesSnapshot || []}
              totalResults={Number(currentBrowseState?.searchTotalMatched ?? 0) || 0}
            />
          </section>

          <section ref={outputPanelRef} className="grid gap-3">
            <OutputPanel
              currentAction={sharedStatsState?.currentAction}
              currentHistoryEntryId={sharedStatsState?.currentHistoryEntryId}
              elapsedMs={sharedStatsState?.elapsedMs}
              historyEntries={sharedHistoryEntries}
              idResults={sharedStatsState?.idResults}
              idSelectedEpisodeCount={sharedStatsState?.idSelectedEpisodeCount}
              isRunning={sharedStatsState?.isRunning}
              onCancelStatistics={cancelCurrentStatistics}
              onClearHistory={clearAllHistoryEntries}
              onDeleteHistoryEntry={(entry) => deleteHistoryEntry(entry.platform, entry.id)}
              platform={sharedOutputPlatform}
              playCountFailed={sharedStatsState?.playCountFailed}
              playCountResults={sharedStatsState?.playCountResults}
              playCountSelectedEpisodeCount={sharedStatsState?.playCountSelectedEpisodeCount}
              playCountTotal={sharedStatsState?.playCountTotal}
              progress={sharedStatsState?.progress}
              revenueResults={sharedStatsState?.revenueResults}
              revenueSummary={sharedRevenueSummary}
              suspectedOverflowEpisodes={sharedStatsState?.suspectedOverflowEpisodes}
              totalDanmaku={sharedStatsState?.totalDanmaku}
              totalUsers={sharedStatsState?.totalUsers}
            />
          </section>
        </div>
      )}

      <BackgroundTaskCenter
        task={backgroundTask}
        isDesktopApp={appConfig.desktopApp}
        onOpenResults={openBackgroundTaskResult}
        onDismiss={() => setBackgroundTask(createIdleBackgroundTask())}
      />
      <DramaCompareBasket
        items={compareItems}
        open={compareBasketOpen}
        onOpenChange={setCompareBasketOpen}
        onOpenCompare={openCompareDialogFromBasket}
        onRemoveItem={removeDramaFromCompareBasket}
        onClear={clearCompareBasket}
      />
      <DramaCompareDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        items={compareItems}
        frontendVersion={appConfig.frontendVersion}
        handleVersionResponse={updateVersionStatusFromResponse}
      />
      <MessageDialog notice={notice} onClose={() => setNotice(null)} />
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />

      <AlertDialog
        open={Boolean(cancelFavoriteRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelFavoriteRequest(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangleIcon aria-hidden="true" className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>取消收藏</AlertDialogTitle>
            <AlertDialogDescription>
              会删除这部作品的收藏记录和历史统计数据，确认取消收藏吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveFavorite}>取消收藏</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(searchJumpStatus)} onOpenChange={() => {}}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <RefreshCwIcon aria-hidden="true" className="size-5 animate-spin" />
            </AlertDialogMedia>
            <AlertDialogTitle>正在查询</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {searchJumpStatus?.name
                ? `正在查询《${searchJumpStatus.name}》，稍后将跳转到搜索结果。`
                : "正在查询目标剧集，稍后将跳转到搜索结果。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
