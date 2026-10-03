// Suggestions accept a single name fragment, independently of full-search limits.
export function getSearchSuggestionKeyword(value) {
  if (typeof value !== "string") return "";
  const keyword = value.trim();
  if (!keyword || keyword.length > 200 || !/^[\p{L}\p{N}·]+$/u.test(keyword)) return "";
  if (/\p{Script=Han}/u.test(keyword)) return keyword;
  return (keyword.match(/[a-z]/gi) || []).length >= 2 ? keyword : "";
}
