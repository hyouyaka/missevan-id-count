import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchSuggestionKeyword } from "../../shared/searchSuggestionUtils.js";
import { buildVersionedUrl, getBackendVersionFromResponse, normalizeVersion } from "@/app/app-utils";

export function useSearchSuggestions({ keyword, enabled, frontendVersion, handleVersionResponse }) {
  const [active, setActive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState({ keyword: "", revision: -1, items: [] });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const requestRef = useRef({ generation: 0, controller: null });
  const versionHandlerRef = useRef(handleVersionResponse);
  useEffect(() => { versionHandlerRef.current = handleVersionResponse; }, [handleVersionResponse]);

  const invalidate = useCallback(() => {
    requestRef.current.generation += 1;
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
    setResult({ keyword: "", revision: -1, items: [] });
    setSelectedIndex(-1);
  }, []);
  const close = useCallback(() => {
    invalidate();
    setActive(false);
  }, [invalidate]);
  const activate = useCallback(() => {
    invalidate();
    setActive(true);
    setRevision((current) => current + 1);
  }, [invalidate]);
  const startComposition = useCallback(() => {
    invalidate();
    setComposing(true);
  }, [invalidate]);
  const endComposition = useCallback(() => {
    setComposing(false);
    activate();
  }, [activate]);

  useEffect(() => {
    if (!enabled) close();
  }, [close, enabled]);

  const query = getSearchSuggestionKeyword(keyword);
  useEffect(() => {
    const generation = ++requestRef.current.generation;
    if (!enabled || !active || composing || !query) return;
    const controller = new AbortController();
    requestRef.current.controller = controller;
    let timeout;
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(buildVersionedUrl(
          `/search-suggestions?keyword=${encodeURIComponent(query)}`, frontendVersion
        ), { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestions unavailable");
        const data = await response.json();
        if (controller.signal.aborted || generation !== requestRef.current.generation) return;
        versionHandlerRef.current?.({
          frontendVersion: normalizeVersion(frontendVersion),
          backendVersion: getBackendVersionFromResponse(response, data),
        });
        setResult({ keyword: query, revision, items: Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 5) : [] });
        setSelectedIndex(-1);
      } catch (_) {
        if (generation === requestRef.current.generation) setResult({ keyword: "", revision: -1, items: [] });
      } finally {
        clearTimeout(timeout);
      }
    }, 250);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [active, composing, enabled, frontendVersion, query, revision]);

  const items = enabled && active && !composing && result.keyword === query && result.revision === revision
    ? result.items : [];
  function moveSelection(direction) {
    if (!items.length) return;
    setSelectedIndex((current) => current < 0
      ? direction > 0 ? 0 : items.length - 1
      : Math.max(0, Math.min(items.length - 1, current + direction)));
  }
  return { items, selectedIndex, moveSelection, activate, close, startComposition, endComposition };
}
