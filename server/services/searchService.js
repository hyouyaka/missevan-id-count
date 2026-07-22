export async function searchLibraryWithFallback({
  keyword,
  searchLibrary,
  searchApi,
  libraryOnly = false,
} = {}) {
  if (typeof searchLibrary !== "function") {
    throw new TypeError("Search service requires searchLibrary");
  }
  const strictItems = await searchLibrary(keyword, "strict");
  if (Array.isArray(strictItems) && strictItems.length > 0) {
    return { items: strictItems, source: "library-strict" };
  }
  const compatibleItems = await searchLibrary(keyword, "compatible");
  if (Array.isArray(compatibleItems) && compatibleItems.length > 0) {
    return { items: compatibleItems, source: "library-compatible" };
  }
  if (libraryOnly || typeof searchApi !== "function") {
    return { items: [], source: "library" };
  }
  const apiItems = await searchApi(keyword);
  return {
    items: Array.isArray(apiItems) ? apiItems : [],
    source: "api",
  };
}
