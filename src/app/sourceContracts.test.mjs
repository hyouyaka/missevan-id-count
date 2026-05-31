import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageDialogSource = readFileSync(new URL("./MessageDialog.jsx", import.meta.url), "utf8");
const changelogDialogSource = readFileSync(new URL("./ChangelogDialog.jsx", import.meta.url), "utf8");
const appUtilsSource = readFileSync(new URL("./app-utils.js", import.meta.url), "utf8");
const favoritesPanelSource = readFileSync(new URL("./FavoritesPanel.jsx", import.meta.url), "utf8");
const favoritesStorageSource = readFileSync(new URL("./favoritesStorage.js", import.meta.url), "utf8");
const landingViewSource = readFileSync(new URL("./LandingView.jsx", import.meta.url), "utf8");
const ongoingPanelSource = readFileSync(new URL("./OngoingPanel.jsx", import.meta.url), "utf8");
const outputPanelSource = readFileSync(new URL("./OutputPanel.jsx", import.meta.url), "utf8");
const platformTabLabelSource = readFileSync(new URL("./platformTabLabel.jsx", import.meta.url), "utf8");
const ranksPanelSource = readFileSync(new URL("./RanksPanel.jsx", import.meta.url), "utf8");
const rankTrendUiSource = readFileSync(new URL("./rankTrendUi.jsx", import.meta.url), "utf8");
const ranksTrendUtilsSource = readFileSync(new URL("../../shared/ranksTrendUtils.js", import.meta.url), "utf8");
const searchPanelSource = readFileSync(new URL("./SearchPanel.jsx", import.meta.url), "utf8");
const searchResultsSource = readFileSync(new URL("./SearchResults.jsx", import.meta.url), "utf8");
const toolViewSource = readFileSync(new URL("./ToolView.jsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("message dialog keeps horizontal confirm actions", () => {
  assert.match(messageDialogSource, /AlertDialogFooter\s+className=/);
  assert.match(messageDialogSource, /grid-cols-2/);
});

test("Missevan fallback dialog places confirm before cancel", () => {
  const actionIndex = messageDialogSource.indexOf("<AlertDialogAction");
  const cancelIndex = messageDialogSource.indexOf("<AlertDialogCancel");

  assert.ok(actionIndex >= 0, "expected an action button");
  assert.ok(cancelIndex >= 0, "expected a cancel button");
  assert.ok(actionIndex < cancelIndex, "expected confirm button to render before cancel button");
});

test("Manbo empty search falls back to Missevan library search only", () => {
  const manboBranchStart = searchPanelSource.indexOf('if (platform === "manbo")');
  assert.notEqual(manboBranchStart, -1, "Manbo keyword search branch should exist");
  const fallbackStart = searchPanelSource.indexOf("const fallbackResponse", manboBranchStart);
  assert.notEqual(fallbackStart, -1, "Manbo empty search should try Missevan fallback");
  const fallbackEnd = searchPanelSource.indexOf("showBlockingNotice", fallbackStart);
  assert.notEqual(fallbackEnd, -1, "Manbo fallback branch should end before empty-result notice");
  const fallbackBranch = searchPanelSource.slice(fallbackStart, fallbackEnd);

  assert.match(fallbackBranch, /buildSearchPath\("missevan", keyword, \{ apiFallback: false, localOnly: true \}\)/);
  assert.match(fallbackBranch, /onMissevanFallbackResults/);
  assert.doesNotMatch(
    fallbackBranch,
    /`\/search\?keyword=\$\{encodeURIComponent\(keyword\)\}&offset=0&limit=5`/
  );
});

test("Manbo numeric import only accepts 18 to 20 digit IDs", () => {
  assert.match(appUtilsSource, /\\d\{18,20\}/, "Manbo numeric import should use an 18-20 digit range");
  assert.doesNotMatch(appUtilsSource, /if \(\^\\d\+\$\.test\(raw\)\) \{\s*return true;/, "Manbo import should not accept any numeric token");
});

test("Missevan numeric import failure has short-keyword and API-fallback branches", () => {
  assert.match(searchPanelSource, /emptyResultNotice === "short_keyword"/);
  assert.match(searchPanelSource, /allowMissevanApiFallback/);
});

test("Manbo API search results are the only Manbo search results registered as new ids", () => {
  assert.match(toolViewSource, /expectedSource = normalizedPlatform === "manbo" \? "manbo_api" : "missevan_api"/);
  assert.match(toolViewSource, /item\?\.search_source === expectedSource/);
  assert.match(toolViewSource, /platform: normalizedPlatform/);
  assert.match(toolViewSource, /confirmMissevanFallbackSearch/);
  assert.match(toolViewSource, /onMissevanFallbackResults=\{confirmMissevanFallbackSearch\}/);
});

test("Manbo search supports local-only fallback mode", () => {
  const routeStart = serverSource.indexOf('app.get("/manbo/search"');
  assert.notEqual(routeStart, -1, "Manbo search route should exist");
  const routeEnd = serverSource.indexOf('app.post("/manbo/getdramacards"', routeStart);
  assert.notEqual(routeEnd, -1, "Manbo search route end marker should exist");
  const routeSource = serverSource.slice(routeStart, routeEnd);
  const localOnlyIndex = routeSource.indexOf('source: "library_only"');
  const apiCallIndex = routeSource.indexOf("fetchManboSearchApiRecords");

  assert.match(routeSource, /req\.query\.apiFallback/);
  assert.ok(localOnlyIndex >= 0, "Manbo search should return library_only when API fallback is disabled");
  assert.ok(apiCallIndex > localOnlyIndex, "Manbo API fetch should occur after local-only branch");
});

test("Missevan API search falls back to Manbo library when API titles miss keyword", () => {
  assert.match(searchPanelSource, /shouldUseManboLibraryFallbackForMissevanSearch/);
  assert.match(searchPanelSource, /onManboFallbackResults/);
  assert.match(searchPanelSource, /buildSearchPath\("manbo", keyword, \{ apiFallback: false \}\)/);
  assert.match(toolViewSource, /confirmManboFallbackSearch/);
  assert.match(toolViewSource, /onManboFallbackResults=\{confirmManboFallbackSearch\}/);
});

test("Missevan API results remain available when Manbo fallback has no matches", () => {
  const fallbackStart = searchPanelSource.indexOf("if (shouldUseManboLibraryFallbackForMissevanSearch");
  assert.notEqual(fallbackStart, -1, "Missevan API mismatch fallback branch should exist");
  const successStart = searchPanelSource.indexOf("if (data.success)", fallbackStart);
  assert.notEqual(successStart, -1, "Missevan API success branch should remain after fallback");
  const fallbackMissBranch = searchPanelSource.slice(fallbackStart, successStart);

  assert.doesNotMatch(fallbackMissBranch, /showBlockingNotice/);
  assert.doesNotMatch(fallbackMissBranch, /catch \(fallbackError\)[\s\S]*?\}\s*return;\s*\}/);
});

test("search result cards show original author between ID and main CV with a distinct icon", () => {
  assert.match(searchResultsSource, /FeatherIcon/, "search result author row should use a distinct author icon");
  assert.match(searchResultsSource, /aria-label="原作名"/, "author icon should expose the original-author label");
  assert.match(searchResultsSource, /const originalAuthorText = String\(item\.author \?\? ""\)\.trim\(\);/);
  assert.match(searchResultsSource, /originalAuthorText \|\| "暂无"/);

  const idRowIndex = searchResultsSource.indexOf("aria-label={idLabel}");
  const authorRowIndex = searchResultsSource.indexOf('aria-label="原作名"');
  const cvRowIndex = searchResultsSource.indexOf('aria-label="主要CV"');

  assert.ok(idRowIndex >= 0, "ID row should exist");
  assert.ok(authorRowIndex > idRowIndex, "author row should render below ID");
  assert.ok(cvRowIndex > authorRowIndex, "CV row should render below author");
});

test("desktop primary search does not disable public API fallback", () => {
  assert.match(searchPanelSource, /function buildSearchPath/);
  assert.match(searchPanelSource, /isDesktopApp/);
  assert.match(searchPanelSource, /!isDesktopApp \|\| options\.localOnly === true/);
  assert.match(searchPanelSource, /apiFallback=0/);
});

test("mobile search result actions stay in one fixed four-column row", () => {
  assert.match(
    searchResultsSource,
    /const mobileResultActionsClass = "grid w-fit max-w-full grid-cols-\[max-content_max-content_max-content_max-content\]/,
    "mobile result actions should use content-sized columns instead of stretching across the card"
  );
  assert.doesNotMatch(
    searchResultsSource,
    /mobileResultActionsClass = "[^"]*mx-auto/,
    "mobile result actions should stay left-aligned instead of centering themselves"
  );
  assert.match(
    searchResultsSource,
    /className=\{mobileResultActionsClass\}/,
    "mobile result actions should use the dedicated mobile row class"
  );
  assert.match(
    searchResultsSource,
    /const mobileResultActionShortTextClass = "\[font-size:clamp\(0\.6rem,2\.7vw,0\.75rem\)\]!\s+\[line-height:1\]!";/,
    "short mobile result action labels should restore up to 12px"
  );
  assert.match(
    searchResultsSource,
    /const mobileResultActionLongTextClass = "\[font-size:clamp\(0\.6rem,3\.15vw,0\.875rem\)\]!\s+\[line-height:1\]!";/,
    "long mobile result action labels should restore up to 14px"
  );
  assert.match(
    searchResultsSource,
    /\[height:clamp\(1\.75rem,7vw,2rem\)\]!/,
    "mobile result action buttons should restore height when width allows"
  );
  assert.match(
    searchResultsSource,
    /\[padding-inline:clamp\(0\.125rem,1\.55vw,0\.375rem\)\]!/,
    "mobile result action buttons should restore horizontal padding when width allows"
  );
  assert.doesNotMatch(
    searchResultsSource,
    /mobileResultActionsClass = "grid grid-cols-4/,
    "mobile result actions should not stretch each column to one quarter of the row"
  );
  assert.doesNotMatch(
    searchResultsSource,
    /mobileResultActionTextClass/,
    "mobile result actions should not share one font cap across short and long labels"
  );
  assert.doesNotMatch(
    searchResultsSource,
    /mobileResultAction(?:Control|Button)Class = "[^"]*text-\[clamp/,
    "mobile result action text should not use text-[clamp(...)] because it does not generate a font-size rule"
  );
  assert.doesNotMatch(
    searchResultsSource,
    /<div className="flex flex-wrap gap-1\.5 lg:hidden">/,
    "mobile result actions should not wrap into multiple rows"
  );
});

test("search result card rail orders checkbox, favorite, then import", () => {
  const railStart = searchResultsSource.indexOf('<div className="flex w-8 shrink-0 flex-col items-center gap-2 pt-0.5">');
  assert.notEqual(railStart, -1, "search result card should keep a narrow left action rail");
  const railEnd = searchResultsSource.indexOf('<div className="relative size-20', railStart);
  assert.notEqual(railEnd, -1, "search result action rail should end before the cover");
  const railSource = searchResultsSource.slice(railStart, railEnd);

  const checkboxIndex = railSource.indexOf("<Checkbox");
  const favoriteIndex = railSource.indexOf("<StarIcon");
  const importIndex = railSource.indexOf("<ImportIcon");
  assert.ok(checkboxIndex >= 0, "search result action rail should include checkbox first");
  assert.ok(favoriteIndex > checkboxIndex, "favorite action should sit below checkbox");
  assert.ok(importIndex > favoriteIndex, "import action should sit below favorite");
});

test("ongoing and rank cards place favorite below the rank badge", () => {
  assert.match(
    ongoingPanelSource,
    /<div className="flex shrink-0 flex-col items-center gap-2">[\s\S]*?<RankBadge rank=\{rank\} \/>[\s\S]*?<Button[\s\S]*?aria-label=\{isFavorite \? "取消收藏" : "加入收藏"\}/,
    "ongoing favorite action should live below the rank badge"
  );
  assert.doesNotMatch(
    ongoingPanelSource,
    /<div className="flex min-w-0 items-start gap-2">[\s\S]*?<Button[\s\S]*?aria-label=\{isFavorite \? "取消收藏" : "加入收藏"\}/,
    "ongoing title row should not keep the favorite button"
  );
  assert.match(
    ranksPanelSource,
    /<div className="flex shrink-0 flex-col items-center gap-2">[\s\S]*?<RankBadge rank=\{item\.rank\} \/>[\s\S]*?<Button[\s\S]*?aria-label=\{isFavorite \? "取消收藏" : "加入收藏"\}/,
    "rank favorite action should live below the rank badge"
  );
  assert.doesNotMatch(
    ranksPanelSource,
    /<div className="flex gap-3">[\s\S]*?<div className="flex min-w-0 flex-1 flex-col gap-1">[\s\S]*?<\/div>\s*<Button[\s\S]*?aria-label=\{isFavorite \? "取消收藏" : "加入收藏"\}/,
    "rank title/content row should not keep the favorite button on the right"
  );
});

