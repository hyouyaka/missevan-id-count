import { useRef, useState } from "react";
import { toast } from "sonner";

import { getCompareItemKey, MAX_COMPARE_ITEMS } from "@/app/dramaCompareUtils";

export function useDramaCompare() {
  const [compareItems, setCompareItems] = useState([]);
  const compareItemsRef = useRef([]);
  const [compareBasketOpen, setCompareBasketOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);

  function commitCompareItems(nextItems) {
    compareItemsRef.current = nextItems;
    setCompareItems(nextItems);
  }

  function addDramaToCompareBasket(rawItem) {
    const compareKind = String(rawItem?.compareKind ?? "drama").trim() || "drama";
    const rawTitle = String(rawItem?.title ?? rawItem?.name ?? "").trim() || "未命名剧集";
    const normalized = {
      compareKind,
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
    const current = compareItemsRef.current;
    if (normalized.compareKind === "peak_series" && current.some((item) => item.compareKind !== normalized.compareKind)) {
      toast.warning("巅峰榜系列只能和其他巅峰榜系列对比。");
      return;
    }
    if (normalized.compareKind !== "peak_series" && current.some((item) => item.compareKind === "peak_series")) {
      toast.warning("普通剧集不能和巅峰榜系列混合对比。");
      return;
    }
    if (current.some((item) => item.key === key)) {
      toast.info("已在对比中。");
      return;
    }
    if (current.length >= MAX_COMPARE_ITEMS) {
      toast.warning(`对比最多添加 ${MAX_COMPARE_ITEMS} 部剧集。`);
      return;
    }
    toast.success("已加入对比。");
    commitCompareItems([...current, { ...normalized, key }]);
  }

  function canAddDramaToCompareBasket(rawItem) {
    const compareKind = String(rawItem?.compareKind ?? "drama").trim() || "drama";
    const platform = String(rawItem?.platform ?? "").trim();
    const id = String(rawItem?.id ?? rawItem?.dramaId ?? rawItem?.trendLookupId ?? "").trim();
    const current = compareItemsRef.current;
    if (!platform || !id || current.length >= MAX_COMPARE_ITEMS) {
      return false;
    }
    if (compareKind === "peak_series" && current.some((item) => item.compareKind !== compareKind)) {
      return false;
    }
    if (compareKind !== "peak_series" && current.some((item) => item.compareKind === "peak_series")) {
      return false;
    }
    return !current.some((item) => item.key === getCompareItemKey({ compareKind, platform, id }));
  }

  function removeDramaFromCompareBasket(key) {
    commitCompareItems(compareItemsRef.current.filter((item) => item.key !== key));
  }

  function clearCompareBasket() {
    commitCompareItems([]);
    setCompareBasketOpen(false);
    setCompareDialogOpen(false);
  }

  function openCompareDialog() {
    setCompareDialogOpen(true);
  }

  return {
    addDramaToCompareBasket,
    canAddDramaToCompareBasket,
    clearCompareBasket,
    compareBasketOpen,
    compareDialogOpen,
    compareItems,
    openCompareDialog,
    removeDramaFromCompareBasket,
    setCompareBasketOpen,
    setCompareDialogOpen,
  };
}
