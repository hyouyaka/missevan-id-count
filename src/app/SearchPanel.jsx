import { useState } from "react";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  buildVersionedUrl,
  classifyMergedSearchInput,
  getBackendVersionFromResponse,
  normalizeVersion,
  parseRawItems,
  shouldUseManboLibraryFallbackForMissevanSearch,
} from "@/app/app-utils";
import { canParseShareUrl, decryptShareUrl, extractResolvedId } from "@/utils/manboCrypto";

export function SearchPanel({
  platform = "missevan",
  formState,
  isDesktopApp,
  cooldownHours,
  cooldownUntil,
  desktopAppUrl,
  frontendVersion,
  handleVersionResponse,
  onUpdateFormState,
  onResetState,
  onUpdateResults,
  onCrossPlatformImport,
  onMissevanFallbackResults,
  onManboFallbackResults,
  onNotice,
}) {
  const [isSearchPending, setIsSearchPending] = useState(false);
  const [isManualPending, setIsManualPending] = useState(false);
  const isPending = isSearchPending || isManualPending;
  const mergedPlaceholder =
    platform === "manbo"
      ? "输入剧名、CV、角色名、原作名，或粘贴作品ID、分集 ID、网页链接 / 分享链接"
      : "输入作品名、CV、角色名、原作名，或粘贴作品ID、分集ID、作品链接 / 分集链接";

  function setKeyword(value) {
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

  async function logMissevanCooldownBlocked(action, extra = {}) {
    try {
      await fetch(buildVersionedUrl("/usage-log", frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "missevan",
          action,
          accessDenied: true,
          success: false,
          error: "ACCESS_DENIED_COOLDOWN:frontend_precheck",
          cooldownUntil: Number(cooldownUntil ?? 0) || 0,
          ...extra,
        }),
      });
    } catch (error) {
      console.error("Failed to log frontend cooldown block", error);
    }
  }

  function clearManualInput() {
    onUpdateFormState?.({
      keyword: "",
      manualInput: "",
    });
  }

  function showKeywordTooShortNotice() {
    showBlockingNotice("关键词太短", "关键词太短，请至少输入 2 个汉字，或 3 位字母/数字。");
  }

  function buildSearchPath(targetPlatform, keyword, options = {}) {
    const offset = Number(options.offset ?? 0) || 0;
    const limit = Number(options.limit ?? 5) || 5;
    const basePath =
      targetPlatform === "manbo"
        ? `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${limit}`
        : `/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${limit}`;
    if (targetPlatform === "missevan" && options.apiFallback === false && (!isDesktopApp || options.localOnly === true)) {
      return `${basePath}&apiFallback=0`;
    }
    if (targetPlatform === "manbo" && options.apiFallback === false) {
      return `${basePath}&apiFallback=0`;
    }
    return basePath;
  }

  async function queryNumericLibraryLookup(keyword) {
    if (isSearchPending) {
      return { handled: true, matched: false };
    }

    if (platform === "missevan" && !isDesktopApp && Number(cooldownUntil ?? 0) > Date.now()) {
      await logMissevanCooldownBlocked("search", { keyword });
      showMissevanCooldownNotice();
      return { handled: true, matched: false };
    }

    onResetState?.();
    setIsSearchPending(true);

    try {
      const searchPath = buildSearchPath(platform, keyword, { apiFallback: false });
      const response = await fetch(buildVersionedUrl(searchPath, frontendVersion));
      const data = await parseVersionedJson(response);
      const results = Array.isArray(data.results) ? data.results : [];
      const matchedCount = Number(data?.meta?.matchedCount ?? results.length);

      if (data?.meta?.keywordTooShort) {
        showKeywordTooShortNotice();
        return { handled: true, matched: false };
      }

      if (data?.success && matchedCount > 0 && results.length > 0) {
        onUpdateResults?.(results, "search", data.meta || {});
        return { handled: true, matched: true };
      }

      return { handled: false, matched: false };
    } catch (error) {
      console.error("Numeric library lookup failed", error);
      return { handled: false, matched: false };
    } finally {
      setIsSearchPending(false);
    }
  }

  async function queryKeywordSearch(keyword) {
    if (isSearchPending) {
      return;
    }

    if (platform === "missevan" && !isDesktopApp && Number(cooldownUntil ?? 0) > Date.now()) {
      await logMissevanCooldownBlocked("search", { keyword });
      showMissevanCooldownNotice();
      return;
    }

    onResetState?.();
    setIsSearchPending(true);

    try {
      if (platform === "manbo") {
        const response = await fetch(
          buildVersionedUrl(
            buildSearchPath("manbo", keyword),
            frontendVersion
          )
        );
        const data = await parseVersionedJson(response);
        const manboResults = Array.isArray(data.results) ? data.results : [];
        onUpdateResults?.(
          manboResults,
          "search",
          data.meta || {}
        );
        if (!data.success) {
          if (data?.meta?.keywordTooShort) {
            showKeywordTooShortNotice();
            return;
          }
          try {
            const fallbackResponse = await fetch(
              buildVersionedUrl(
                buildSearchPath("missevan", keyword, { apiFallback: false, localOnly: true }),
                frontendVersion
              )
            );
            const fallbackData = await parseVersionedJson(fallbackResponse);
            const fallbackResults = Array.isArray(fallbackData?.results) ? fallbackData.results : [];
            if (fallbackData?.success && fallbackResults.length > 0) {
              onMissevanFallbackResults?.({
                keyword,
                results: fallbackResults,
                meta: fallbackData.meta || {},
              });
              return;
            }
          } catch (fallbackError) {
            console.error("Missevan fallback search failed", fallbackError);
          }
          showBlockingNotice(
            Number(data?.meta?.matchedCount ?? 0) > 0 ? "漫播信息库搜索未完全命中" : "",
            Number(data?.meta?.matchedCount ?? 0) > 0
              ? "信息库有记录，但拉取漫播详情失败，请稍后重试或手动导入。"
              : "未找到剧集，可尝试导入剧集ID或分享链接"
          );
        }
        return;
      }

      const response = await fetch(
        buildVersionedUrl(
          buildSearchPath("missevan", keyword),
          frontendVersion
        )
      );
      const data = await parseVersionedJson(response);
      const missevanResults = Array.isArray(data.results) ? data.results : [];
      if (shouldUseManboLibraryFallbackForMissevanSearch(data, keyword)) {
        try {
          const fallbackResponse = await fetch(
            buildVersionedUrl(
              buildSearchPath("manbo", keyword, { apiFallback: false }),
              frontendVersion
            )
          );
          const fallbackData = await parseVersionedJson(fallbackResponse);
          const fallbackResults = Array.isArray(fallbackData?.results) ? fallbackData.results : [];
          if (fallbackData?.success && fallbackResults.length > 0) {
            onManboFallbackResults?.({
              keyword,
              results: fallbackResults,
              meta: fallbackData.meta || {},
            });
            return;
          }
        } catch (fallbackError) {
          console.error("Manbo fallback search failed", fallbackError);
        }
      }
      if (data.success) {
        onUpdateResults?.(missevanResults, "search", data.meta || {});
        return;
      }
      if (data?.meta?.keywordTooShort) {
        showKeywordTooShortNotice();
        return;
      }
      if (data.accessDenied) {
        const config = await fetchAppConfig();
        if (isDesktopApp) {
          showBlockingNotice(
            "Missevan 当前受限",
            "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
          );
        } else {
          showMissevanCooldownNotice(config || { cooldownHours, cooldownUntil });
        }
        return;
      }
      showBlockingNotice("搜索失败", data.message || "搜索失败或没有结果");
    } catch (error) {
      console.error(error);
      showBlockingNotice("搜索失败", "搜索失败，请稍后重试。");
    } finally {
      setIsSearchPending(false);
    }
  }

  async function queryManbo(rawItems, options = {}) {
    try {
      const items = await Promise.all(
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

      const response = await fetch(buildVersionedUrl("/manbo/getdramacards", frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await parseVersionedJson(response);

      if (!data.success) {
        if (!options.suppressFailureNotice) {
          showBlockingNotice("Manbo 导入失败", "请检查输入内容是否为有效的作品ID、分集 ID 或链接。");
        }
        return { success: false, data };
      }

      onUpdateResults?.(data.results, "manual");
      if (data.failedItems?.length) {
        toast.warning(`以下内容解析失败：${data.failedItems.join(" | ")}`);
      }
      return { success: true, data };
    } catch (error) {
      console.error(error);
      if (!options.suppressFailureNotice) {
        showBlockingNotice("分享链接解析失败", "分享链接解析失败，或 Manbo 导入失败，请改用作品或分集链接再试。");
      }
      return { success: false, error };
    }
  }

  async function queryManualInput(rawItemsOverride = null, options = {}) {
    if (isManualPending) {
      return;
    }

    const rawItems = Array.isArray(rawItemsOverride)
      ? rawItemsOverride
      : parseRawItems(formState?.keyword);

    if (platform === "missevan" && !isDesktopApp && Number(cooldownUntil ?? 0) > Date.now()) {
      await logMissevanCooldownBlocked("manual_import", {
        manualInputCount: rawItems.length,
      });
      showMissevanCooldownNotice();
      return;
    }

    setIsManualPending(true);

    try {
      if (platform === "manbo") {
        if (!rawItems.length) {
          showBlockingNotice("缺少导入内容", "请至少输入一个有效的 Manbo ID 或链接。");
          return;
        }
        onResetState?.();
        const manboResult = await queryManbo(rawItems, {
          suppressFailureNotice: false,
        });
        return;
      }

      if (!rawItems.length) {
        showBlockingNotice("缺少导入内容", "请至少输入一个有效的作品ID、作品链接或分集链接。");
        return;
      }

      onResetState?.();
      const response = await fetch(buildVersionedUrl("/getdramacards", frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rawItems.map((raw) => ({ raw })) }),
      });
      const data = await parseVersionedJson(response);

      if (!data.success) {
        if (data.accessDenied) {
          const config = await fetchAppConfig();
          if (isDesktopApp) {
            showBlockingNotice(
              "Missevan 当前受限",
              "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
            );
          } else {
            showMissevanCooldownNotice(config || { cooldownHours, cooldownUntil });
          }
          return;
        }
        const singleNumericRawItem =
          rawItems.length === 1 && /^\d+$/.test(String(rawItems[0] ?? "").trim())
            ? String(rawItems[0]).trim()
            : "";
        const emptyResultNotice =
          options?.emptyResultNotice || (singleNumericRawItem.length > 0 && singleNumericRawItem.length < 3 ? "short_keyword" : "");
        const allowMissevanApiFallback =
          options?.allowMissevanApiFallback ?? (singleNumericRawItem.length >= 3);

        if (emptyResultNotice === "short_keyword") {
          showKeywordTooShortNotice();
          return;
        }
        if (allowMissevanApiFallback && singleNumericRawItem) {
          await queryKeywordSearch(singleNumericRawItem);
          return;
        }

        showBlockingNotice("导入作品失败", "请检查输入的作品ID、作品链接或分集链接。");
        return;
      }

      onUpdateResults?.(data.results, "manual");
      if (data.failedItems?.length) {
        toast.warning(`以下内容导入失败：${data.failedItems.join(" | ")}`);
      } else if (data.failedIds?.length) {
        toast.warning(`以下作品ID导入失败：${data.failedIds.join(", ")}`);
      }
    } catch (error) {
      console.error(error);
      showBlockingNotice("导入失败", "导入作品失败，请稍后重试。");
    } finally {
      setIsManualPending(false);
    }
  }

  async function runMergedSearch() {
    if (isPending) {
      return;
    }

    const classified = classifyMergedSearchInput(formState?.keyword, platform);
    async function runClassifiedAction(nextClassified) {
      if (nextClassified.action === "import") {
        await queryManualInput(nextClassified.rawItems, nextClassified);
        return;
      }

      if (nextClassified.action === "cross_import") {
        await onCrossPlatformImport?.({
          targetPlatform: nextClassified.targetPlatform,
          rawItems: nextClassified.rawItems,
          sourcePlatform: platform,
          allowMissevanApiFallback: nextClassified.allowMissevanApiFallback,
          emptyResultNotice: nextClassified.emptyResultNotice,
        });
        return;
      }

      if (nextClassified.action === "keyword_too_short") {
        showKeywordTooShortNotice();
        return;
      }

      await queryKeywordSearch(nextClassified.keyword);
    }

    if (classified.action === "empty") {
      showBlockingNotice("缺少内容", "请输入关键词、作品ID、分集ID或链接。");
      return;
    }

    if (classified.action === "numeric_lookup") {
      const lookupResult = await queryNumericLibraryLookup(classified.keyword);
      if (lookupResult.handled) {
        return;
      }
      await runClassifiedAction(
        classifyMergedSearchInput(formState?.keyword, platform, { numericLookup: false })
      );
      return;
    }

    await runClassifiedAction(classified);
  }

  return (
    <Card className="border-border/80 bg-card shadow-[0_20px_46px_-38px_rgba(15,23,42,0.28)]">
      <CardContent className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_5.5rem] sm:p-5">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="text-base font-semibold text-foreground">搜索 / 导入</div>
          <Textarea
            className="h-20 min-h-20 max-h-20 min-w-0 resize-none overflow-y-auto border-border/80 bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
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
        </div>

        <div className="grid grid-cols-1 gap-1.5 pt-9">
          <Button className="h-9 gap-1 px-2 text-sm [&_svg:not([class*='size-'])]:size-3.5" disabled={isPending} onClick={runMergedSearch}>
            <SearchIcon data-icon="inline-start" />
            {isSearchPending ? "搜索中" : isManualPending ? "导入中" : "搜索"}
          </Button>
          <Button variant="secondary" className="h-9 gap-1 px-2 text-sm [&_svg:not([class*='size-'])]:size-3.5" onClick={clearManualInput}>
            <Trash2Icon data-icon="inline-start" />
            清空
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
