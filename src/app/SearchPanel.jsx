import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";

import {
  buildVersionedUrl,
  classifyUnifiedSearchInput,
  getBackendVersionFromResponse,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  MISSEVAN_DESKTOP_ACCESS_HINT,
  normalizeVersion,
} from "@/app/app-utils";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSearchSuggestions } from "@/app/useSearchSuggestions";
import { SearchSuggestionList } from "@/app/SearchSuggestionList";

const searchHelpText = [
  "空格表示 AND ，逗号表示 OR；非单独出现的“广播剧”“有声剧”可被识别为剧集类型。例如：",
  "“魔道，天官” = 包含 “魔道” 或 “天官”",
  "“路知行 魏超 墨香” = “路知行” “魏超” “墨香” 全都包含",
  "“priest 阿杰， 将进酒” = “priest” “阿杰” 都包含 或 包含 “将进酒”",
  "“回信 广播剧” = 包含 “回信” 且类型为广播剧",
];

function blurSearchControl(formElement) {
  const activeElement = typeof document !== "undefined" ? document.activeElement : null;
  if (activeElement && formElement?.contains?.(activeElement) && typeof activeElement.blur === "function") {
    activeElement.blur();
    return;
  }
  const inputElement = formElement?.querySelector?.("input");
  inputElement?.blur?.();
}

