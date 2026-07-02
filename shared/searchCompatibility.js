import OpenCC from "opencc-js";

const convertTraditionalToSimplified = OpenCC.Converter({
  from: "t",
  to: "cn",
});
const INTERNAL_DE_PATTERN = /(\p{Script=Han})的(?=\p{Script=Han})/gu;

export function canonicalizeCompatibleSearchText(value) {
  return convertTraditionalToSimplified(String(value ?? ""))
    .replace(INTERNAL_DE_PATTERN, "$1");
}
