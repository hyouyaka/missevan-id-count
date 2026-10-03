import { getSearchSuggestionKeyword } from "../../shared/searchSuggestionUtils.js";

export function registerSearchSuggestionRoutes(app, { limiter, loadSources, service }) {
  app.get("/search-suggestions", limiter, async (req, res) => {
    if (req.query.keyword !== undefined && typeof req.query.keyword !== "string") {
      return res.status(400).json({ code: "INVALID_REQUEST_QUERY", suggestions: [] });
    }
    const keyword = getSearchSuggestionKeyword(req.query.keyword);
    if (!keyword) return res.json({ suggestions: [] });
    try {
      const sources = await loadSources();
      return res.json({ suggestions: service.search(keyword, sources) });
    } catch (_) {
      return res.status(503).json({ suggestions: [] });
    }
  });
}