test("Missevan peak rank cards do not expose favorite actions", () => {
  assert.match(
    ranksPanelSource,
    /const canToggleFavorite = !isMissevanPeak && Boolean\(favoriteDramaId\)/,
    "Missevan peak rank cards should not allow favorites because they are aggregate trend entries"
  );
  assert.match(
    ranksPanelSource,
    /if \(!canToggleFavorite\) \{[\s\S]*?return;[\s\S]*?\}/,
    "rank favorite handler should no-op for peak aggregate cards"
  );
  assert.match(
    ranksPanelSource,
    /\{canToggleFavorite \? \([\s\S]*?aria-label=\{isFavorite \? "取消收藏" : "加入收藏"\}[\s\S]*?\) : null\}/,
    "rank favorite button should only render for concrete single-drama rank cards"
  );
});

test("web navigation keeps discovery pages and favorites", () => {
  const platformStart = toolViewSource.indexOf("const webPlatforms = [");
  assert.notEqual(platformStart, -1, "web platform list should exist");
  const platformEnd = toolViewSource.indexOf("];", platformStart);
  assert.notEqual(platformEnd, -1, "web platform list should end before semicolon");
  const platformSource = toolViewSource.slice(platformStart, platformEnd);

  assert.match(toolViewSource, /SearchIcon/);
  assert.match(toolViewSource, /search: SearchIcon/);
  assert.match(toolViewSource, /favorites: StarIcon/);
  assert.match(platformSource, /\{ key: "search", label: "搜索" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "missevan", label: "猫耳" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "manbo", label: "漫播" \}/);
  assert.match(platformSource, /\{ key: "ongoing", label: "更新" \}/);
  assert.match(platformSource, /\{ key: "ranks", label: "榜单" \}/);
  assert.match(platformSource, /\{ key: "favorites", label: "收藏" \}/);
  assert.doesNotMatch(platformSource, /Excel 报表/);
});

test("desktop navigation replaces discovery pages with Excel report entry", () => {
  const platformStart = toolViewSource.indexOf("const desktopPlatforms = [");
  assert.notEqual(platformStart, -1, "desktop platform list should exist");
  const platformEnd = toolViewSource.indexOf("];", platformStart);
  assert.notEqual(platformEnd, -1, "desktop platform list should end before semicolon");
  const platformSource = toolViewSource.slice(platformStart, platformEnd);

  assert.match(toolViewSource, /FileSpreadsheetIcon/);
  assert.match(toolViewSource, /report: FileSpreadsheetIcon/);
  assert.match(toolViewSource, /appConfig\.desktopApp \? desktopPlatforms : webPlatforms/);
  assert.match(platformSource, /\{ key: "search", label: "搜索" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "missevan", label: "猫耳" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "manbo", label: "漫播" \}/);
  assert.match(platformSource, /\{ key: "favorites", label: "收藏" \}/);
  assert.match(platformSource, /\{ key: "report", label: "Excel 报表" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "ongoing", label: "更新" \}/);
  assert.doesNotMatch(platformSource, /\{ key: "ranks", label: "榜单" \}/);
});