export function SearchPanel({
  className = "",
  formState,
  isDesktopApp,
  cooldownHours,
  cooldownUntil,
  desktopAppUrl,
  frontendVersion,
  handleVersionResponse,
  onUpdateFormState,
  onUpdatePlatformFormState,
  onResetPlatformState,
  onUpdatePlatformResults,
  onUpdateCvResults,
  onSelectPlatform,
  onSelectCategory,
  onCrossPlatformImport,
  onNotice,
  onSearchCommit,
  onSearchPendingChange,
  onOpenSearchResult,
  onOpenCv,
  suggestionsDisabled = false,
  restoreSearchRequest,
  placeholder = "请输入关键词、ID、分享链接。",
}) {
  const searchGenerationRef = useRef(0);
  const [isSearchPending, setIsSearchPending] = useState(false);
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const searchPendingRef = useRef(false);
  const lastRestoredSearchSignatureRef = useRef("");
  const restoreSearchHandlerRef = useRef(null);
  const keywordValue = formState?.keyword ?? "";
  const hasKeyword = String(keywordValue).trim().length > 0;
  const formRef = useRef(null);
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(-Infinity);
  const suggestionOpenPendingRef = useRef(false);
  const [suggestionOpenPending, setSuggestionOpenPending] = useState(false);
  const suggestionListId = useId();
  const suggestions = useSearchSuggestions({
    keyword: keywordValue,
    enabled: !isDesktopApp && !isSearchPending && !suggestionOpenPending && !suggestionsDisabled && !searchHelpOpen,
    frontendVersion,
    handleVersionResponse,
  });
  const closeSuggestions = suggestions.close;
  useEffect(() => {
    function handleOutsidePointer(event) {
      if (!formRef.current?.contains(event.target)) closeSuggestions();
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [closeSuggestions]);

  async function openSuggestion(item) {
    closeSuggestions();
    if (suggestionOpenPendingRef.current || searchPendingRef.current || suggestionsDisabled) return;
    blurSearchControl(formRef.current);
    setKeyword("");
    suggestionOpenPendingRef.current = true;
    setSuggestionOpenPending(true);
    try {
      if (item.type === "cv") {
        await onOpenCv?.(item.name, { source: "search_suggestion", profileId: item.profileId });
      } else {
        await onOpenSearchResult?.({
          platform: item.platform, id: item.id, name: item.name, contentTypeLabel: item.contentTypeLabel,
          usageAction: "search_suggestion_open_search_result",
          usageSource: "search_suggestion",
        });
      }
    } finally {
      suggestionOpenPendingRef.current = false;
      setSuggestionOpenPending(false);
    }
  }

  function setSearchPending(value) {
    searchPendingRef.current = Boolean(value);
    setIsSearchPending(Boolean(value));
    onSearchPendingChange?.(Boolean(value));
  }

  function setKeyword(value) {
    if (typeof onUpdatePlatformFormState === "function") {
      onUpdatePlatformFormState("missevan", { keyword: value });
      onUpdatePlatformFormState("manbo", { keyword: value });
      return;
    }
    onUpdateFormState?.({ keyword: value });
  }

  async function parseVersionedJson(response) {
    const data = await response.json();
    handleVersionResponse?.({
      frontendVersion: normalizeVersion(frontendVersion),
      backendVersion: getBackendVersionFromResponse(response, data),
    });
    return data;
  }

  async function fetchAppConfig() {
    try {
      const response = await fetch(buildVersionedUrl("/app-config", frontendVersion), {
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      return await parseVersionedJson(response);
    } catch (_) {
      return null;
    }
  }

  function showBlockingNotice(title, description) {
    onNotice?.({ title, description });
  }

  function renderMissevanAccessDeniedMessage(config = { cooldownHours, cooldownUntil }) {
    const plainMessage = getMissevanAccessDeniedMessage(config, cooldownHours);
    return (
      <span aria-label={plainMessage}>
        当前所有备份节点都在冷却中，请{getRemainingCooldownMinutes(config, cooldownHours)}分钟之后再来，或使用
        {desktopAppUrl ? (
          <a className="font-medium text-primary underline underline-offset-4" href={desktopAppUrl} rel="noreferrer" target="_blank">
            桌面版
          </a>
        ) : (
          "桌面版"
        )}
        。
      </span>
    );
  }

  function showMissevanCooldownNotice(config = null) {
    showBlockingNotice("", renderMissevanAccessDeniedMessage(config || { cooldownHours, cooldownUntil }));
  }

  function clearManualInput() {
    if (typeof onUpdatePlatformFormState === "function") {
      onUpdatePlatformFormState("missevan", {
        keyword: "",
        manualInput: "",
      });
      onUpdatePlatformFormState("manbo", {
        keyword: "",
        manualInput: "",
      });
      return;
    }
    onUpdateFormState?.({
      keyword: "",
      manualInput: "",
    });
  }

  function showKeywordTooShortNotice() {
    showBlockingNotice("关键词太短", "关键词太短，请至少输入 2 个汉字，或 3 位字母/数字。");
  }

  function buildUnifiedSearchPath(keyword) {
    return `/unified-search?keyword=${encodeURIComponent(keyword)}&offset=0&limit=5`;
  }

  function hasPlatformMatches(result) {
    const results = Array.isArray(result?.results) ? result.results : [];
    const matchedCount = Number(result?.meta?.matchedCount ?? result?.meta?.totalMatched ?? results.length) || 0;
    return matchedCount > 0 || results.length > 0;
  }

  function normalizeUnifiedPlatformResult(platformResult, keyword) {
    const error = platformResult?.error || "";
    return {
      success: Boolean(platformResult?.success),
      accessDenied: Boolean(platformResult?.accessDenied),
      unavailable: Boolean(platformResult?.unavailable),
      error,
      results: Array.isArray(platformResult?.results) ? platformResult.results : [],
      meta: {
        ...(platformResult?.meta || {}),
        keyword,
        error,
      },
    };
  }

  async function queryBackendUnifiedSearch(keyword) {
    try {
      const response = await fetch(
        buildVersionedUrl(
          buildUnifiedSearchPath(keyword),
          frontendVersion
        )
      );
      const data = await parseVersionedJson(response);
      if (!response.ok) {
        throw new Error(data?.error || `Unified search failed with status ${response.status}`);
      }
      return {
        missevan: normalizeUnifiedPlatformResult(data?.results?.missevan, keyword),
        manbo: normalizeUnifiedPlatformResult(data?.results?.manbo, keyword),
        cv: normalizeUnifiedPlatformResult(data?.results?.cv, keyword),
      };
    } catch (error) {
      console.error("Unified search failed", error);
      return {
        missevan: {
          success: false,
          error,
          results: [],
          meta: {
            keyword,
            matchedCount: 0,
          },
        },
        manbo: {
          success: false,
          error,
          results: [],
          meta: {
            keyword,
            matchedCount: 0,
          },
        },
        cv: {
          success: false,
          error,
          results: [],
          meta: {
            keyword,
            matchedCount: 0,
            exactMatch: false,
          },
        },
      };
    }
  }

  function publishUnifiedSearchResults(resultsByPlatform, source = "search", searchGeneration = 0) {
    onUpdatePlatformResults?.("missevan", resultsByPlatform.missevan?.results || [], source, {
      ...(resultsByPlatform.missevan?.meta || {}),
      searchGeneration,
    });
    onUpdatePlatformResults?.("manbo", resultsByPlatform.manbo?.results || [], source, {
      ...(resultsByPlatform.manbo?.meta || {}),
      searchGeneration,
    });
    onUpdateCvResults?.(resultsByPlatform.cv?.results || [], {
      ...(resultsByPlatform.cv?.meta || {}),
      searchGeneration,
    });
  }

  function selectFirstPlatformWithResults(resultsByPlatform, preferredCategory = "") {
    if (["missevan", "manbo", "cv"].includes(preferredCategory) && hasPlatformMatches(resultsByPlatform[preferredCategory])) {
      if (preferredCategory !== "cv") {
        onSelectPlatform?.(preferredCategory);
      }
      onSelectCategory?.(preferredCategory);
      return;
    }
    if (hasPlatformMatches(resultsByPlatform.cv) && resultsByPlatform.cv?.meta?.exactMatch) {
      onSelectCategory?.("cv");
      return;
    }
    if (hasPlatformMatches(resultsByPlatform.missevan)) {
      onSelectPlatform?.("missevan");
      onSelectCategory?.("missevan");
      return;
    }
    if (hasPlatformMatches(resultsByPlatform.manbo)) {
      onSelectPlatform?.("manbo");
      onSelectCategory?.("manbo");
      return;
    }
    if (hasPlatformMatches(resultsByPlatform.cv)) {
      onSelectCategory?.("cv");
    }
  }

  async function queryUnifiedKeywordSearch(keyword, preferredCategory = "") {
    if (searchPendingRef.current) {
      return;
    }

    onResetPlatformState?.("missevan");
    onResetPlatformState?.("manbo");
    onUpdateCvResults?.([], {
      keyword,
      matchedCount: 0,
      exactMatch: false,
    });
    setSearchPending(true);
    const searchGeneration = ++searchGenerationRef.current;

    try {
      const finalResults = await queryBackendUnifiedSearch(keyword);

      publishUnifiedSearchResults(finalResults, "search", searchGeneration);
      selectFirstPlatformWithResults(finalResults, preferredCategory);

      if (finalResults.missevan?.accessDenied) {
        const config = await fetchAppConfig();
        if (isDesktopApp) {
          showBlockingNotice(
            "Missevan 当前受限",
            MISSEVAN_DESKTOP_ACCESS_HINT
          );
        } else {
          showMissevanCooldownNotice(config || { cooldownHours, cooldownUntil });
        }
      } else {
        const searchedPlatforms = isDesktopApp
          ? [
              { key: "missevan", label: "猫耳", result: finalResults.missevan },
              { key: "manbo", label: "漫播", result: finalResults.manbo },
            ]
          : [
              { key: "missevan", label: "猫耳", result: finalResults.missevan },
              { key: "manbo", label: "漫播", result: finalResults.manbo },
              { key: "cv", label: "CV", result: finalResults.cv },
            ];
        const failures = searchedPlatforms.filter(({ result }) => (
          !result?.success && !result?.accessDenied && (result?.error || result?.unavailable)
        ));
        const hasSuccessfulPlatform = searchedPlatforms.some(({ result }) => (
          result?.success || (isDesktopApp && !result?.accessDenied && !result?.error && !result?.unavailable)
        ));
        const failureDetails = failures.map(({ label, result }) => {
          const detail = String(result?.error || (result?.unavailable ? "当前不可用" : "请求失败"))
            .replace(/\s+/g, " ")
            .slice(0, 180);
          return `${label}：${detail}`;
        });

        if (failures.length && hasSuccessfulPlatform) {
          showBlockingNotice("部分平台搜索失败", `${failureDetails.join("；")}。其余平台结果仍会显示。`);
        } else if (failures.length || (!isDesktopApp && searchedPlatforms.every(({ result }) => !result?.success && !result?.accessDenied))) {
          showBlockingNotice("搜索失败", failureDetails.join("；") || "暂时无法获取搜索结果，请稍后重试。");
        } else if (
          !hasPlatformMatches(finalResults.missevan) &&
          !hasPlatformMatches(finalResults.manbo) &&
          (isDesktopApp || !hasPlatformMatches(finalResults.cv))
        ) {
          showBlockingNotice("", "未找到结果，可尝试导入作品ID或链接。");
        }
      }
    } finally {
      setSearchPending(false);
    }
  }

  restoreSearchHandlerRef.current = queryUnifiedKeywordSearch;
  const restoreSearchSignature = String(restoreSearchRequest?.signature ?? "");
  const restoreSearchKeyword = String(restoreSearchRequest?.keyword ?? "").trim();
  const restoreSearchCategory = String(restoreSearchRequest?.category ?? "");

  useEffect(() => {
    if (
      isSearchPending
      || searchPendingRef.current
      || !restoreSearchSignature
      || !restoreSearchKeyword
      || lastRestoredSearchSignatureRef.current === restoreSearchSignature
    ) {
      return;
    }
    lastRestoredSearchSignatureRef.current = restoreSearchSignature;
    void restoreSearchHandlerRef.current?.(restoreSearchKeyword, restoreSearchCategory);
  }, [isSearchPending, restoreSearchCategory, restoreSearchKeyword, restoreSearchSignature]);

  async function runMergedSearch() {
    if (searchPendingRef.current) {
      return;
    }

    const classified = classifyUnifiedSearchInput(formState?.keyword);
    async function runClassifiedAction(nextClassified) {
      if (nextClassified.action === "import") {
        onSearchCommit?.({ action: "import", targetPlatform: nextClassified.targetPlatform });
        setSearchPending(true);
        try {
          await onCrossPlatformImport?.({
            targetPlatform: nextClassified.targetPlatform,
            rawItems: nextClassified.rawItems,
            sourcePlatform: "search",
          });
        } finally {
          setSearchPending(false);
        }
        return;
      }

      if (nextClassified.action === "mixed_import") {
        showBlockingNotice("无法混用", "关键词搜索和导入功能无法混用，请分开操作。");
        return;
      }

      if (nextClassified.action === "keyword_too_short") {
        showKeywordTooShortNotice();
        return;
      }

      onSearchCommit?.({ action: "search", keyword: nextClassified.keyword });
      await queryUnifiedKeywordSearch(nextClassified.keyword);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        });
      });
    }

    if (classified.action === "empty") {
      showBlockingNotice("缺少内容", "请输入关键词、作品ID、分集ID或链接。");
      return;
    }

    await runClassifiedAction(classified);
  }

  return (
    <form
      ref={formRef}
      className={`flex w-full flex-col gap-1.5 ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (composingRef.current || suggestionOpenPendingRef.current || suggestionsDisabled) return;
        closeSuggestions();
        setSearchHelpOpen(false);
        blurSearchControl(event.currentTarget);
        runMergedSearch();
      }}
    >
      <Popover open={searchHelpOpen} onOpenChange={(open) => {
        closeSuggestions();
        setSearchHelpOpen(open);
      }}>
        <PopoverAnchor asChild>
          <div className="relative">
            <button
              type="submit"
              aria-label="搜索"
              className="absolute left-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-45"
              disabled={isSearchPending || suggestionOpenPending || suggestionsDisabled}
            >
              <SearchIcon className="size-5" />
            </button>
            <input
              className={`h-12 w-full rounded-lg border border-border/80 bg-white pl-11 ${hasKeyword ? "pr-[5.25rem]" : "pr-11"} text-sm! text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40`}
              placeholder={placeholder}
              value={keywordValue}
              role={isDesktopApp ? undefined : "combobox"}
              aria-label="搜索关键词、ID或分享链接"
              aria-autocomplete={isDesktopApp ? undefined : "list"}
              aria-expanded={isDesktopApp ? undefined : suggestions.items.length > 0}
              aria-controls={!isDesktopApp && suggestions.items.length ? suggestionListId : undefined}
              aria-activedescendant={suggestions.items.length && suggestions.selectedIndex >= 0 ? `${suggestionListId}-${suggestions.selectedIndex}` : undefined}
              autoComplete="off"
              onFocus={() => { if (!isDesktopApp) suggestions.activate(); }}
              onChange={(event) => {
                setSearchHelpOpen(false);
                suggestions.activate();
                setKeyword(event.target.value);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                suggestions.startComposition();
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                lastCompositionEndRef.current = Date.now();
                setKeyword(event.currentTarget.value);
                suggestions.endComposition();
              }}
              onKeyDown={(event) => {
                if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229 ||
                    (event.key === "Enter" && Date.now() - lastCompositionEndRef.current < 50)) {
                  if (event.key === "Enter") event.preventDefault();
                  return;
                }
                if (event.key === "Escape") {
                  closeSuggestions();
                } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.items.length) {
                  event.preventDefault();
                  suggestions.moveSelection(event.key === "ArrowDown" ? 1 : -1);
                } else if (event.key === "Enter" && suggestions.items[suggestions.selectedIndex]) {
                  event.preventDefault();
                  const item = suggestions.items[suggestions.selectedIndex];
                  closeSuggestions();
                  setKeyword(item.name);
                }
              }}
            />
            {hasKeyword ? (
              <button
                type="button"
                aria-label="清空输入"
                className="absolute right-11 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-primary"
                onClick={() => { closeSuggestions(); clearManualInput(); }}
              >
                <XIcon className="size-5" />
              </button>
            ) : null}
            {!isDesktopApp ? (
              <SearchSuggestionList id={suggestionListId} items={suggestions.items} selectedIndex={suggestions.selectedIndex} onOpen={openSuggestion} />
            ) : null}
            {!isDesktopApp ? (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="搜索语法说明"
                  aria-expanded={searchHelpOpen}
                  aria-controls="search-syntax-help"
                  className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-base font-semibold text-muted-foreground transition-colors hover:text-primary"
                >
                  ?
                </button>
              </PopoverTrigger>
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          id="search-syntax-help"
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-[var(--radix-popper-anchor-width)] max-w-[calc(100vw-2rem)] gap-1.5 rounded-md bg-popover p-3 text-xs leading-5 shadow-[var(--shadow-panel)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {searchHelpText.map((line) => (
            <p key={line} className="text-muted-foreground">
              {line}
            </p>
          ))}
        </PopoverContent>
      </Popover>
    </form>
  );
}
