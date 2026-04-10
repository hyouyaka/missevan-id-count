import { useState } from "react";
import { SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  normalizeVersion,
  parseNumericIds,
  parseRawItems,
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
  onNotice,
}) {
  const [isSearchPending, setIsSearchPending] = useState(false);
  const [isManualPending, setIsManualPending] = useState(false);
  const manualPlaceholder =
    platform === "manbo"
      ? "可混合输入多个作品 ID、分集 ID、网页链接或分享链接，支持空格、逗号或换行分隔"
      : "输入一个或多个作品 ID，支持英文逗号、中文逗号、空格或换行分隔";

  function setKeyword(value) {
    onUpdateFormState?.({ keyword: value });
  }

  function setManualInput(value) {
    onUpdateFormState?.({ manualInput: value });
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

  async function search() {
    if (isSearchPending) {
      return;
    }

    const keyword = String(formState?.keyword ?? "").trim();
    if (!keyword) {
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
            `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=0&limit=5`,
            frontendVersion
          )
        );
        const data = await parseVersionedJson(response);
        onUpdateResults?.(
          Array.isArray(data.results) ? data.results : [],
          "search",
          data.meta || {}
        );
        if (!data.success) {
          showBlockingNotice(
            Number(data?.meta?.matchedCount ?? 0) > 0 ? "漫播信息库搜索未完全命中" : "",
            Number(data?.meta?.matchedCount ?? 0) > 0
              ? "信息库有记录，但拉取漫播详情失败，请稍后重试或手动导入。"
              : "未找到相关剧集"
          );
        }
        return;
      }

      const response = await fetch(
        buildVersionedUrl(
          `/search?keyword=${encodeURIComponent(keyword)}&offset=0&limit=5`,
          frontendVersion
        )
      );
      const data = await parseVersionedJson(response);
      if (data.success) {
        onUpdateResults?.(data.results, "search", data.meta || {});
        return;
      }
      if (data.accessDenied) {
        const config = await fetchAppConfig();
        if (isDesktopApp) {
          showBlockingNotice(
            "Missevan 当前受限",
            "如果看到访问受限，请先使用任意浏览器打开猫耳主页完成验证后再重试。"
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

  async function queryManbo(rawItems) {
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
        showBlockingNotice("Manbo 导入失败", "请检查输入内容是否为有效的作品 ID、分集 ID 或链接。");
        return;
      }

      onUpdateResults?.(data.results, "manual");
      if (data.failedItems?.length) {
        toast.warning(`以下内容解析失败：${data.failedItems.join(" | ")}`);
      }
    } catch (error) {
      console.error(error);
      showBlockingNotice("分享链接解析失败", "分享链接解析失败，或 Manbo 导入失败，请改用作品或分集链接再试。");
    }
  }

  async function queryManualInput() {
    if (isManualPending) {
      return;
    }

    if (platform === "missevan" && !isDesktopApp && Number(cooldownUntil ?? 0) > Date.now()) {
      await logMissevanCooldownBlocked("manual_import", {
        manualInputCount: parseNumericIds(formState?.manualInput).length,
      });
      showMissevanCooldownNotice();
      return;
    }

    setIsManualPending(true);

    try {
      if (platform === "manbo") {
        const rawItems = parseRawItems(formState?.manualInput);
        if (!rawItems.length) {
          showBlockingNotice("缺少导入内容", "请至少输入一个有效的 Manbo ID 或链接。");
          return;
        }
        onResetState?.();
        await queryManbo(rawItems);
        return;
      }

      const ids = parseNumericIds(formState?.manualInput);
      if (!ids.length) {
        showBlockingNotice("缺少作品 ID", "请至少输入一个有效的作品 ID。");
        return;
      }

      onResetState?.();
      const response = await fetch(buildVersionedUrl("/getdramacards", frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drama_ids: ids }),
      });
      const data = await parseVersionedJson(response);

      if (!data.success) {
        if (data.accessDenied) {
          const config = await fetchAppConfig();
          if (isDesktopApp) {
            showBlockingNotice(
              "Missevan 当前受限",
              "如果看到访问受限，请先使用任意浏览器打开猫耳主页完成验证后再重试。"
            );
          } else {
            showMissevanCooldownNotice(config || { cooldownHours, cooldownUntil });
          }
          return;
        }
        showBlockingNotice("导入作品失败", "请检查输入的作品 ID。");
        return;
      }

      onUpdateResults?.(data.results, "manual");
      if (data.failedIds?.length) {
        toast.warning(`以下作品 ID 导入失败：${data.failedIds.join(", ")}`);
      }
    } catch (error) {
      console.error(error);
      showBlockingNotice("导入失败", "导入作品失败，请稍后重试。");
    } finally {
      setIsManualPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="bg-[rgba(255,252,247,0.98)] shadow-[0_20px_40px_-30px_rgba(30,32,41,0.14)]">
        <CardHeader className="gap-1 border-b border-border/70 pb-4">
          <CardTitle className="text-base">搜索</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row">
          <Input
            className="h-11 border-border/80 bg-background/82 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={
              platform === "missevan"
                ? "输入作品名、CV、角色名、原作名或关键词"
                : "输入剧名、CV、角色名、原作名或 Drama ID"
            }
            value={formState?.keyword ?? ""}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && search()}
          />
          <Button className="h-11 px-5" disabled={isSearchPending} onClick={search}>
            <SearchIcon data-icon="inline-start" />
            {isSearchPending ? "搜索中" : "搜索"}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-[rgba(255,252,247,0.98)] shadow-[0_20px_40px_-30px_rgba(30,32,41,0.14)]">
        <CardHeader className="gap-1 border-b border-border/70 pb-4">
          <CardTitle className="text-base">手动导入</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-start">
          <Textarea
            className="min-h-24 flex-1 border-border/80 bg-background/82 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={manualPlaceholder}
            value={formState?.manualInput ?? ""}
            onChange={(event) => setManualInput(event.target.value)}
          />
          <div className="flex flex-col gap-3 sm:w-auto sm:min-w-[7rem]">
            <Button className="h-11 px-5" disabled={isManualPending} onClick={queryManualInput}>
              <UploadIcon data-icon="inline-start" />
              {isManualPending ? "导入中" : "导入"}
            </Button>
            <Button variant="secondary" className="h-11 px-5" onClick={clearManualInput}>
              <Trash2Icon data-icon="inline-start" />
              清空
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