test("mobile header actions collapse into a fixed top-right menu", () => {
  assert.match(toolViewSource, /MenuIcon/);
  assert.match(toolViewSource, /const \[mobileMenuOpen, setMobileMenuOpen\] = useState\(false\)/);
  assert.match(toolViewSource, /const mobileMenuNavigationItems = visiblePlatforms/);
  assert.match(toolViewSource, /function closeMobileMenu\(\)/);
  assert.match(toolViewSource, /function openMobileChangelog\(\)/);
  assert.match(toolViewSource, /function openMobileFeatureSuggestion\(\)/);
  assert.match(toolViewSource, /window\.open\(appConfig\.featureSuggestionUrl, "_blank", "noreferrer"\)/);
  assert.match(toolViewSource, /function selectMobileMenuPlatform\(key\)/);
  assert.match(toolViewSource, /window\.addEventListener\("keydown", handleMobileMenuKeyDown\)/);
  assert.match(toolViewSource, /event\.key === "Escape"/);
  assert.match(toolViewSource, /setMobileMenuOpen\(false\)/);

  assert.doesNotMatch(toolViewSource, /className="flex shrink-0 items-center gap-2 sm:hidden"/);
  assert.match(toolViewSource, /className="fixed right-3 top-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\] z-50 sm:hidden"/);
  assert.match(toolViewSource, /aria-expanded=\{mobileMenuOpen\}/);
  assert.match(toolViewSource, /aria-controls="mobile-main-menu"/);
  assert.match(toolViewSource, /aria-label=\{mobileMenuOpen \? "关闭菜单" : "打开菜单"\}/);
  assert.match(toolViewSource, /<MenuIcon aria-hidden="true"/);
  assert.match(toolViewSource, /<div className="fixed inset-0 z-40 bg-transparent sm:hidden" onClick=\{closeMobileMenu\}/);
  assert.match(toolViewSource, /id="mobile-main-menu"/);
  assert.match(toolViewSource, /className="absolute right-0 mt-2 w-\[125px\]/);
  assert.doesNotMatch(toolViewSource, /id="mobile-main-menu"[\s\S]*?w-40/);
  assert.match(toolViewSource, /const mobileMenuItemClassName = "relative w-full justify-start overflow-hidden text-\[0\.82rem\] font-medium text-foreground/);
  assert.match(toolViewSource, /const mobileMenuActiveItemClassName = "bg-\[rgba\(45,72,139,0\.12\)\] text-\[rgb\(32,54,112\)\]/);
  assert.match(toolViewSource, /before:absolute before:inset-y-1\.5 before:left-1 before:w-1 before:rounded-full before:bg-primary/);

  assert.match(toolViewSource, /mobileMenuNavigationItems\.map\(\(platform\) => \(/);
  assert.match(toolViewSource, /selectMobileMenuPlatform\(platform\.key\)/);
  assert.match(toolViewSource, /variant="ghost"[\s\S]*className=\{\`\$\{mobileMenuItemClassName\} \$\{currentPlatform === platform\.key \? mobileMenuActiveItemClassName : ""\}\`\}/);
  assert.match(toolViewSource, /<MainNavigationTabLabel platform=\{platform\} \/>/);
  assert.match(toolViewSource, /openMobileChangelog/);
  assert.match(toolViewSource, /更新日志/);
  assert.match(toolViewSource, /appConfig\.featureSuggestionUrl \? \(/);
  assert.match(toolViewSource, /<Button type="button" variant="ghost" size="sm" className=\{mobileMenuItemClassName\} onClick=\{openMobileFeatureSuggestion\}>/);
  assert.doesNotMatch(toolViewSource, /<Button variant="ghost" size="sm" className=\{mobileMenuItemClassName\} asChild>/);
  assert.match(toolViewSource, /<span className="inline-flex min-w-0 items-center justify-center gap-1\.5">[\s\S]*<MessageSquarePlusIcon aria-hidden="true" className="size-3\.5 shrink-0" \/>[\s\S]*<span className="min-w-0 truncate">功能建议<\/span>/);
  assert.match(toolViewSource, /功能建议/);
});

test("landing node footer actions use compact mobile sizing", () => {
  assert.match(landingViewSource, /const landingFooterActionButtonClassName = "h-9 w-\[90px\] justify-center px-1\.5 text-xs sm:h-10 sm:w-auto sm:min-w-fit sm:px-4 sm:text-sm"/);
  assert.match(landingViewSource, /<Button variant="outline" className=\{landingFooterActionButtonClassName\} asChild>/);
  assert.match(landingViewSource, /<ChangelogButton className=\{landingFooterActionButtonClassName\} size="default" onClick=\{openChangelog\} \/>/);
  assert.match(landingViewSource, /<Button variant="outline" className=\{landingFooterActionButtonClassName\} disabled=\{loading\} onClick=\{refreshAllRegions\}>/);
  assert.doesNotMatch(landingViewSource, /className="h-10 min-w-fit px-3 sm:px-4"/);
});

test("desktop header actions and navigation remain visible from sm upward", () => {
  assert.match(toolViewSource, /<Tabs value=\{currentPlatform\} onValueChange=\{setCurrentPlatform\} className="hidden sm:block">/);
  assert.match(toolViewSource, /className="h-9 w-fit overflow-hidden p-0\.5"/);
  assert.match(toolViewSource, /className="hidden sm:inline-flex"/);
  assert.match(toolViewSource, /<Button variant="outline" size="default" className="hidden sm:inline-flex" style=\{headerActionButtonStyle\} asChild>/);
  assert.match(toolViewSource, /<a href=\{appConfig\.featureSuggestionUrl\} rel="noreferrer" target="_blank">/);
  assert.match(toolViewSource, /<ChangelogButton className="hidden sm:inline-flex"/);
});

test("search page owns compact platform result tabs", () => {
  assert.match(toolViewSource, /const searchPlatforms = \[/);
  assert.match(toolViewSource, /\{ key: "missevan", label: "猫耳" \}/);
  assert.match(toolViewSource, /\{ key: "manbo", label: "漫播" \}/);
  assert.match(toolViewSource, /activeSearchPlatform/);
  assert.match(toolViewSource, /setActiveSearchPlatform/);
  assert.match(toolViewSource, /searchResultSummaryText/);
  assert.match(toolViewSource, /猫耳 \$\{missevanResultCount\}/);
  assert.match(toolViewSource, /漫播 \$\{manboResultCount\}/);

  const searchPageStart = toolViewSource.indexOf('currentPlatform !== "report" ? (');
  const searchResultsStart = toolViewSource.indexOf("<SearchResults", searchPageStart);
  assert.notEqual(searchResultsStart, -1, "SearchResults should render in the search page");
  const searchResultsEnd = toolViewSource.indexOf("/>", searchResultsStart);
  const beforeSearchResults = toolViewSource.slice(searchPageStart, searchResultsStart);
  const searchResultsProps = toolViewSource.slice(searchResultsStart, searchResultsEnd);
  assert.doesNotMatch(beforeSearchResults, /<Tabs value=\{activeBrowsePlatform\}/, "platform tabs should not render as a standalone ToolView row");
  assert.match(searchResultsProps, /platformTabs=\{visibleSearchPlatforms\}/);
  assert.match(searchResultsProps, /activePlatform=\{activeBrowsePlatform\}/);
  assert.match(searchResultsProps, /onPlatformChange=\{setActiveSearchPlatform\}/);
  assert.match(searchResultsProps, /platformResultCounts=\{\{\s*missevan: missevanResultCount,\s*manbo: manboResultCount,\s*\}\}/);
});

test("frontend unified keyword search uses backend aggregate route", () => {
  assert.match(searchPanelSource, /classifyUnifiedSearchInput/);
  assert.match(searchPanelSource, /queryUnifiedKeywordSearch/);
  assert.match(searchPanelSource, /function buildUnifiedSearchPath/);
  assert.match(searchPanelSource, /\/unified-search\?keyword=\$\{encodeURIComponent\(keyword\)\}&offset=0&limit=5/);
  assert.match(searchPanelSource, /queryBackendUnifiedSearch\(keyword\)/);
  assert.match(searchPanelSource, /onUpdatePlatformResults\?\.\("missevan"/);
  assert.match(searchPanelSource, /onUpdatePlatformResults\?\.\("manbo"/);

  const unifiedStart = searchPanelSource.indexOf("async function queryUnifiedKeywordSearch");
  assert.notEqual(unifiedStart, -1, "unified keyword search function should exist");
  const unifiedEnd = searchPanelSource.indexOf("async function queryNumericLibraryLookup", unifiedStart);
  assert.notEqual(unifiedEnd, -1, "unified keyword search should end before numeric lookup");
  const unifiedSource = searchPanelSource.slice(unifiedStart, unifiedEnd);
  assert.doesNotMatch(unifiedSource, /queryPlatformKeywordSearch/);
  assert.doesNotMatch(unifiedSource, /apiFallback: false/);
  assert.doesNotMatch(unifiedSource, /apiFallback: true/);
});

test("backend unified search route aggregates libraries before API fallback", () => {
  const routeStart = serverSource.indexOf('app.get("/unified-search"');
  assert.notEqual(routeStart, -1, "unified search route should exist");
  const routeEnd = serverSource.indexOf('app.get("/search"', routeStart);
  assert.notEqual(routeEnd, -1, "unified search route should sit before the legacy Missevan search route");
  const routeSource = serverSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /Promise\.all\(\[\s*ensureInfoStoreLoaded\(missevanInfoStore\),\s*ensureInfoStoreLoaded\(manboInfoStore\),\s*\]\)/);
  assert.equal(routeSource.match(/refreshMissevanCooldownState/g)?.length ?? 0, 1);
  assert.match(routeSource, /runMissevanLibraryUnifiedSearch/);
  assert.match(routeSource, /runManboLibraryUnifiedSearch/);
  assert.match(routeSource, /const shouldUseApiFallback[\s\S]*missevanLibraryResult\.meta\.matchedCount[\s\S]*manboLibraryResult\.meta\.matchedCount/);
  assert.match(routeSource, /Promise\.allSettled\(\[\s*runMissevanLibraryUnifiedSearch\(normalizedKeyword, offset, limit\),\s*runManboLibraryUnifiedSearch\(normalizedKeyword, offset, limit\),\s*\]\)/);
  assert.match(routeSource, /Promise\.allSettled\(\[\s*runMissevanApiUnifiedSearch\(normalizedKeyword, offset, limit\),\s*runManboApiUnifiedSearch\(normalizedKeyword, offset, limit\),\s*\]\)/);
  assert.match(serverSource, /async function runManboApiUnifiedSearch\(keyword, offset, limit\)[\s\S]*const pagedResults = apiResults\.slice\(offset, offset \+ limit\)[\s\S]*results: pagedResults[\s\S]*buildSearchPageMeta\(keyword, apiResults\.length, offset, limit\)/);
  assert.match(routeSource, /normalizeSettledUnifiedSearchResult\("missevan"/);
  assert.match(routeSource, /normalizeSettledUnifiedSearchResult\("manbo"/);
  assert.match(routeSource, /results:\s*\{\s*missevan:[\s\S]*manbo:/);
  assert.match(routeSource, /usedApiFallback/);
});

test("unified search panels are unframed", () => {
  assert.doesNotMatch(searchPanelSource, /CardContent/);
  assert.doesNotMatch(searchPanelSource, /<Card/);
  assert.match(searchPanelSource, /return \(\s*<div className="flex flex-col gap-3"/);
  assert.match(searchResultsSource, /TabsList className="h-auto justify-start gap-1 bg-transparent p-0 border-0!"/);
});

test("search result platform tabs live in the result card header with counts", () => {
  assert.match(searchResultsSource, /platformTabs = \[\]/);
  assert.match(searchResultsSource, /activePlatform = platform/);
  assert.match(searchResultsSource, /platformResultCounts = \{\}/);
  assert.match(searchResultsSource, /onPlatformChange/);
  assert.match(searchResultsSource, /function getPlatformResultCountText\(nextPlatform\)/);
  assert.match(searchResultsSource, /<Card[\s\S]*className="[^"]*pt-2\.5[\s\S]*pb-4/);
  assert.match(searchResultsSource, /<CardContent className="pt-0">/);
  assert.match(searchResultsSource, /<Tabs value=\{activePlatform\} onValueChange=\{onPlatformChange\}/);
  assert.match(searchResultsSource, /PlatformTabLabel platform=\{item\.key\} iconClassName="size-3\.5"/);
  assert.match(searchResultsSource, /getPlatformResultCountText\(item\.key\)/);
  assert.match(searchResultsSource, /border-b border-border\/75 pb-1\.5/);
  const platformTabsStart = searchResultsSource.indexOf("<Tabs value={activePlatform}");
  const platformTabsEnd = searchResultsSource.indexOf("</Tabs>", platformTabsStart);
  assert.notEqual(platformTabsStart, -1, "platform tabs should render inside SearchResults");
  assert.notEqual(platformTabsEnd, -1, "platform tabs should close inside SearchResults");
  const platformTabsSource = searchResultsSource.slice(platformTabsStart, platformTabsEnd);
  assert.match(platformTabsSource, /rounded-md/);
  assert.match(platformTabsSource, /hover:bg-muted\/55/);
  assert.doesNotMatch(platformTabsSource, /rounded-none/);
});

test("search input area uses compact mobile controls", () => {
  assert.match(searchPanelSource, /grid-cols-\[minmax\(0,1fr\)_4\.5rem\]/);
  assert.match(searchPanelSource, /h-\[4\.375rem\] min-h-\[4\.375rem\] max-h-\[4\.375rem\]/);
  assert.match(searchPanelSource, /bg-white dark:bg-background/);
  assert.match(searchPanelSource, /text-sm!/);
  assert.match(searchPanelSource, /className="h-8 gap-1 px-2 text-sm!/);
});

test("mobile batch action menu uses compact buttons", () => {
  assert.match(searchResultsSource, /const mobileActionButtonClass = `h-8 min-w-fit gap-1 px-2 \$\{mobileBatchTextClass\}`/);
  assert.match(searchResultsSource, /const mobileBatchTextClass = "text-xs! font-medium"/);
  assert.match(searchResultsSource, /function ActionPanel\(\{ variant = "desktop" \}\)/);
});

test("ongoing titles keep content type badges visible while truncating long names", () => {
  const titleButtonStart = ongoingPanelSource.search(/<button\s+type="button"[\s\S]*?onClick=\{openSearchResult\}/);
  assert.notEqual(titleButtonStart, -1, "title button markup should exist");
  const titleButtonEnd = ongoingPanelSource.indexOf("</button>", titleButtonStart);
  assert.notEqual(titleButtonEnd, -1, "title button should have a closing tag");
  const titleButtonMarkup = ongoingPanelSource.slice(titleButtonStart, titleButtonEnd);

  assert.doesNotMatch(ongoingPanelSource, /text-lg! font-semibold! leading-6!/);
  assert.match(ongoingPanelSource, /text-base! font-semibold! leading-5!/);
  assert.doesNotMatch(ongoingPanelSource, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(titleButtonMarkup, /line-clamp-2/);
  assert.match(titleButtonMarkup, /className="break-words rounded-sm[\s\S]*underline underline-offset-4/);
  assert.doesNotMatch(ongoingPanelSource, /ongoingTitleUnderlineClassName/);
  assert.doesNotMatch(ongoingPanelSource, /\[background-size:100%_2px\]/);
  assert.doesNotMatch(ongoingPanelSource, /\[box-decoration-break:clone\]/);
  assert.match(ongoingPanelSource, /getInlineTaggedTitleDisplayText/);
  assert.match(ranksPanelSource, /getInlineTaggedTitleDisplayText/);
  assert.match(appUtilsSource, /export function getInlineTaggedTitleDisplayText/);
  assert.match(ongoingPanelSource, /titleTags\.map/);
  assert.match(ongoingPanelSource, /ml-1 inline-flex/);
  assert.match(ongoingPanelSource, /shrink-0/);
});

test("title display truncation does not replace original search payload names", () => {
  assert.match(ongoingPanelSource, /name: item\.name/);
  assert.doesNotMatch(ongoingPanelSource, /name: displayTitle/);
  assert.match(ranksPanelSource, /name: item\.name/);
  assert.doesNotMatch(ranksPanelSource, /name: displayTitle/);
});

test("ongoing mobile filter tabs use compact touch-aligned sizing", () => {
  assert.match(ongoingPanelSource, /const mobileOngoingPlatformTabClassName = "h-7 min-w-0 px-1\.5 text-sm!"/);
  assert.match(ongoingPanelSource, /const mobileOngoingWindowTabClassName = "h-7 min-w-0 px-1 text-\[12px\]! leading-none"/);
  assert.doesNotMatch(ongoingPanelSource, /mobileOngoingPlatformTabClassName = "[^"]*-mt-0\.5/);
  assert.doesNotMatch(ongoingPanelSource, /mobileOngoingPlatformTabClassName = "[^"]*mb-0\.5/);
  assert.doesNotMatch(ongoingPanelSource, /mobileOngoingWindowTabClassName = "[^"]*-mt-0\.5/);
  assert.doesNotMatch(ongoingPanelSource, /mobileOngoingWindowTabClassName = "[^"]*mb-0\.5/);
  assert.match(ongoingPanelSource, /className="flex h-\[2\.375rem\] items-center gap-1\.5 px-1\.5"/);
  assert.match(ongoingPanelSource, /className=\{mobileOngoingPlatformTabClassName\}/);
  assert.match(ongoingPanelSource, /className=\{mobileOngoingWindowTabClassName\}/);
});

test("batch action counters remain scoped to the active result platform", () => {
  assert.match(searchResultsSource, /const actionResults = allResults\.length \? allResults : results/);
  assert.match(searchResultsSource, /const selectedDramaCount = actionResults\.filter/);
  assert.match(searchResultsSource, /const importedDramaCount = dramas\.length/);
  assert.match(searchResultsSource, /const selectedEpisodeCount = selectedEpisodes\.length/);

  const searchResultsStart = toolViewSource.indexOf("<SearchResults");
  const outputPanelStart = toolViewSource.indexOf("<OutputPanel");
  const searchResultsProps = toolViewSource.slice(searchResultsStart, outputPanelStart);
  assert.match(searchResultsProps, /dramas=\{currentBrowseState\?\.dramas \|\| \[\]\}/);
  assert.match(searchResultsProps, /allResults=\{getAllSearchResults\(currentBrowseState\)\}/);
  assert.match(searchResultsProps, /selectedEpisodes=\{currentBrowseState\?\.selectedEpisodesSnapshot \|\| \[\]\}/);
  assert.match(searchResultsProps, /platform=\{activeBrowsePlatform\}/);
});

test("search metric legend is persistent above search panel", () => {
  assert.match(searchResultsSource, /export function MetricLegend/);
  assert.match(toolViewSource, /import \{ SearchResults, MetricLegend \} from "@\/app\/SearchResults";/);

  const searchPageStart = toolViewSource.indexOf('currentPlatform !== "report" ? (');
  assert.notEqual(searchPageStart, -1, "search page branch should exist");
  const searchPanelIndex = toolViewSource.indexOf("<SearchPanel", searchPageStart);
  assert.notEqual(searchPanelIndex, -1, "search panel should render in search page branch");
  const legendIndex = toolViewSource.indexOf("<MetricLegend", searchPageStart);
  assert.notEqual(legendIndex, -1, "metric legend should render in search page branch");
  assert.ok(legendIndex < searchPanelIndex, "metric legend should render above the search panel");

  assert.doesNotMatch(searchResultsSource, /results\.length \? <MetricLegend className="lg:hidden"/);
  const asideStart = searchResultsSource.indexOf("<aside");
  const asideEnd = searchResultsSource.indexOf("</aside>", asideStart);
  assert.notEqual(asideStart, -1, "search results desktop aside should still exist");
  assert.notEqual(asideEnd, -1, "search results desktop aside should close");
  const asideSource = searchResultsSource.slice(asideStart, asideEnd);
  assert.doesNotMatch(asideSource, /<MetricLegend/);
});

test("external drama title jump clears both search result panes before injecting target import", () => {
  const openStart = toolViewSource.indexOf("async function openDramaInSearch");
  assert.notEqual(openStart, -1, "openDramaInSearch should exist");
  const openEnd = toolViewSource.indexOf("async function loadSearchPage", openStart);
  assert.notEqual(openEnd, -1, "openDramaInSearch should end before loadSearchPage");
  const openSource = toolViewSource.slice(openStart, openEnd);

  assert.match(toolViewSource, /onOpenSearchResult=\{openDramaInSearch\}/);
  assert.match(openSource, /resetSearchFlow\("missevan"\);[\s\S]*resetSearchFlow\("manbo"\);/);
  assert.ok(
    openSource.indexOf('resetSearchFlow("missevan");') < openSource.indexOf("setManualSearchResults(targetPlatform"),
    "both search panes should clear before target manual results are set"
  );
  assert.match(openSource, /updateSharedSearchForm\(\{[\s\S]*keyword: String\(name \?\? ""\)\.trim\(\),[\s\S]*manualInput,/);
  assert.match(openSource, /setManualSearchResults\(targetPlatform, results, \{ limit: dramaIds\.length, scroll: false \}\)/);
  assert.match(openSource, /openSearchPlatform\(targetPlatform\)/);
  assert.doesNotMatch(toolViewSource, /openDramaResultDialog/);
  assert.doesNotMatch(toolViewSource, /resultDialog/);
});

test("addDramas imports missing dramas with one batch request for the active platform", () => {
  const addStart = toolViewSource.indexOf("async function addDramas");
  assert.notEqual(addStart, -1, "addDramas should exist");
  const addEnd = toolViewSource.indexOf("async function loadMoreSearchResults", addStart);
  assert.notEqual(addEnd, -1, "addDramas should end before loadMoreSearchResults");
  const addSource = toolViewSource.slice(addStart, addEnd);

  assert.match(addSource, /const missingIds = ids[\s\S]*filter\(\(id\) => !existingDramaMap\.has\(String\(id\)\)\)/);
  assert.match(addSource, /const batchResult = await fetchDramasByIds\(platform, missingIds\)/);
  assert.doesNotMatch(addSource, /for \(let index = 0; index < ids\.length; index \+= 1\)[\s\S]*await fetchDramaById\(platform, id\)/);
  assert.match(toolViewSource, /async function fetchDramasByIds\(platform, dramaIds, signal, options = \{\}\)/);
  assert.match(toolViewSource, /postJson\(getDramasEndpoint\(platform\), payload, signal, "Failed to load dramas"\)/);
});

test("SearchResults keeps only page layout after dialog rollback", () => {
  assert.doesNotMatch(searchResultsSource, /variant = "page"/);
  assert.doesNotMatch(searchResultsSource, /isDialogVariant/);
  assert.match(searchResultsSource, /<div className="grid gap-4 lg:grid-cols-\[minmax\(0,1fr\)_11rem\] lg:items-start">/);
  assert.match(searchResultsSource, /results\.length \? \(/);
  assert.match(searchResultsSource, /className="fixed inset-x-3 bottom-3 z-40 lg:hidden"/);
});

test("platform id icon is globally reusable", () => {
  assert.match(platformTabLabelSource, /export function PlatformIdIcon/);
  assert.match(platformTabLabelSource, /platformTabMeta\[key\]/);
  assert.match(platformTabLabelSource, /aria-label=\{label \|\| `\$\{meta\?\.label \|\| "平台"\} ID`\}/);
});

test("work id rows use platform icons instead of HashIcon", () => {
  assert.match(searchResultsSource, /PlatformIdIcon platform=\{platform\} aria-label=\{idLabel\}/);
  assert.match(ongoingPanelSource, /PlatformIdIcon platform=\{platform\} aria-label="作品ID"/);
  assert.match(ranksPanelSource, /PlatformIdIcon[\s\S]*platform=\{platform\}[\s\S]*aria-label=\{isMissevanPeak \? "包含作品ID" : "作品ID"\}/);
  assert.match(ranksPanelSource, /PlatformIdIcon platform=\{platform\} aria-label="作品ID"/);
  assert.match(rankTrendUiSource, /PlatformIdIcon platform=\{platform\} aria-label="作品ID"/);

  const searchWorkIdLine = searchResultsSource.slice(searchResultsSource.indexOf("aria-label={idLabel}") - 140, searchResultsSource.indexOf("aria-label={idLabel}") + 180);
  assert.doesNotMatch(searchWorkIdLine, /HashIcon/);
  const ongoingWorkIdLine = ongoingPanelSource.slice(ongoingPanelSource.indexOf('aria-label="作品ID"') - 140, ongoingPanelSource.indexOf('aria-label="作品ID"') + 180);
  assert.doesNotMatch(ongoingWorkIdLine, /HashIcon/);
  const ranksWorkIdLine = ranksPanelSource.slice(ranksPanelSource.indexOf("包含作品ID") - 180, ranksPanelSource.indexOf("包含作品ID") + 220);
  assert.doesNotMatch(ranksWorkIdLine, /HashIcon/);
  assert.match(rankTrendUiSource, /\#\{rank\.position\}/, "rank position text should keep hash semantics");
});

test("search empty state uses concise shared copy", () => {
  assert.match(searchResultsSource, /<div className="text-base font-semibold">还没有结果<\/div>/);
  assert.doesNotMatch(searchResultsSource, /还没有导入结果/);
  assert.doesNotMatch(searchResultsSource, /先搜索关键词/);
  assert.doesNotMatch(searchResultsSource, /继续粘贴作品ID/);
});

test("search form is shared while tabs only switch result panes", () => {
  assert.match(toolViewSource, /const \[sharedSearchForm, setSharedSearchForm\] = useState\(\{\s*keyword: "",\s*manualInput: "",\s*\}\)/);
  assert.match(toolViewSource, /function updateSharedSearchForm\(patch\)/);
  assert.match(toolViewSource, /formState=\{sharedSearchForm\}/);
  assert.match(toolViewSource, /onUpdateFormState=\{updateSharedSearchForm\}/);
  assert.doesNotMatch(toolViewSource, /formState=\{currentBrowseState\?\.searchForm\}/);
  assert.doesNotMatch(toolViewSource, /onUpdatePlatformFormState=\{updateSearchFormForPlatform\}/);

  const searchResultsStart = toolViewSource.indexOf("<SearchResults");
  const outputPanelStart = toolViewSource.indexOf("<OutputPanel");
  assert.notEqual(searchResultsStart, -1, "SearchResults should render");
  assert.notEqual(outputPanelStart, -1, "OutputPanel should render");
  const searchResultsProps = toolViewSource.slice(searchResultsStart, outputPanelStart);
  assert.match(searchResultsProps, /results=\{currentBrowseState\?\.searchResults \|\| \[\]\}/);
  assert.match(searchResultsProps, /platform=\{activeBrowsePlatform\}/);
});

test("output stats and history are shared across platform tab switching", () => {
  assert.match(toolViewSource, /const \[sharedOutputPlatform, setSharedOutputPlatform\] = useState/);
  assert.match(toolViewSource, /const sharedOutputState = platformStates\[sharedOutputPlatform\]/);
  assert.match(toolViewSource, /const sharedStatsState = sharedOutputState\?\.stats \|\| null/);
  assert.match(toolViewSource, /const sharedHistoryEntries = getMergedHistoryEntries\(\)/);
  assert.match(toolViewSource, /function getMergedHistoryEntries\(\)/);
  assert.match(toolViewSource, /platformLabel: \(entry\.platform \|\| platform\) === "manbo" \? "漫播" : "猫耳"/);
  assert.match(toolViewSource, /setSharedOutputPlatform\(platform\)/);

  const outputStart = toolViewSource.indexOf("<OutputPanel");
  assert.notEqual(outputStart, -1, "OutputPanel should render");
  const outputEnd = toolViewSource.indexOf("/>", outputStart);
  assert.notEqual(outputEnd, -1, "OutputPanel props should end");
  const outputProps = toolViewSource.slice(outputStart, outputEnd);
  assert.match(outputProps, /historyEntries=\{sharedHistoryEntries\}/);
  assert.match(outputProps, /platform=\{sharedOutputPlatform\}/);
  assert.match(outputProps, /currentAction=\{sharedStatsState\?\.currentAction\}/);
  assert.doesNotMatch(outputProps, /currentBrowseState\?\.historyEntries/);
  assert.doesNotMatch(outputProps, /currentStatsState/);
  assert.match(outputProps, /onClearHistory=\{clearAllHistoryEntries\}/);
  assert.match(outputProps, /onDeleteHistoryEntry=\{\(entry\) => deleteHistoryEntry\(entry\.platform, entry\.id\)\}/);
});

test("history timestamps include platform label", () => {
  assert.match(outputPanelSource, /function getHistoryPlatformLabel\(entry\)/);
  assert.match(outputPanelSource, /entry\.createdAtLabel\}\s*\{getHistoryPlatformLabel\(entry\)/);
  assert.match(outputPanelSource, /onDeleteHistoryEntry\?\.\(entry\)/);
  assert.match(outputPanelSource, /aria-label=\{`删除 \$\{entry\.createdAtLabel\} \$\{getHistoryPlatformLabel\(entry\)\} 这条历史`\}/);
});

test("header description is replaced by Missevan access hint with existing links", () => {
  assert.doesNotMatch(toolViewSource, /\{appConfig\.description\}/);
  assert.match(toolViewSource, /renderHeaderAccessHint/);
  assert.match(toolViewSource, /如果猫耳接口暂时受限，请/);
  assert.match(toolViewSource, /href="\/nodes"[\s\S]*节点页/);
  assert.match(toolViewSource, /href=\{appConfig\.desktopAppUrl\}[\s\S]*桌面版/);
});

test("desktop favorites skip info-store CV backfill", () => {
  assert.match(toolViewSource, /isDesktopApp=\{appConfig\.desktopApp\}/);
  assert.match(favoritesPanelSource, /isDesktopApp = false/);
  assert.match(favoritesPanelSource, /if \(isDesktopApp\) \{[\s\S]*?return undefined;[\s\S]*?\}/);
});

test("desktop favorites JSON endpoints are desktop-only and use exe directory", () => {
  assert.match(serverSource, /DESKTOP_FAVORITES_FILE_NAME = "mm-toolkit-favorites\.json"/);
  assert.match(serverSource, /function getDesktopFavoritesFilePath/);
  assert.match(serverSource, /DESKTOP_EXE_DIR/);
  assert.match(serverSource, /app\.get\("\/desktop\/favorites-data"/);
  assert.match(serverSource, /app\.put\("\/desktop\/favorites-data"/);
  assert.match(serverSource, /if \(!DESKTOP_APP\)/);
});

test("favorites panel documents local storage risk and backup actions", () => {
  assert.match(favoritesPanelSource, /收藏数据保存在当前浏览器，清除浏览器数据后可能丢失/);
  assert.match(favoritesPanelSource, /导出数据/);
  assert.match(favoritesPanelSource, /导入数据/);
  assert.match(favoritesPanelSource, /选中/);
  assert.match(favoritesPanelSource, /全部/);
  assert.match(favoritesPanelSource, /<AlertDescription className="!\[text-wrap:wrap\] md:!\[text-wrap:wrap\]">/);
  assert.doesNotMatch(favoritesPanelSource, /<span>全选<\/span>/);
  assert.doesNotMatch(favoritesPanelSource, /关注增量：/);
  assert.match(favoritesPanelSource, /排序/);
});

test("favorites panel backfills missing main CV text from the info store", () => {
  const backfillStart = favoritesPanelSource.indexOf("async function backfillMissingMainCvText");
  assert.notEqual(backfillStart, -1, "favorite main CV backfill function should exist");
  const backfillEnd = favoritesPanelSource.indexOf("\n    void backfillMissingMainCvText", backfillStart);
  const backfillSource = favoritesPanelSource.slice(backfillStart, backfillEnd === -1 ? undefined : backfillEnd);

  assert.match(favoritesPanelSource, /backfilledCvKeysRef/);
  assert.match(favoritesPanelSource, /fetchFavoriteMainCvText\(favorite, frontendVersion, handleVersionResponse\)/);
  assert.match(favoritesPanelSource, /mainCvText/);
  assert.match(favoritesPanelSource, /updateFavoriteIfExists/, "main CV backfill should use conditional storage updates");
  assert.match(
    favoritesStorageSource,
    /export async function updateFavoriteIfExists/,
    "favorites storage should expose an atomic conditional update helper"
  );
  assert.match(
    backfillSource,
    /const updatedFavorite = await updateFavoriteIfExists\(favorite\.key,\s*\(activeFavorite\) => \(\{/,
    "main CV backfill should read and write in one conditional transaction"
  );
  assert.match(
    backfillSource,
    /if \(updatedFavorite\) \{[\s\S]*?changed = true;[\s\S]*?\}/,
    "main CV backfill should skip writes after cancellation removes the favorite"
  );
  assert.match(
    backfillSource,
    /\.\.\.activeFavorite[\s\S]*mainCvText[\s\S]*updatedAt: Date\.now\(\)/,
    "main CV backfill should merge into the latest stored favorite instead of a stale queue item"
  );
  assert.match(favoritesPanelSource, /onFavoritesChange\?\.\(\)/);
  assert.doesNotMatch(favoritesPanelSource, /backfilledUpdateKeysRef/);
  assert.doesNotMatch(favoritesPanelSource, /更新时间：/);
  assert.match(favoritesPanelSource, /MicIcon/);
  assert.match(favoritesPanelSource, /aria-label="主役CV"/);
  assert.match(favoritesPanelSource, /formatFavoriteMainCvText\(favorite\.mainCvText\)/);
  assert.match(serverSource, /app\.get\("\/favorites\/meta"/);
  assert.match(serverSource, /buildFavoriteMetaFromInfoStore/);
});

test("favorite payloads preserve main CV text from current cards", () => {
  assert.match(favoritesStorageSource, /mainCvText: normalizeString/);
  assert.match(searchResultsSource, /mainCvText: item\?\.main_cv_text/);
  assert.match(ongoingPanelSource, /mainCvText: item\.main_cv_text \|\| ""/);
  assert.match(ranksPanelSource, /mainCvText: item\.main_cv_text \|\| ""/);
  assert.match(toolViewSource, /mainCvText: item\?\.mainCvText \|\| item\?\.main_cv_text \|\| ""/);
});

test("favorite refresh backfills sparse main CV lists from info store once", () => {
  const refreshStart = favoritesPanelSource.indexOf("async function refreshFavoriteSnapshot");
  assert.notEqual(refreshStart, -1, "favorite refresh function should exist");
  const refreshEnd = favoritesPanelSource.indexOf("\nexport function FavoritesPanel", refreshStart);
  const refreshSource = favoritesPanelSource.slice(refreshStart, refreshEnd === -1 ? undefined : refreshEnd);

  assert.match(favoritesPanelSource, /function countFavoriteMainCvNames/, "favorite panel should count saved main CV names");
  assert.match(refreshSource, /countFavoriteMainCvNames\(favorite\.mainCvText\) <= 2/);
  assert.match(refreshSource, /fetchFavoriteMainCvText\(favorite, frontendVersion, handleVersionResponse\)/);
  assert.match(refreshSource, /refreshedMainCvText/);
  assert.match(refreshSource, /mainCvText: refreshedMainCvText \|\| activeFavorite\.mainCvText \|\| ""/);
});

test("favorites panel keeps actions left and filters right with mobile two-row controls", () => {
  assert.match(favoritesPanelSource, /grid-cols-4/, "favorite actions should be a four-button row on mobile");
  assert.match(favoritesPanelSource, /lg:grid-cols-\[minmax\(0,1fr\)_auto\]/, "desktop controls should split actions and menus");
  assert.match(favoritesPanelSource, /lg:justify-end/, "desktop filter menus should align right");
  assert.match(favoritesPanelSource, /TrendingUpIcon/, "metric menu should use an increment icon");
  assert.match(favoritesPanelSource, /subscriptionCount: HeartIcon/, "follow/favorite metric should keep its heart icon");
  assert.match(favoritesPanelSource, /ArrowDownUpIcon/, "sort menu should use a sort icon");
});

test("favorites payment badge sits on the cover instead of after the title", () => {
  assert.match(favoritesPanelSource, /const favoriteCoverPaymentBadgeClassName =/);
  assert.match(favoritesPanelSource, /absolute bottom-0 right-0/, "favorite payment badge should match the search-result cover corner pattern");
  assert.match(favoritesPanelSource, /const paymentTag = favorite\.paymentLabel/);
  assert.match(favoritesPanelSource, /const titleTags = \[platformLabel, favorite\.contentTypeLabel\]\.filter\(Boolean\)/);
  assert.doesNotMatch(
    favoritesPanelSource,
    /const tags = \[platformLabel, favorite\.paymentLabel, favorite\.contentTypeLabel\]/,
    "payment status should not remain in the title badge list"
  );
  assert.match(favoritesPanelSource, /\{paymentTag \? \([\s\S]*?favoriteCoverPaymentBadgeClassName[\s\S]*?\{paymentTag\}/);
  assert.match(favoritesPanelSource, /titleTags\.map/);
});

test("favorites snapshot details use text headers and a trend-style disclosure row", () => {
  const sortStart = favoritesStorageSource.indexOf("function getSortMetricValue");
  assert.notEqual(sortStart, -1, "favorite sort helper should exist");
  const sortEnd = favoritesStorageSource.indexOf("\n}", favoritesStorageSource.indexOf("return normalizeOptionalNumber", sortStart));
  const sortSource = favoritesStorageSource.slice(sortStart, sortEnd === -1 ? undefined : sortEnd);

  assert.match(favoritesStorageSource, /label: "最近刷新"/, "favorite refresh sort copy should avoid update-time ambiguity");
  assert.doesNotMatch(favoritesStorageSource, /label: "最近更新"/);
  assert.doesNotMatch(
    sortSource,
    /sortBy === "lastSnapshotAt"[\s\S]*favorite\.updatedAt/,
    "recent refresh sorting should not fall back to favorite update time"
  );
  assert.doesNotMatch(
    sortSource,
    /sortBy === "lastSnapshotAt"[\s\S]*favorite\.createdAt/,
    "recent refresh sorting should not fall back to favorite creation time"
  );
  assert.doesNotMatch(favoritesPanelSource, /function MetricHeaderIcon/, "snapshot headers should not use unclear icon-only labels");
  assert.match(favoritesPanelSource, /function MetricHeaderLabel/, "snapshot headers should render readable text labels");
  assert.match(favoritesPanelSource, /function SnapshotDetailsDisclosure/);
  assert.match(favoritesPanelSource, />数据明细</);
  assert.match(favoritesPanelSource, /label: "追剧人数"[\s\S]*subLabel: "收藏人数"/);
  assert.match(favoritesPanelSource, /label: "打赏人数"[\s\S]*subLabel: "付费\/收听人数"/);
  assert.match(favoritesPanelSource, /label: "打赏榜总和"[\s\S]*subLabel: "总投喂"/);
  assert.doesNotMatch(favoritesPanelSource, /label: "总打赏"/);
  assert.doesNotMatch(favoritesPanelSource, /rewardTotal: "总打赏"/);
  assert.doesNotMatch(favoritesPanelSource, /label: "打赏榜总和（元）"/);
  assert.doesNotMatch(favoritesPanelSource, /subLabel: "总投喂（元）"/);
  assert.match(favoritesPanelSource, /label: "付费ID"/);
  assert.match(favoritesPanelSource, /label: `\+\$\{getDeltaMetricLabel\(deltaMetric\)\}`/);
  assert.doesNotMatch(favoritesPanelSource, /text-\[0\.62rem\][\s\S]*subLabel/, "second header line should keep the same font size");
  assert.match(favoritesPanelSource, /headerClassName: "text-secondary"/, "delta header should use the same orange accent as delta values");
});

test("favorites snapshot details show every column with internal horizontal scrolling", () => {
  assert.match(favoritesPanelSource, /const SNAPSHOT_HISTORY_TABLE_MIN_WIDTH =/);
  assert.match(favoritesPanelSource, /function getHistoryMetricColumns\(platform, deltaMetric\)/);
  assert.match(
    favoritesPanelSource,
    /key: "time"[\s\S]*key: "viewCount"[\s\S]*key: "subscriptionCount"[\s\S]*key: platform === "missevan" \? "rewardCount" : "paidOrListenCount"[\s\S]*key: platform === "missevan" \? "rewardTotal" : "giftTotal"[\s\S]*key: "paidIdCount"[\s\S]*type: "delta"/,
    "history columns should keep the requested visible order"
  );
  assert.match(favoritesPanelSource, /const columns = getHistoryMetricColumns\(favorite\.platform, deltaMetric\)/);
  assert.match(favoritesPanelSource, /overflow-x-auto/, "snapshot details should scroll internally on narrow viewports");
  assert.match(favoritesPanelSource, /columnClassName: "w-\[8\.75rem\] whitespace-nowrap"/, "snapshot time column should stay on one line when there is room");
  assert.match(favoritesPanelSource, /\$\{column\.columnClassName \|\| ""\}/, "snapshot header and cells should apply per-column sizing classes");
  assert.match(favoritesPanelSource, /<table/);
  assert.doesNotMatch(favoritesPanelSource, /headerClassName: "hidden/);
  assert.doesNotMatch(favoritesPanelSource, /cellClassName: "hidden/);
});

test("favorites money metrics display as yuan without mutating stored units", () => {
  assert.match(favoritesPanelSource, /function formatFavoriteMoneyYuan/, "favorites panel should format money metrics locally");
  assert.match(favoritesPanelSource, /platform === "missevan" \? 10 : 100/, "missevan diamonds and manbo beans should convert to yuan");
  assert.match(favoritesPanelSource, /return `\$\{sign\}\$\{\(absoluteAmount \/ 100000000\)\.toFixed\(1\)\}亿元`/);
  assert.match(favoritesPanelSource, /return `\$\{sign\}\$\{\(absoluteAmount \/ 10000\)\.toFixed\(1\)\}万元`/);
  assert.match(favoritesPanelSource, /return `\$\{sign\}\$\{absoluteAmount\}元`/);
  assert.doesNotMatch(favoritesPanelSource, /\?\s*`\$\{metricLabels\[metricKey\]\}（元）`/, "metric labels should not repeat yuan unit when the value carries it");
  assert.match(favoritesPanelSource, /isFavoriteMoneyMetric/, "money metrics should be detected explicitly");
  assert.match(favoritesPanelSource, /formatFavoriteMoneyYuan\(value, platform\)/);
  assert.match(favoritesPanelSource, /formatFavoriteMoneyYuan\(number, platform\)/);
  assert.match(favoritesPanelSource, /metricKey=\{key\} value=\{getMetricValue\(latest, key\)\} platform=\{favorite\.platform\}/);
  assert.doesNotMatch(favoritesStorageSource, /formatFavoriteMoneyYuan/, "storage should keep raw snapshot values");
});

test("favorite focus metric merges reward total and gift total into one option", () => {
  assert.match(
    favoritesStorageSource,
    /\{ key: "rewardTotal", label: "打赏\/投喂", platforms: \["missevan", "manbo"\] \}/,
    "favorite focus metric should expose one shared reward/gift option"
  );
  assert.doesNotMatch(
    favoritesStorageSource,
    /\{ key: "giftTotal", label: "总投喂", platforms: \["manbo"\] \}/,
    "favorite focus metric dropdown should not duplicate reward total and gift total"
  );
  assert.match(
    favoritesPanelSource,
    /const resolvedDeltaMetric = resolveFavoriteMetricKey\(favorite\.platform, deltaMetric\)/,
    "snapshot deltas should map the shared metric key to the platform-specific stored field"
  );
  assert.match(
    favoritesStorageSource,
    /key === "giftTotal" && normalizedPlatform === "missevan"[\s\S]*return "rewardTotal"/,
    "old giftTotal selections should still read Missevan reward totals instead of showing empty deltas"
  );
});

test("favorites card shows Manbo paid/listen before gift total on all viewports", () => {
  assert.match(
    favoritesPanelSource,
    /\["viewCount", "subscriptionCount", "paidOrListenCount", "giftTotal", "paidIdCount"\]/,
    "Manbo favorite card metrics should place paid/listen before gift total for both desktop and mobile layouts"
  );
});

test("favorites card keeps destructive action in the left operation rail", () => {
  assert.match(favoritesPanelSource, /grid-cols-\[2rem_minmax\(0,1fr\)\]/);
  assert.match(favoritesPanelSource, /col-span-2 grid grid-cols-3 gap-2 lg:hidden/, "mobile metrics should extend to the checkbox-aligned card edge");
  assert.match(favoritesPanelSource, /col-span-2/, "snapshot details should extend to the checkbox-aligned card edge");
  assert.match(
    favoritesPanelSource,
    /<div className="flex flex-col items-center gap-2[\s\S]*?<Checkbox[\s\S]*?<Button[\s\S]*?aria-label="取消收藏"/,
    "cancel favorite button should sit below the checkbox in the left rail"
  );
  assert.doesNotMatch(
    favoritesPanelSource,
    /<div className="flex shrink-0 items-center gap-1">[\s\S]*aria-label="取消收藏"[\s\S]*aria-label=\{expanded \? "收起统计记录" : "展开统计记录"\}/,
    "title row should not keep the old delete and chevron action cluster"
  );
});

test("favorites card disables destructive action while refresh is running", () => {
  assert.match(
    favoritesPanelSource,
    /aria-label="取消收藏"[\s\S]*?disabled=\{favoriteActionsDisabled\}/,
    "favorite removal should be disabled while refresh tasks may write the same record"
  );
});

test("favorite refresh state survives navigation through ToolView ownership", () => {
  assert.match(toolViewSource, /const \[favoriteRefreshState, setFavoriteRefreshState\] = useState\(/);
  assert.match(toolViewSource, /const \[favoriteRefreshRevision, setFavoriteRefreshRevision\] = useState\(0\)/);
  assert.match(toolViewSource, /const favoriteRefreshStateRef = useRef\(favoriteRefreshState\)/);
  assert.match(toolViewSource, /favoriteRefreshStateRef\.current = favoriteRefreshState/);
  assert.match(toolViewSource, /function handleFavoriteRefreshSettled\(/);
  assert.match(toolViewSource, /setFavoriteRefreshRevision\(\(current\) => current \+ 1\)/);
  assert.match(favoritesPanelSource, /refreshState = \{/);
  assert.doesNotMatch(
    favoritesPanelSource,
    /const \[refreshState, setRefreshState\] = useState\(\{[\s\S]*?isRunning: false/,
    "FavoritesPanel should not lose refresh state when the tab unmounts"
  );
  assert.match(favoritesPanelSource, /onRefreshStateChange\(\{[\s\S]*?isRunning: true/);
  assert.match(favoritesPanelSource, /onRefreshSettled\?\.\(\)/);
  assert.match(favoritesPanelSource, /useEffect\(\(\) => \{[\s\S]*?reloadSnapshots\(\);[\s\S]*?\}, \[refreshRevision\]\)/);
  assert.match(
    favoritesPanelSource,
    /useEffect\(\(\) => \{[\s\S]*?mountedRef\.current = true;[\s\S]*?return \(\) => \{[\s\S]*?mountedRef\.current = false;/,
    "mountedRef should recover after React development StrictMode re-runs effects"
  );
  assert.match(
    toolViewSource,
    /<FavoritesPanel[\s\S]*?refreshState=\{favoriteRefreshState\}[\s\S]*?refreshRevision=\{favoriteRefreshRevision\}[\s\S]*?onRefreshStateChange=\{setFavoriteRefreshState\}[\s\S]*?onRefreshSettled=\{handleFavoriteRefreshSettled\}/,
    "ToolView should pass durable refresh state and completion hooks to FavoritesPanel"
  );
});

test("favorite actions are disabled globally during favorite refresh", () => {
  assert.match(toolViewSource, /const favoriteActionsDisabled = favoriteRefreshState\.isRunning/);
  assert.match(
    toolViewSource,
    /if \(favoriteRefreshStateRef\.current\.isRunning\) \{[\s\S]*?toast\.warning\("收藏刷新中，请稍后再操作。"\);[\s\S]*?return;[\s\S]*?\}/,
    "toggleFavorite should guard against hidden or stale favorite action entry points"
  );
  assert.match(toolViewSource, /<RanksPanel[\s\S]*?favoriteActionsDisabled=\{favoriteActionsDisabled\}/);
  assert.match(toolViewSource, /<OngoingPanel[\s\S]*?favoriteActionsDisabled=\{favoriteActionsDisabled\}/);
  assert.match(toolViewSource, /<FavoritesPanel[\s\S]*?favoriteActionsDisabled=\{favoriteActionsDisabled\}/);
  assert.match(toolViewSource, /<SearchResults[\s\S]*?favoriteActionsDisabled=\{favoriteActionsDisabled\}/);
  assert.match(favoritesPanelSource, /disabled=\{refreshState\.isRunning \|\| favoriteActionsDisabled \|\| selectedKeys\.size === 0\}/);
  assert.match(favoritesPanelSource, /disabled=\{refreshState\.isRunning \|\| favoriteActionsDisabled \|\| favorites\.length === 0\}/);
  assert.match(favoritesPanelSource, /disabled=\{favoriteActionsDisabled\}/);
  assert.match(favoritesPanelSource, /\{refreshState\.isRunning \? "刷新中" : "选中"\}/);
  assert.match(favoritesPanelSource, /\{refreshState\.isRunning \? "刷新中" : "全部"\}/);
  assert.match(searchResultsSource, /favoriteActionsDisabled = false/);
  assert.match(searchResultsSource, /disabled=\{favoriteActionsDisabled\}[\s\S]*?onClick=\{\(\) => onToggleFavorite\?\./);
  assert.match(ranksPanelSource, /favoriteActionsDisabled = false/);
  assert.match(ranksPanelSource, /disabled=\{favoriteActionsDisabled\}[\s\S]*?onClick=\{toggleFavorite\}/);
  assert.match(ongoingPanelSource, /favoriteActionsDisabled = false/);
  assert.match(ongoingPanelSource, /disabled=\{favoriteActionsDisabled\}[\s\S]*?onClick=\{toggleFavorite\}/);
});

test("favorite refresh skips writes when the favorite was removed mid-refresh", () => {
  const refreshStart = favoritesPanelSource.indexOf("async function refreshFavoriteSnapshot");
  assert.notEqual(refreshStart, -1, "favorite refresh function should exist");
  const refreshEnd = favoritesPanelSource.indexOf("\nexport function FavoritesPanel", refreshStart);
  const refreshSource = favoritesPanelSource.slice(refreshStart, refreshEnd === -1 ? undefined : refreshEnd);
  const refreshManyStart = favoritesPanelSource.indexOf("async function refreshMany");
  assert.notEqual(refreshManyStart, -1, "favorite batch refresh function should exist");
  const refreshManyEnd = favoritesPanelSource.indexOf("\n  async function exportData", refreshManyStart);
  const refreshManySource = favoritesPanelSource.slice(
    refreshManyStart,
    refreshManyEnd === -1 ? undefined : refreshManyEnd
  );

  assert.match(
    favoritesPanelSource,
    /updateFavoriteIfExists/,
    "favorite refresh should import a conditional update helper before writing"
  );
  assert.match(
    favoritesStorageSource,
    /export async function updateFavoriteIfExists/,
    "favorites storage should expose an atomic conditional update helper for refresh race checks"
  );
  assert.match(
    refreshSource,
    /const nextFavorite = await updateFavoriteIfExists\(favorite\.key,\s*\(activeFavorite\) => \(\{/,
    "favorite refresh should read the target and save refreshed data in one transaction"
  );
  assert.match(
    refreshSource,
    /if \(!nextFavorite\) \{[\s\S]*?return null;[\s\S]*?\}/,
    "favorite refresh should stop when cancellation removed the target"
  );
  assert.doesNotMatch(
    refreshSource,
    /await saveFavorite\(nextFavorite\)/,
    "refresh should not recreate a removed record with a separate saveFavorite call"
  );
  assert.match(
    refreshManySource,
    /const activeFavorite = await getFavoriteByKey\(favorite\.key\)\.catch\(\(\) => null\)/,
    "failed refresh snapshots should also confirm the favorite still exists"
  );
  assert.match(
    refreshManySource,
    /if \(!activeFavorite\) \{[\s\S]*?continue;[\s\S]*?\}[\s\S]*?await saveSnapshot/,
    "failed refresh snapshots should be skipped after cancellation removes the target"
  );
});

test("favorite snapshots are written only while the favorite still exists", () => {
  const saveSnapshotStart = favoritesStorageSource.indexOf("async function saveIndexedDbSnapshot");
  assert.notEqual(saveSnapshotStart, -1, "favorite snapshot save helper should exist");
  const saveSnapshotEnd = favoritesStorageSource.indexOf("\nasync function loadIndexedDbFavoriteSettings", saveSnapshotStart);
  const saveSnapshotSource = favoritesStorageSource.slice(
    saveSnapshotStart,
    saveSnapshotEnd === -1 ? undefined : saveSnapshotEnd
  );

  assert.match(
    favoritesStorageSource,
    /function runStores\(storeNames, mode, runner\)/,
    "favorites storage should support one transaction across multiple object stores"
  );
  assert.match(
    saveSnapshotSource,
    /runStores\(\[FAVORITES_STORE, SNAPSHOTS_STORE\], "readwrite"/,
    "snapshot writes should share a transaction with the favorite existence check"
  );
  assert.match(
    saveSnapshotSource,
    /const request = favoritesStore\.get\(snapshot\.favoriteKey\)/,
    "snapshot writes should check the active favorite in the same transaction"
  );
  assert.match(
    saveSnapshotSource,
    /if \(!favorite\) \{[\s\S]*?resolve\(null\);[\s\S]*?return;/,
    "snapshot writes should be skipped when cancellation already removed the favorite"
  );
  assert.ok(
    saveSnapshotSource.indexOf("favoritesStore.get(snapshot.favoriteKey)") <
      saveSnapshotSource.indexOf("snapshotsStore.put(snapshot)"),
    "saveSnapshot should not put the snapshot before the favorite existence check"
  );
  assert.match(
    saveSnapshotSource,
    /snapshotsStore\.put\(snapshot\);[\s\S]*?favoritesStore\.put\(\{[\s\S]*lastSnapshotAt: snapshot\.capturedAt/,
    "snapshot and lastSnapshotAt should be committed by the same transaction"
  );
  assert.doesNotMatch(
    saveSnapshotSource,
    /runStore\(SNAPSHOTS_STORE[\s\S]*runStore\(FAVORITES_STORE/,
    "saveSnapshot should not split snapshot and favorite updates into separate transactions"
  );
});

test("favorites cancellation is confirmed and removes saved snapshots", () => {
  assert.match(toolViewSource, /removeFavoriteWithSnapshots/, "favorite cancellation should delete stored snapshots");
  assert.match(toolViewSource, /cancelFavoriteRequest/, "favorite cancellation should wait for confirmation");
  assert.match(toolViewSource, /会删除这部作品的收藏记录和历史统计数据/);
});

test("favorite stats task source flows into danmaku usage logs", () => {
  assert.match(favoritesPanelSource, /source: "favorite"/, "favorite refresh should mark stats tasks as favorite sourced");
  assert.match(serverSource, /source: task\.source/, "stat task source should be passed into danmaku summary calls");
  assert.match(serverSource, /\.\.\.\(source \? \{ source \} : \{\}\)/, "danmaku usage logs should include optional source");
  assert.match(
    favoritesPanelSource,
    /taskType: "revenue"[\s\S]*payload: \{ dramaIds: \[Number\(favorite\.dramaId\)\], source: "favorite" \}/,
    "Missevan favorite revenue refresh should mark the task as favorite sourced"
  );
  assert.match(
    serverSource,
    /fetchDanmakuSummary\(\s*episode\.sound_id,\s*title,\s*String\(episode\?\.name \?\? ""\)\.trim\(\),\s*task\.source\s*\)/,
    "Missevan revenue danmaku logs should inherit the stats task source"
  );
  assert.match(
    serverSource,
    /fetchManboDanmakuSummary\(\s*episode\.sound_id,\s*title,\s*String\(episode\?\.name \?\? ""\)\.trim\(\),\s*task\.source\s*\)/,
    "Manbo revenue danmaku logs should inherit the stats task source"
  );
});

test("Missevan favorite refresh avoids running duplicate danmaku tasks", () => {
  const refreshStart = favoritesPanelSource.indexOf("async function refreshFavoriteSnapshot");
  assert.notEqual(refreshStart, -1, "favorite refresh function should exist");
  const refreshEnd = favoritesPanelSource.indexOf("\nfunction buildEmptySnapshotMetrics", refreshStart);
  const refreshSource = favoritesPanelSource.slice(refreshStart, refreshEnd === -1 ? undefined : refreshEnd);

  assert.doesNotMatch(
    refreshSource,
    /if \(paidEpisodes\.length > 0\)[\s\S]*?taskType: "id"[\s\S]*?if \(favorite\.platform === "missevan"\)[\s\S]*?taskType: "revenue"/,
    "Missevan favorite refresh should not run an ID task before the revenue task"
  );
  assert.match(
    refreshSource,
    /paidIdCount = Number\(revenueResult\?\.seasonPaidUserCount \?\? revenueResult\?\.paidUserCount \?\? 0\) \|\| 0/,
    "Missevan favorite paid ID count should reuse revenue task results"
  );
});

test("drama detail normalization exposes platform update timestamps", () => {
  assert.match(serverSource, /lastupdate_time/, "Missevan getdramabysound lastupdate_time should be read");
  assert.match(serverSource, /updateTime/, "Manbo dramaDetail updateTime should be read");
  assert.match(serverSource, /needsUpdatedAtBackfill/, "Missevan detail fetch should backfill update time from getdramabysound");
  assert.match(serverSource, /bySoundNormalized\?\.drama\?\.updated_at/, "Missevan by-sound detail should provide normalized updated_at");
});

test("favorites backup format stays versioned and tool-readable", () => {
  assert.match(favoritesStorageSource, /FAVORITES_DB_NAME = "mm-toolkit-favorites"/);
  assert.match(favoritesStorageSource, /FAVORITES_BACKUP_VERSION = 1/);
  assert.match(favoritesStorageSource, /type: FAVORITES_BACKUP_TYPE/);
  assert.match(favoritesStorageSource, /favorites: favorites\.map/);
  assert.match(favoritesStorageSource, /snapshots: snapshots\.map/);
  assert.match(favoritesStorageSource, /settings: normalizeFavoriteSettings/);
});

test("merged search textarea submits on plain Enter and keeps Shift Enter for newlines", () => {
  assert.match(searchPanelSource, /event\.key === "Enter" && !event\.shiftKey/);
  assert.doesNotMatch(searchPanelSource, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
});

test("ongoing title content-type badge is rendered inside the title button", () => {
  const titleButtonStart = ongoingPanelSource.search(/<button\s+type="button"[\s\S]*?onClick=\{openSearchResult\}/);
  assert.notEqual(titleButtonStart, -1, "title button markup should exist");

  const titleButtonEnd = ongoingPanelSource.indexOf("</button>", titleButtonStart);
  assert.notEqual(titleButtonEnd, -1, "title button should have a closing tag");

  const titleButtonMarkup = ongoingPanelSource.slice(titleButtonStart, titleButtonEnd);
  assert.match(titleButtonMarkup, /titleTags\.map/, "title tags should be part of the title button inline flow");
});

test("ongoing refresh timestamp uses device timezone display", () => {
  const updatedAtStart = ongoingPanelSource.indexOf("function formatOngoingUpdatedAt");
  assert.notEqual(updatedAtStart, -1, "updated-at formatter should exist");
  const updatedAtEnd = ongoingPanelSource.indexOf("\n}", updatedAtStart);
  const updatedAtFormatter = ongoingPanelSource.slice(updatedAtStart, updatedAtEnd);

  assert.match(ongoingPanelSource, /formatDeviceDateTime/, "ongoing panel should use shared device-time formatter");
  assert.doesNotMatch(updatedAtFormatter, /Asia\/Shanghai/, "ongoing refresh timestamp should not force Beijing time");
});

test("ongoing paid ID metric displays full numbers while playback stays compact", () => {
  assert.match(
    ongoingPanelSource,
    /metricKey === "danmaku_uid_count"[\s\S]*?formatPlainNumber/,
    "paid ID metrics should use full plain-number formatting"
  );
  assert.match(
    ongoingPanelSource,
    /metricKey === "view_count" \? \{ forceWanDecimal: true \} : \{\}/,
    "playback metrics should keep the compact wan formatter options"
  );
});

test("changelog dialog keeps header and footer fixed while entries scroll", () => {
  assert.match(
    changelogDialogSource,
    /h-\[min\(80dvh,34rem\)\]/,
    "changelog dialog should cap its own height for mobile-friendly reading"
  );
  assert.match(
    changelogDialogSource,
    /overflow-y-auto/,
    "changelog entries should scroll inside the dialog body"
  );

  const scrollRegionStart = changelogDialogSource.indexOf('data-changelog-scroll-region="true"');
  assert.notEqual(scrollRegionStart, -1, "changelog scroll region should be explicitly marked");
  const footerStart = changelogDialogSource.indexOf("<AlertDialogFooter", scrollRegionStart);
  assert.notEqual(footerStart, -1, "changelog footer should render after the scroll region");
  const scrollRegionSource = changelogDialogSource.slice(scrollRegionStart, footerStart);

  assert.match(scrollRegionSource, /CHANGELOG_ENTRIES\.map/);
  assert.doesNotMatch(scrollRegionSource, /<AlertDialogFooter/);
  assert.match(changelogDialogSource, /min-h-0/);
  assert.match(changelogDialogSource, /overscroll-contain/);
  assert.match(changelogDialogSource, /\[-webkit-overflow-scrolling:touch\]/);
});

test("rank desktop title content-type badge is rendered inside the clickable title", () => {
  const desktopTitleStart = ranksPanelSource.indexOf('<div className="hidden min-w-0 lg:block">');
  assert.notEqual(desktopTitleStart, -1, "desktop title row markup should exist");

  const desktopTitleEnd = ranksPanelSource.indexOf('<div className="min-w-0 lg:hidden">', desktopTitleStart);
  assert.notEqual(desktopTitleEnd, -1, "desktop title row should end before mobile title row");

  const desktopTitleMarkup = ranksPanelSource.slice(desktopTitleStart, desktopTitleEnd);
  const titleButtonStart = desktopTitleMarkup.search(/<button\s+type="button"[\s\S]*?onClick=\{openSearchResult\}/);
  assert.notEqual(titleButtonStart, -1, "desktop clickable title button should exist");

  const titleButtonEnd = desktopTitleMarkup.indexOf("</button>", titleButtonStart);
  assert.notEqual(titleButtonEnd, -1, "desktop clickable title button should have a closing tag");

  const titleButtonMarkup = desktopTitleMarkup.slice(titleButtonStart, titleButtonEnd);
  assert.match(titleButtonMarkup, /titleTags\.map/, "desktop title tags should be part of the clickable title inline flow");
});

test("rank mobile title content-type badge is rendered inside the clickable title", () => {
  const mobileTitleStart = ranksPanelSource.indexOf('<div className="min-w-0 lg:hidden">');
  assert.notEqual(mobileTitleStart, -1, "mobile title row markup should exist");

  const mobileTitleEnd = ranksPanelSource.indexOf("{detailIdText ? (", mobileTitleStart);
  assert.notEqual(mobileTitleEnd, -1, "mobile title row should end before detail id row");

  const mobileTitleMarkup = ranksPanelSource.slice(mobileTitleStart, mobileTitleEnd);
  const titleButtonStart = mobileTitleMarkup.search(/<button\s+type="button"[\s\S]*?onClick=\{openSearchResult\}/);
  assert.notEqual(titleButtonStart, -1, "mobile clickable title button should exist");

  const titleButtonEnd = mobileTitleMarkup.indexOf("</button>", titleButtonStart);
  assert.notEqual(titleButtonEnd, -1, "mobile clickable title button should have a closing tag");

  const titleButtonMarkup = mobileTitleMarkup.slice(titleButtonStart, titleButtonEnd);
  assert.match(titleButtonMarkup, /titleTags\.map/, "mobile title tags should be part of the clickable title inline flow");
});

test("peak rank titles pass all available drama ids to search result jump", () => {
  assert.match(
    ranksPanelSource,
    /const searchDramaIds = isMissevanPeak[\s\S]*?item\.drama_ids[\s\S]*?\[item\.id\]/,
    "peak rank title logic should derive an ids array from Missevan drama_ids or the Manbo id"
  );
  assert.match(
    ranksPanelSource,
    /ids: searchDramaIds/,
    "rank title click payload should pass the ids array to ToolView"
  );
});

test("rank refresh timestamps use device timezone display", () => {
  assert.match(ranksPanelSource, /formatDeviceDateTime/, "rank panel should use shared device-time formatter");
  assert.doesNotMatch(ranksPanelSource, /北京时间/, "rank refresh copy should not hardcode Beijing time");
});

test("rank trend dialog shows metric refresh time in device timezone", () => {
  assert.match(rankTrendUiSource, /数据刷新于：/, "trend date row should include metric refresh copy");
  assert.match(rankTrendUiSource, /formatDeviceDateTime/, "trend refresh time should use the shared device-time formatter");
  assert.match(rankTrendUiSource, /generatedAt/, "trend UI should read generatedAt from metric window data");
});

test("rank trend chart starts paid ID line at the first nonzero history point", () => {
  const percentPointsStart = rankTrendUiSource.indexOf("function buildTrendPercentPoints");
  assert.notEqual(percentPointsStart, -1, "trend percent point builder should exist");
  const percentPointsEnd = rankTrendUiSource.indexOf("function isPeakSeriesChart", percentPointsStart);
  assert.notEqual(percentPointsEnd, -1, "trend percent point builder should end before peak chart logic");
  const percentPointSource = rankTrendUiSource.slice(percentPointsStart, percentPointsEnd);

  assert.match(percentPointSource, /metric\?\.key === "danmaku_uid_count"/);
  assert.match(percentPointSource, /value > 0/);
  assert.match(percentPointSource, /hasReachedBasePoint/);
  assert.match(percentPointSource, /percent: null/);
  assert.match(
    rankTrendUiSource,
    /history\.find\(\(point\) => getTrendNumber\(point\.value\) != null\)/,
    "ordinary metrics should still use the first finite history value as their baseline"
  );
});

test("rank trend backend keeps sparse missing dates instead of dropping them", () => {
  assert.match(ranksTrendUtilsSource, /function getMetricHistoryRange/);
  assert.match(ranksTrendUtilsSource, /function getRepeatedTrendSampleDateSet/);
  assert.match(ranksTrendUtilsSource, /function areTrendMetricValuesEqual/);
  assert.match(ranksTrendUtilsSource, /metricConfigs = getRankTrendMetricConfigs\(platform\)/);
  assert.match(ranksTrendUtilsSource, /const staleDateSet = getRepeatedTrendSampleDateSet/);
  assert.match(ranksTrendUtilsSource, /staleDateSet\.has\(date\) \? null : getDramaMetrics/);
  assert.match(ranksTrendUtilsSource, /const availableHistory = history\.filter\(\(point\) => point\.drama\)/);
  assert.match(ranksTrendUtilsSource, /buildMetric\(config, history\)/);
  assert.match(ranksTrendUtilsSource, /buildPeakSeriesMetric\(config, history\)/);
  assert.match(ranksTrendUtilsSource, /const staleDateSet = getRepeatedPeakSeriesSampleDateSet/);
  assert.match(ranksTrendUtilsSource, /staleDateSet\.has\(date\) \? \{ date \} : samplesByDate\[date\]/);
  assert.doesNotMatch(
    ranksTrendUtilsSource,
    /\.map\(\(date\) => \(\{\s*date,\s*drama: getDramaMetrics\(snapshotsByDate\[date\], id\),\s*\}\)\)\s*\.filter\(\(point\) => point\.drama\)/,
    "window trend history should preserve dates whose current drama is missing"
  );
  assert.doesNotMatch(
    ranksTrendUtilsSource,
    /\.map\(\(date\) => samplesByDate\[date\]\)\s*\.filter\(Boolean\)/,
    "peak series history should preserve dates whose sample is missing"
  );
});

test("rank trend details use no-data copy while chart skips null points", () => {
  assert.match(rankTrendUiSource, /function formatTrendSnapshotValue\(value\)/);
  assert.match(rankTrendUiSource, /value == null \? "无数据" : formatTrendValue\(value\)/);
  assert.match(rankTrendUiSource, /formatTrendSnapshotValue\(row\.values\[column\.key\]\)/);
  assert.match(rankTrendUiSource, /getTrendNumber\(point\[valueKey\]\) != null/);
});

test("rank trend chart legend toggles metrics and keeps at least one visible", () => {
  assert.match(rankTrendUiSource, /function TrendMetricToggleLegend/);
  assert.match(rankTrendUiSource, /type="checkbox"/);
  assert.match(rankTrendUiSource, /checked=\{isChecked\}/);
  assert.match(rankTrendUiSource, /onChange=\{\(\) => onToggleMetric\?\.\(metric\.key\)\}/);
  assert.match(rankTrendUiSource, /const \[visibleMetricKeys, setVisibleMetricKeys\] = useState\(\(\) => new Set\(\)\)/);
  assert.match(rankTrendUiSource, /function toggleVisibleMetric\(metricKey\)/);
  assert.match(rankTrendUiSource, /const visibleCurrentMetricCount = currentMetricKeys\.filter\(\(key\) => current\.has\(key\)\)\.length/);
  assert.match(rankTrendUiSource, /current\.has\(metricKey\) && currentMetricKeys\.includes\(metricKey\) && visibleCurrentMetricCount <= 1/);
  assert.match(rankTrendUiSource, /const visibleCurrentMetricCount = legendMetrics\.filter\(\(metric\) => visibleMetricKeys\.has\(metric\.key\)\)\.length/);
  assert.match(rankTrendUiSource, /const knownMetricKeysRef = useRef\(new Set\(\)\)/);
  assert.match(rankTrendUiSource, /function resetVisibleTrendMetrics\(\)/);
  assert.match(rankTrendUiSource, /knownMetricKeysRef\.current = new Set\(\)/);
  assert.match(rankTrendUiSource, /const chartMetricKeys = chartMetricKeySignature\.split\("\|"\)\.filter\(Boolean\)/);
  assert.match(rankTrendUiSource, /const newMetricKeys = chartMetricKeys\.filter\(\(key\) => !knownMetricKeys\.has\(key\)\)/);
  assert.match(rankTrendUiSource, /const hasVisibleCurrentMetric = chartMetricKeys\.some\(\(key\) => next\.has\(key\)\)/);
  assert.match(rankTrendUiSource, /if \(!hasVisibleCurrentMetric\) \{[\s\S]*next\.add\(chartMetricKeys\[0\]\)/);
  assert.doesNotMatch(rankTrendUiSource, /if \(!chartMetricKeys\.length\) \{\s*setVisibleMetricKeys\(new Set\(\)\);\s*setKnownMetricKeys\(new Set\(\)\);\s*return;\s*\}/);
  assert.doesNotMatch(rankTrendUiSource, /\}, \[open, chartMetricKeySignature, knownMetricKeys\]\)/);
  assert.match(rankTrendUiSource, /const visibleChartMetrics = visibleMetricKeys\.size[\s\S]*\? chartMetrics\.filter\(\(metric\) => visibleMetricKeys\.has\(metric\.key\)\)[\s\S]*: chartMetrics/);
  assert.match(rankTrendUiSource, /<RankTrendLineChart[\s\S]*metrics=\{visibleChartMetrics\}[\s\S]*legendMetrics=\{chartMetrics\}/);
  assert.doesNotMatch(rankTrendUiSource, /\}, \[open, activeWindowKey, chartMetricKeySignature\]\)/);

  const lineChartStart = rankTrendUiSource.indexOf("function RankTrendLineChart");
  const lineChartEnd = rankTrendUiSource.indexOf("function getSnapshotColumns", lineChartStart);
  assert.notEqual(lineChartStart, -1, "RankTrendLineChart should exist");
  assert.notEqual(lineChartEnd, -1, "RankTrendLineChart should end before snapshot helpers");
  const lineChartSource = rankTrendUiSource.slice(lineChartStart, lineChartEnd);
  assert.doesNotMatch(lineChartSource, /className="size-2 rounded-full"/);
  assert.match(lineChartSource, /<TrendMetricToggleLegend/);
});

test("rank trend chart data points show hover and touch tooltips", () => {
  const lineChartStart = rankTrendUiSource.indexOf("function RankTrendLineChart");
  const lineChartEnd = rankTrendUiSource.indexOf("function getSnapshotColumns", lineChartStart);
  assert.notEqual(lineChartStart, -1, "RankTrendLineChart should exist");
  assert.notEqual(lineChartEnd, -1, "RankTrendLineChart should end before snapshot helpers");
  const lineChartSource = rankTrendUiSource.slice(lineChartStart, lineChartEnd);

  assert.match(lineChartSource, /const \[hoveredPoint, setHoveredPoint\] = useState\(null\)/);
  assert.match(lineChartSource, /const \[selectedPoint, setSelectedPoint\] = useState\(null\)/);
  assert.match(lineChartSource, /const chartMetricSignature = availableMetrics[\s\S]*\.map\(\(metric\) => `\$\{metric\.key\}:/);
  assert.match(lineChartSource, /useEffect\(\(\) => \{[\s\S]*setHoveredPoint\(null\);[\s\S]*setSelectedPoint\(null\);[\s\S]*\}, \[windowKey, chartMetricSignature\]\)/);
  assert.match(lineChartSource, /const activeTooltipPoint = selectedPoint \|\| hoveredPoint/);
  assert.match(lineChartSource, /function buildTooltipPoint\(line, point, position, style\)/);
  assert.match(lineChartSource, /value: formatTrendValue\(point\.value\)/);
  assert.match(lineChartSource, /date: formatTrendDate\(point\.date\)/);
  assert.match(lineChartSource, /onClick=\{\(\) => setSelectedPoint\(null\)\}/);
  assert.match(lineChartSource, /onPointerEnter=\{\(\) => setHoveredPoint\(tooltipPoint\)\}/);
  assert.match(lineChartSource, /onPointerLeave=\{\(\) => setHoveredPoint\(null\)\}/);
  assert.match(lineChartSource, /onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*setSelectedPoint\(tooltipPoint\)/);
  assert.match(lineChartSource, /className="absolute size-7 -translate-x-1\/2 -translate-y-1\/2 rounded-full/);
  assert.match(lineChartSource, /borderColor: activeTooltipPoint\.color/);
  assert.match(lineChartSource, /activeTooltipPoint\.date[\s\S]*activeTooltipPoint\.value/);
  assert.match(lineChartSource, /formatTrendValue\(point\.value\)/);
  assert.doesNotMatch(lineChartSource, /formatAxisPercent\(point\.percent\)/);
});

test("rank trend dialog uses compact window tabs and details trigger", () => {
  const dialogStart = rankTrendUiSource.indexOf("export function RankTrendDialog");
  assert.notEqual(dialogStart, -1, "RankTrendDialog should exist");
  const dialogSource = rankTrendUiSource.slice(dialogStart);
  assert.doesNotMatch(dialogSource, /TabsList className="grid w-full grid-cols-3"/);
  assert.match(dialogSource, /TabsList className="inline-flex h-\[34px\] w-fit items-center justify-center gap-1 rounded-lg border border-border\/70 bg-background\/82 p-1 text-xs!"/);
  assert.match(dialogSource, /TabsTrigger key=\{key\} className="h-\[26px\] min-w-0 rounded-md px-3 text-xs!"/);

  const detailsStart = rankTrendUiSource.indexOf("function TrendSnapshotDetails");
  const detailsEnd = rankTrendUiSource.indexOf("export function RankTrendDeltaBadge", detailsStart);
  assert.notEqual(detailsStart, -1, "TrendSnapshotDetails should exist");
  assert.notEqual(detailsEnd, -1, "TrendSnapshotDetails should end before delta badge");
  const detailsSource = rankTrendUiSource.slice(detailsStart, detailsEnd);
  assert.match(detailsSource, /className="flex h-9 w-full items-center justify-between gap-2 px-2\.5 text-left text-sm! font-medium text-foreground"/);
});

test("rank trend fetch does not reuse stale successful responses forever", () => {
  const fetchStart = rankTrendUiSource.indexOf("export async function fetchRankTrendData");
  assert.notEqual(fetchStart, -1, "rank trend fetch helper should exist");
  const fetchEnd = rankTrendUiSource.indexOf("export async function fetchRanksTrendLookupData", fetchStart);
  assert.notEqual(fetchEnd, -1, "rank trend fetch helper should end before lookup helper");
  const fetchSource = rankTrendUiSource.slice(fetchStart, fetchEnd);

  assert.doesNotMatch(fetchSource, /if \(cached\?\.data\) \{\s*return cached\.data;\s*\}/);
  assert.match(fetchSource, /cache: "no-store"/);
});

test("rank trend backend reads ordinary trends from aggregate platform keys", () => {
  assert.match(serverSource, /RANK_TREND_AGGREGATE_KEYS/);
  assert.match(serverSource, /const rankTrendAggregateCache = new Map\(\)/);
  assert.match(serverSource, /readRankTrendAggregateSnapshot\(normalizedPlatform\)/);
  assert.match(serverSource, /getCachedRankTrendAggregateSnapshot/);
  assert.match(serverSource, /buildAggregatedRankTrendResponse/);

  const fallbackStart = serverSource.indexOf("async function getLegacyRankTrendResponse");
  assert.notEqual(fallbackStart, -1, "legacy rank trend fallback should exist");
  const fallbackEnd = serverSource.indexOf("async function getCachedRankTrendResponse", fallbackStart);
  assert.notEqual(fallbackEnd, -1, "fallback should end before cached trend route loader");
  const primarySource = serverSource.slice(fallbackEnd, serverSource.indexOf("function normalizeMissevanSeasonRecord", fallbackEnd));

  assert.doesNotMatch(primarySource, /ranks:metrics:\$\{date\}:\$\{normalizedPlatform\}/);
  assert.doesNotMatch(primarySource, /ranks:list:\$\{date\}:\$\{normalizedPlatform\}/);
  assert.match(primarySource, /MISSEVAN_PEAK_SERIES_TREND_KEY/);
  assert.match(
    primarySource,
    /await Promise\.resolve\(\);[\s\S]*rankTrendsCache\.get\(cacheKey\)\?\.loadPromise === loadPromise/,
    "ordinary aggregate trend load should yield once before comparing the loadPromise closure"
  );

  const routeStart = serverSource.indexOf('app.get("/ranks/trends"');
  assert.notEqual(routeStart, -1, "rank trend route should exist");
  const routeEnd = serverSource.indexOf('app.get("/ongoing"', routeStart);
  assert.notEqual(routeEnd, -1, "rank trend route should end before ongoing route");
  const routeSource = serverSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /Cache-Control", "no-store, no-cache, must-revalidate"/);
});

test("ongoing backend reads metrics from rank trend aggregate before legacy shards", () => {
  assert.match(serverSource, /buildMetricSnapshotsFromRankTrendAggregate/);
  assert.match(serverSource, /async function getLegacyOngoingMetricSnapshots/);

  const fallbackStart = serverSource.indexOf("async function getLegacyOngoingMetricSnapshots");
  assert.notEqual(fallbackStart, -1, "legacy ongoing metric fallback should exist");
  const fallbackEnd = serverSource.indexOf("async function getCachedOngoingResponse", fallbackStart);
  assert.notEqual(fallbackEnd, -1, "ongoing fallback should end before cached loader");
  const primarySource = serverSource.slice(fallbackEnd, serverSource.indexOf("async function getLegacyRankTrendResponse", fallbackEnd));

  assert.match(primarySource, /getCachedRankTrendAggregateSnapshot\(normalizedPlatform\)/);
  assert.match(primarySource, /buildMetricSnapshotsFromRankTrendAggregate\(aggregateSnapshot, normalizedPlatform\)/);
  assert.doesNotMatch(primarySource, /ranks:metrics:\$\{date\}:\$\{normalizedPlatform\}/);
});

test("server compresses JSON responses but skips images", () => {
  assert.match(serverSource, /import compression from "compression"/);
  assert.match(serverSource, /app\.use\(compression\(/);
  assert.match(serverSource, /threshold: 1024/);
  assert.match(serverSource, /type\.includes\("application\/json"\)/);
  assert.doesNotMatch(serverSource, /type\.startsWith\("image\/"\)[\s\S]*return true/);
});

test("image proxy retries aborted image bodies and logs concise failures", () => {
  assert.match(serverSource, /const IMAGE_PROXY_TIMEOUT_MS = 8000/);
  assert.match(serverSource, /const IMAGE_PROXY_RETRIES = 2/);
  assert.match(serverSource, /async function fetchImageBufferWithRetry/);
  assert.match(serverSource, /function formatImageProxyError/);

  const helperStart = serverSource.indexOf("async function fetchImageBufferWithRetry");
  assert.notEqual(helperStart, -1, "image proxy retry helper should exist");
  const helperEnd = serverSource.indexOf("app.get(\"/image-proxy\"", helperStart);
  assert.notEqual(helperEnd, -1, "image proxy helper should be defined before the route");
  const helperSource = serverSource.slice(helperStart, helperEnd);

  assert.match(helperSource, /createTimeoutSignal\(IMAGE_PROXY_TIMEOUT_MS\)/);
  assert.match(helperSource, /response\.arrayBuffer\(\)/);
  assert.match(helperSource, /response\.status >= 400 && response\.status < 500/);

  const routeStart = serverSource.indexOf('app.get("/image-proxy"');
  assert.notEqual(routeStart, -1, "image proxy route should exist");
  const routeEnd = serverSource.indexOf('app.get("/search"', routeStart);
  assert.notEqual(routeEnd, -1, "image proxy route should end before search route");
  const routeSource = serverSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /fetchImageBufferWithRetry\(targetUrl\)/);
  assert.match(routeSource, /formatImageProxyError\(error\)/);
  assert.match(routeSource, /console\.warn\(/);
  assert.match(routeSource, /res\.status\(502\)\.send\("Image proxy failed"\)/);
  assert.doesNotMatch(routeSource, /console\.error\(error\)/);
});
