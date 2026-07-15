import { useEffect, useRef, useState } from "react";
import {
  CalculatorIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChartNoAxesColumnIncreasingIcon,
  Clock3Icon,
  HouseIcon,
  MessageSquarePlusIcon,
  MonitorIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  StarIcon,
} from "lucide-react";

import { PlatformIdIcon } from "@/app/platformTabLabel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
const mainNavigationIconMap = {
  home: HouseIcon,
  search: CalculatorIcon,
  ongoing: Clock3Icon,
  ranks: ChartNoAxesColumnIncreasingIcon,
  favorites: StarIcon,
  feedback: MessageSquarePlusIcon,
};

export function LazyRouteFallback({ title = "正在加载页面", description = "正在准备页面内容。" }) {
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

export function getInitialDrawerExpandedRootKeys(currentRoute, isDesktopBrowser) {
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

export function DesktopMainNavigationMenu({
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

    function closeOpenMenu() {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setOpenKey("");
      setActivePlatformKey("");
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeOpenMenu();
      }
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        closeOpenMenu();
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

export function MainNavigationDrawer({
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
  const initialRanksRequestRef = useRef({
    defaultExpandedRootKeys,
    onRequestRanksMenu,
  });
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
    const initialRequest = initialRanksRequestRef.current;
    if (!didRequestInitialDrawerRanksRef.current && initialRequest.defaultExpandedRootKeys.some((key) => key === "missevan" || key === "manbo")) {
      didRequestInitialDrawerRanksRef.current = true;
      initialRequest.onRequestRanksMenu?.();
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
