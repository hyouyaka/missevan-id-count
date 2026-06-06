import { useRef, useState } from "react";
import { SearchIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildVersionedUrl,
  classifyUnifiedSearchInput,
  getBackendVersionFromResponse,
  normalizeVersion,
} from "@/app/app-utils";

export function SearchPanel({
  formState,
  isDesktopApp,
  cooldownHours,
  cooldownUntil,
  frontendVersion,
  handleVersionResponse,
  onUpdateFormState,
  onUpdatePlatformFormState,
  onResetPlatformState,
  onUpdatePlatformResults,
  onSelectPlatform,
  onCrossPlatformImport,
  onNotice,
}) {
  const [isSearchPending, setIsSearchPending] = useState(false);
  const searchPendingRef = useRef(false);
  const mergedPlaceholder = "输入剧名、CV、角色名、原作名，或粘贴作品ID、分集 ID、网页链接 / 分享链接";

  function setSearchPending(value) {
    searchPendingRef.current = Boolean(value);
    setIsSearchPending(Boolean(value));
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

  function getRemainingCooldownMinutes(config = null) {
    const until = Number(config?.cooldownUntil ?? cooldownUntil ?? 0);
    if (until > Date.now()) {
      return Math.max(1, Math.ceil((until - Date.now()) / 60000));
    }
    const fallbackHours = Number(config?.cooldownHours ?? cooldownHours ?? 4) || 4;
    return Math.max(1, Math.ceil(fallbackHours * 60));
  }

  function showMissevanCooldownNotice(config = null) {
    showBlockingNotice("", `Missevan目前受限中，请${getRemainingCooldownMinutes(config)}分钟后再来`);
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
    return {
      success: Boolean(platformResult?.success),
      accessDenied: Boolean(platformResult?.accessDenied),
      unavailable: Boolean(platformResult?.unavailable),
      results: Array.isArray(platformResult?.results) ? platformResult.results : [],
      meta: {
        ...(platformResult?.meta || {}),
        keyword,
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
      return {
        missevan: normalizeUnifiedPlatformResult(data?.results?.missevan, keyword),
        manbo: normalizeUnifiedPlatformResult(data?.results?.manbo, keyword),
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
      };
    }
  }

  function publishUnifiedSearchResults(resultsByPlatform, source = "search") {
    onUpdatePlatformResults?.("missevan", resultsByPlatform.missevan?.results || [], source, resultsByPlatform.missevan?.meta || {});
    onUpdatePlatformResults?.("manbo", resultsByPlatform.manbo?.results || [], source, resultsByPlatform.manbo?.meta || {});
  }

  function selectFirstPlatformWithResults(resultsByPlatform) {
    if (hasPlatformMatches(resultsByPlatform.missevan)) {
      onSelectPlatform?.("missevan");
      return;
    }
    if (hasPlatformMatches(resultsByPlatform.manbo)) {
      onSelectPlatform?.("manbo");
    }
  }

  async function queryUnifiedKeywordSearch(keyword) {
    if (searchPendingRef.current) {
      return;
    }

    onResetPlatformState?.("missevan");
    onResetPlatformState?.("manbo");
    setSearchPending(true);

    try {
      const finalResults = await queryBackendUnifiedSearch(keyword);

      publishUnifiedSearchResults(finalResults);
      selectFirstPlatformWithResults(finalResults);

      if (finalResults.missevan?.accessDenied) {
        const config = await fetchAppConfig();
        if (isDesktopApp) {
          showBlockingNotice(
            "Missevan 当前受限",
            "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
          );
        } else {
          showMissevanCooldownNotice(config || { cooldownHours, cooldownUntil });
        }
      } else if (
        !finalResults.missevan?.accessDenied &&
        !hasPlatformMatches(finalResults.missevan) &&
        !hasPlatformMatches(finalResults.manbo)
      ) {
        showBlockingNotice("", "未找到结果，可尝试导入作品ID或链接。");
      }
    } finally {
      setSearchPending(false);
    }
  }

  async function runMergedSearch() {
    if (searchPendingRef.current) {
      return;
    }

    const classified = classifyUnifiedSearchInput(formState?.keyword);
    async function runClassifiedAction(nextClassified) {
      if (nextClassified.action === "import") {
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
        showBlockingNotice("导入内容混合", "请一次只粘贴同一平台的作品ID或链接。");
        return;
      }

      if (nextClassified.action === "keyword_too_short") {
        showKeywordTooShortNotice();
        return;
      }

      await queryUnifiedKeywordSearch(nextClassified.keyword);
    }

    if (classified.action === "empty") {
      showBlockingNotice("缺少内容", "请输入关键词、作品ID、分集ID或链接。");
      return;
    }

    await runClassifiedAction(classified);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-base font-semibold text-foreground">搜索 / 导入</div>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 sm:grid-cols-[minmax(0,1fr)_5rem]">
        <Textarea
          className="h-[4.375rem] min-h-[4.375rem] max-h-[4.375rem] min-w-0 resize-none overflow-y-auto border-border/80 bg-white dark:bg-background text-sm! focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder={mergedPlaceholder}
          rows={2}
          value={formState?.keyword ?? ""}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              runMergedSearch();
            }
          }}
        />

        <div className="grid grid-cols-1 gap-1.5">
          <Button className="h-8 gap-1 px-2 text-sm! [&_svg:not([class*='size-'])]:size-3.5" disabled={isSearchPending} onClick={runMergedSearch}>
            <SearchIcon data-icon="inline-start" />
            {isSearchPending ? "搜索中" : "搜索"}
          </Button>
          <Button variant="secondary" className="h-8 gap-1 px-2 text-sm! [&_svg:not([class*='size-'])]:size-3.5" onClick={clearManualInput}>
            <Trash2Icon data-icon="inline-start" />
            清空
          </Button>
        </div>
      </div>
    </div>
  );
}
