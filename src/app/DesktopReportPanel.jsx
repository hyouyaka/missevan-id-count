import { useMemo, useRef, useState } from "react";
import { FileSpreadsheetIcon, FolderOpenIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buildReportWorkbook, createEmptyGroupedRows, getOutputSheetName, parseTemplateWorkbook } from "@/services/excelReport";
import { isMainEpisode, isMemberEpisode, isPaidEpisode } from "@/utils/episodeRules";
import { getBackendVersionFromResponse, normalizeVersion } from "@/app/app-utils";

function createDefaultState() {
  return {
    selectedFilePath: "",
    parsedRows: [],
    parseErrors: [],
    progress: 0,
    currentAction: "",
    isRunning: false,
    failures: [],
    savePath: "",
  };
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function formatCount(value) {
  return `${Math.max(0, Math.trunc(normalizeNumber(value, 0)))}`;
}

function formatWan(value) {
  return (normalizeNumber(value, 0) / 10000).toFixed(1);
}

function formatPriceValue(value) {
  const amount = normalizeNumber(value, 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "0";
  }
  return `${Math.round(amount * 100) / 100}`.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatRevenueWanYuan(value) {
  return (normalizeNumber(value, 0) / 10000).toFixed(1);
}

function formatRevenueRange(minValue, maxValue) {
  return `${formatRevenueWanYuan(minValue)} - ${formatRevenueWanYuan(maxValue)}`;
}

function formatSeriesTitle(title, totalCount) {
  const normalizedTitle = String(title ?? "").trim();
  const count = Math.max(1, Math.trunc(normalizeNumber(totalCount, 1)));
  if (!normalizedTitle) {
    return `未命名作品（${count}）`;
  }
  if (/[（(]\d+[）)]\s*$/.test(normalizedTitle)) {
    return normalizedTitle.replace(/[（(]\d+[）)]\s*$/, `（${count}）`);
  }
  return `${normalizedTitle}（${count}）`;
}

function sortResults(rows) {
  return [...rows]
    .sort((left, right) => {
      const leftFailed = left.__status !== "success";
      const rightFailed = right.__status !== "success";
      if (leftFailed !== rightFailed) {
        return leftFailed ? 1 : -1;
      }
      return normalizeNumber(right.__sortViewCount, 0) - normalizeNumber(left.__sortViewCount, 0);
    })
    .map((row, index) => ({
      ...row,
      排行: `${index + 1}`,
    }));
}

export function DesktopReportPanel({ handleVersionResponse }) {
  const [state, setState] = useState(createDefaultState());
  const cachesRef = useRef({
    dramaCache: {
      missevan: new Map(),
      manbo: new Map(),
    },
    rewardCache: new Map(),
    rewardMetaCache: new Map(),
    danmakuCache: {
      missevan: new Map(),
      manbo: new Map(),
    },
  });

  const summaryRows = useMemo(() => {
    const counters = new Map();
    state.parsedRows.forEach((row) => {
      const label = `${row.platform === "missevan" ? "猫耳" : "漫播"} / ${
        row.category === "paid" ? "付费" : row.category === "member" ? "会员" : "免费"
      }`;
      counters.set(label, (counters.get(label) || 0) + 1);
    });
    return Array.from(counters.entries()).map(([label, count]) => ({ label, count }));
  }, [state.parsedRows]);

  const allFailures = useMemo(
    () => [
      ...state.parseErrors.map((item) => ({
        ...item,
        platformLabel: item.platform === "missevan" ? "猫耳" : "漫播",
        sheetLabel: "模板解析",
      })),
      ...state.failures,
    ],
    [state.parseErrors, state.failures]
  );

  function getDesktopApi() {
    return typeof window !== "undefined" ? window.desktopExcel : null;
  }

  async function parseVersionedJson(response) {
    const data = await response.json();
    handleVersionResponse?.({
      backendVersion: getBackendVersionFromResponse(response, data),
    });
    return data;
  }

  async function postJson(url, payload, signal, errorMessage) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      throw new Error(`${errorMessage}: ${response.status}`);
    }
    return parseVersionedJson(response);
  }

  function getDramaEndpoint(platform) {
    return platform === "missevan" ? "/getdramas" : "/manbo/getdramas";
  }

  function getDanmakuEndpoint(platform) {
    return platform === "missevan" ? "/getsounddanmaku" : "/manbo/getsetdanmaku";
  }

  async function fetchDrama(platform, dramaId, signal) {
    const cache = cachesRef.current.dramaCache[platform];
    const key = String(dramaId);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const payload = { drama_ids: [platform === "missevan" ? Number(dramaId) : String(dramaId)] };
    const response = await postJson(getDramaEndpoint(platform), payload, signal, "Failed to load drama");
    const result = Array.isArray(response) ? response[0] : null;
    if (!result?.success || !result?.info) {
      throw new Error(`作品读取失败: ${dramaId}`);
    }
    cache.set(key, result.info);
    return result.info;
  }

  async function fetchRewardSummary(dramaId, signal) {
    const key = String(dramaId);
    if (cachesRef.current.rewardCache.has(key)) {
      return cachesRef.current.rewardCache.get(key);
    }
    const result = await postJson("/getrewardsummary", { drama_id: Number(dramaId) }, signal, "Failed to load reward summary");
    if (!result?.success) {
      throw new Error(`打赏信息读取失败: ${dramaId}`);
    }
    cachesRef.current.rewardCache.set(key, result);
    return result;
  }

  async function fetchRewardMeta(dramaId, signal) {
    const key = String(dramaId);
    if (cachesRef.current.rewardMetaCache.has(key)) {
      return cachesRef.current.rewardMetaCache.get(key);
    }
    const result = await postJson("/getrewardmeta", { drama_id: Number(dramaId) }, signal, "Failed to load reward meta");
    if (!result?.success) {
      throw new Error(`打赏人数读取失败: ${dramaId}`);
    }
    cachesRef.current.rewardMetaCache.set(key, result);
    return result;
  }

  async function fetchDanmakuUsers(platform, episodeId, dramaTitle, episodeTitle, signal) {
    const cache = cachesRef.current.danmakuCache[platform];
    const key = String(episodeId);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = await postJson(
      getDanmakuEndpoint(platform),
      { sound_id: episodeId, drama_title: dramaTitle, episode_title: episodeTitle || "" },
      signal,
      "Failed to load danmaku"
    );
    if (!result?.success) {
      throw new Error(`弹幕统计失败: ${episodeId}`);
    }
    const normalized = Array.isArray(result.users) ? result.users.map((item) => String(item)) : [];
    cache.set(key, normalized);
    return normalized;
  }

  function getEpisodesForRow(platform, category, dramaInfo) {
    const episodes = Array.isArray(dramaInfo?.episodes?.episode) ? dramaInfo.episodes.episode : [];
    if (category === "free") {
      return episodes.filter((episode) => isMainEpisode(platform, episode));
    }
    if (category === "member") {
      return episodes.filter((episode) => isMemberEpisode(platform, episode));
    }
    return episodes.filter((episode) => isPaidEpisode(platform, episode));
  }

  function buildUniqueUsers(collections) {
    const set = new Set();
    collections.forEach((users) => {
      users.forEach((uid) => set.add(String(uid)));
    });
    return set;
  }

  async function buildDramaMetrics(row, dramaInfo, signal) {
    const platform = row.platform;
    const drama = dramaInfo?.drama || {};
    const selectedEpisodes = getEpisodesForRow(platform, row.category, dramaInfo);
    const episodeUserEntries = [];
    for (const episode of selectedEpisodes) {
      const users = await fetchDanmakuUsers(platform, episode.sound_id, drama.name, episode.name, signal);
      episodeUserEntries.push({ episode, users });
    }

    const allUsers = buildUniqueUsers(episodeUserEntries.map((item) => item.users));
    const firstUsers = new Set(episodeUserEntries[0]?.users || []);
    const totalEpisodePrice = episodeUserEntries.reduce((sum, item) => sum + normalizeNumber(item.episode?.price ?? 0, 0), 0);

    const result = {
      dramaId: String(drama.id),
      dramaTitle: drama.name || row.title,
      viewCount: normalizeNumber(drama.view_count, 0),
      subscriptionCount: normalizeNumber(drama.subscription_num, 0),
      rewardTotal: 0,
      rewardCount: 0,
      giftTotal: normalizeNumber(drama.diamond_value, 0),
      allUsers,
      firstUsers,
      totalEpisodePrice,
      seasonPrice: normalizeNumber(drama.price, 0),
      memberPrice: normalizeNumber(drama.member_price, 0),
      episodeUsers: episodeUserEntries,
    };

    if (platform === "missevan") {
      const rewardSummary = await fetchRewardSummary(drama.id, signal);
      const rewardMeta = await fetchRewardMeta(drama.id, signal);
      result.rewardTotal = normalizeNumber(rewardSummary.rewardCoinTotal, 0);
      result.rewardCount = normalizeNumber(rewardMeta.reward_num, 0);
    }

    return result;
  }

  function buildFailureRow(row, errorMessage) {
    const isMissevan = row.platform === "missevan";
    const common = {
      排行: "",
      标题: row.title,
      "总播放量（万）": "失败",
      __status: "failed",
      __sortViewCount: -1,
    };

    if (row.category === "free") {
      return {
        ...common,
        "全季ID（正片）": "失败",
        "第一季ID（正片）": "失败",
        [isMissevan ? "追剧人次" : "收藏数"]: "失败",
      };
    }

    if (isMissevan) {
      return {
        ...common,
        "全季ID": "失败",
        "第一季ID": "失败",
        "追剧人次": "失败",
        "打赏（万钻石）": "失败",
        "打赏人次": "失败",
        ...(row.category === "paid" ? { "最低收益（万元）": "失败" } : {}),
        "总价（钻石）": errorMessage || "失败",
      };
    }

    return {
      ...common,
      "全季ID": "失败",
      "第一季ID": "失败",
      "收藏人次": "失败",
      "投喂（万红豆）": "失败",
      ...(row.category === "paid" ? { "最低收益（万元）": "失败", "总价（红豆）": errorMessage || "失败" } : {}),
    };
  }

  async function buildRowResult(row, signal) {
    const successes = [];
    const errors = [];

    for (const dramaId of row.dramaIds) {
      try {
        const dramaInfo = await fetchDrama(row.platform, dramaId, signal);
        successes.push(await buildDramaMetrics(row, dramaInfo, signal));
      } catch (error) {
        errors.push({
          dramaId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!successes.length) {
      throw new Error(errors.map((item) => `${item.dramaId}: ${item.error}`).join(" | "));
    }

    const isMissevan = row.platform === "missevan";
    const uniqueAllUsers = buildUniqueUsers(successes.map((item) => [...item.allUsers]));
    const firstDramaUsers = successes.find((item) => item.dramaId === String(row.dramaIds[0]))?.allUsers || new Set();
    const totalViewCount = successes.reduce((sum, item) => sum + item.viewCount, 0);
    const totalSubscriptionCount = successes.reduce((sum, item) => sum + item.subscriptionCount, 0);
    const totalReward = successes.reduce((sum, item) => sum + item.rewardTotal, 0);
    const totalRewardCount = successes.reduce((sum, item) => sum + item.rewardCount, 0);
    const totalGift = successes.reduce((sum, item) => sum + item.giftTotal, 0);
    const title = formatSeriesTitle(row.title, row.dramaIds.length);
    const partial = errors.length > 0;

    if (row.category === "free") {
      return {
        row: {
          排行: "",
          标题: title,
          "总播放量（万）": formatWan(totalViewCount),
          "全季ID（正片）": formatCount(uniqueAllUsers.size),
          "第一季ID（正片）": formatCount(firstDramaUsers.size),
          [isMissevan ? "追剧人次" : "收藏数"]: formatCount(totalSubscriptionCount),
          __status: partial ? "partial" : "success",
          __sortViewCount: totalViewCount,
        },
        failures: errors,
      };
    }

    const normalPriceTotal = successes.reduce(
      (sum, item) => sum + (row.paymentMode === "season" || row.category === "member" ? item.seasonPrice : item.totalEpisodePrice),
      0
    );
    const memberPriceTotal = successes.reduce((sum, item) => sum + item.memberPrice, 0);
    let revenueText = null;

    if (row.category === "paid") {
      if (row.paymentMode === "season") {
        const seasonRevenueYuan = successes.reduce((sum, item) => {
          const bonus = isMissevan ? item.rewardTotal : item.giftTotal;
          const divisorBase = isMissevan ? 10 : 100;
          return sum + ((item.allUsers.size * item.seasonPrice) + bonus) / divisorBase;
        }, 0);
        revenueText = formatRevenueWanYuan(seasonRevenueYuan);
      } else {
        const range = successes.reduce(
          (acc, item) => {
            const bonus = isMissevan ? item.rewardTotal : item.giftTotal;
            const divisorBase = isMissevan ? 10 : 100;
            const low = item.episodeUsers.reduce((sum, entry) => sum + entry.users.length * normalizeNumber(entry.episode?.price, 0), 0);
            acc.min += (low + bonus) / divisorBase;
            acc.max += ((item.allUsers.size * item.totalEpisodePrice) + bonus) / divisorBase;
            return acc;
          },
          { min: 0, max: 0 }
        );
        revenueText = formatRevenueRange(range.min, range.max);
      }
    }

    if (isMissevan) {
      return {
        row: {
          排行: "",
          标题: title,
          "总播放量（万）": formatWan(totalViewCount),
          "全季ID": formatCount(uniqueAllUsers.size),
          "第一季ID": formatCount(firstDramaUsers.size),
          "追剧人次": formatCount(totalSubscriptionCount),
          "打赏（万钻石）": formatWan(totalReward),
          "打赏人次": formatCount(totalRewardCount),
          ...(row.category === "paid" ? { "最低收益（万元）": revenueText } : {}),
          "总价（钻石）":
            row.category === "member"
              ? `${formatPriceValue(normalPriceTotal)}/${formatPriceValue(memberPriceTotal)}`
              : formatPriceValue(normalPriceTotal),
          __status: partial ? "partial" : "success",
          __sortViewCount: totalViewCount,
        },
        failures: errors,
      };
    }

    return {
      row: {
        排行: "",
        标题: title,
        "总播放量（万）": formatWan(totalViewCount),
        "全季ID": formatCount(uniqueAllUsers.size),
        "第一季ID": formatCount(firstDramaUsers.size),
        "收藏人次": formatCount(totalSubscriptionCount),
        "投喂（万红豆）": formatWan(totalGift),
        ...(row.category === "paid"
          ? {
              "最低收益（万元）": revenueText,
              "总价（红豆）": formatPriceValue(normalPriceTotal),
            }
          : {}),
        __status: partial ? "partial" : "success",
        __sortViewCount: totalViewCount,
      },
      failures: errors,
    };
  }

  function addFailureRecord(row, error, dramaIds = "") {
    setState((current) => ({
      ...current,
      failures: [
        ...current.failures,
        {
          platform: row.platform,
          platformLabel: row.platform === "missevan" ? "猫耳" : "漫播",
          sheetLabel: getOutputSheetName(row.platform, row.category),
          title: row.title,
          dramaIds,
          error,
        },
      ],
    }));
  }

  async function pickTemplate() {
    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      toast.error("该功能仅支持桌面版。");
      return;
    }

    const picked = await desktopApi.pickInputWorkbook();
    if (picked?.canceled || !picked?.filePath) {
      return;
    }

    setState((current) => ({ ...current, currentAction: "正在读取模板" }));
    const fileResult = await desktopApi.readFile(picked.filePath);
    if (!fileResult?.success || !fileResult?.bytes) {
      setState((current) => ({ ...current, currentAction: "模板读取失败" }));
      toast.error(fileResult?.error || "读取模板失败");
      return;
    }

    try {
      const parsed = await parseTemplateWorkbook(fileResult.bytes);
      setState((current) => ({
        ...current,
        selectedFilePath: picked.filePath,
        parsedRows: parsed.rows,
        parseErrors: parsed.parseErrors,
        failures: [],
        savePath: "",
        progress: 0,
        currentAction: parsed.rows.length > 0 ? "模板读取完成" : "模板中没有可处理的数据行",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        selectedFilePath: "",
        parsedRows: [],
        parseErrors: [],
        failures: [],
        savePath: "",
        progress: 0,
        currentAction: "模板解析失败",
      }));
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateReport() {
    const desktopApi = getDesktopApi();
    if (!desktopApi || state.isRunning || !state.parsedRows.length) {
      return;
    }

    const saveSelection = await desktopApi.pickSaveWorkbook("猫耳漫播统计报告.xlsx");
    if (saveSelection?.canceled || !saveSelection?.filePath) {
      return;
    }

    setState((current) => ({
      ...current,
      isRunning: true,
      progress: 0,
      currentAction: "开始生成报表",
      failures: [],
    }));

    const groupedRows = createEmptyGroupedRows();
    const controller = new AbortController();

    try {
      for (let index = 0; index < state.parsedRows.length; index += 1) {
        const row = state.parsedRows[index];
        setState((current) => ({ ...current, currentAction: `正在统计 ${row.title}` }));
        try {
          const result = await buildRowResult(row, controller.signal);
          groupedRows[row.platform][row.category].push(result.row);
          result.failures.forEach((item) => {
            addFailureRecord(row, item.error, item.dramaId);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          groupedRows[row.platform][row.category].push(buildFailureRow(row, message));
          addFailureRecord(row, message, row.dramaIds.join(", "));
        }
        setState((current) => ({
          ...current,
          progress: Math.floor(((index + 1) / state.parsedRows.length) * 100),
        }));
      }

      Object.keys(groupedRows).forEach((platform) => {
        Object.keys(groupedRows[platform]).forEach((category) => {
          groupedRows[platform][category] = sortResults(groupedRows[platform][category]);
        });
      });

      setState((current) => ({ ...current, currentAction: "正在写入 Excel 报告" }));
      const bytes = await buildReportWorkbook(groupedRows);
      const writeResult = await desktopApi.writeFile(saveSelection.filePath, bytes);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || "写入 Excel 失败");
      }

      setState((current) => ({
        ...current,
        savePath: saveSelection.filePath,
        currentAction: "报表生成完成",
        isRunning: false,
      }));
      const openResult = await desktopApi.openFile(saveSelection.filePath);
      if (!openResult?.success && openResult?.error) {
        console.warn("Failed to open exported workbook", openResult.error);
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        currentAction: "报表生成失败",
        isRunning: false,
      }));
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setState((current) => ({ ...current, isRunning: false }));
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="border-white/55 bg-[linear-gradient(180deg,rgba(255,252,247,0.96),rgba(243,241,251,0.64))] shadow-lg shadow-[0_16px_34px_-26px_rgba(30,32,41,0.14)]">
        <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Desktop Excel
            </div>
            <div className="text-2xl font-semibold">模板导入与报表生成</div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              读取 `Missevan` 与 `Manbo` 工作表，自动统计并导出六个报表 sheet。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-11 rounded-xl px-5" disabled={state.isRunning} onClick={pickTemplate}>
              <FolderOpenIcon data-icon="inline-start" />
              选择 Excel 模板
            </Button>
            <Button
              className="h-11 rounded-xl px-5"
              disabled={state.isRunning || !state.parsedRows.length || !state.selectedFilePath}
              onClick={generateReport}
            >
              <SaveIcon data-icon="inline-start" />
              生成 Excel 报告
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/55 bg-[rgba(255,252,247,0.94)] shadow-lg shadow-[0_16px_34px_-26px_rgba(30,32,41,0.14)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">当前模板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="break-all">{state.selectedFilePath || "还没有选择文件"}</div>
            <div className="text-muted-foreground">有效数据行：{state.parsedRows.length}，解析失败：{state.parseErrors.length}</div>
            {state.savePath ? <div className="text-muted-foreground">最近保存：{state.savePath}</div> : null}
          </CardContent>
        </Card>

        <Card className="border-[rgba(59,62,122,0.2)] bg-[rgba(59,62,122,0.95)] text-white shadow-lg shadow-[0_16px_34px_-26px_rgba(59,62,122,0.34)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">运行状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-lg font-semibold">{state.currentAction || "等待选择模板"}</div>
            <div className="text-sm text-white/72">进度：{state.progress}%</div>
            <Progress value={state.progress} className="h-2.5 rounded-full bg-white/18" indicatorClassName="bg-[rgba(255,245,236,0.96)]" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-[rgba(239,131,95,0.22)] bg-[rgba(255,240,233,0.8)] shadow-lg shadow-[0_16px_34px_-26px_rgba(30,32,41,0.14)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">输入概览</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryRows.length ? (
              <div className="grid gap-3">
                {summaryRows.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-[rgba(59,62,122,0.18)] bg-[rgba(243,241,251,0.82)] px-4 py-3">
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm leading-6 text-muted-foreground">选择模板后会在这里展示各分类行数。</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[rgba(30,32,41,0.1)] bg-[rgba(255,252,247,0.94)] shadow-lg shadow-[0_16px_34px_-26px_rgba(30,32,41,0.14)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">失败明细</CardTitle>
          </CardHeader>
          <CardContent>
            {allFailures.length ? (
              <div className="grid gap-3">
                {allFailures.map((item, index) => (
                  <Alert key={`${item.title}-${index}`} className="border-[rgba(239,131,95,0.24)] bg-[rgba(255,240,233,0.9)]">
                    <FileSpreadsheetIcon className="size-4" />
                    <AlertTitle>{item.platformLabel} / {item.sheetLabel} / {item.title}</AlertTitle>
                    <AlertDescription className="grid gap-1 leading-6">
                      <span>{item.error}</span>
                      {item.dramaIds ? <span>ID: {item.dramaIds}</span> : null}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : (
              <div className="text-sm leading-6 text-muted-foreground">当前没有失败项。</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
