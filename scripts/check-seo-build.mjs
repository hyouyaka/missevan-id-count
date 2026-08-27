import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const distUrl = new URL("../dist/", import.meta.url);

async function readBuildFile(fileName) {
  try {
    return await readFile(new URL(fileName, distUrl), "utf8");
  } catch (error) {
    throw new Error(`Missing build artifact: dist/${fileName}`, { cause: error });
  }
}

const [indexHtml, robotsTxt, sitemapXml] = await Promise.all([
  readBuildFile("index.html"),
  readBuildFile("robots.txt"),
  readBuildFile("sitemap.xml"),
]);

assert.match(indexHtml, /<title>小猫小狐工具箱<\/title>/);
assert.match(indexHtml, /name="description"/);
assert.match(indexHtml, /小猫小狐工具箱，提供猫耳FM与漫播广播剧的数据查询、付费ID数、榜单、更新、趋势与统计工具。/);
assert.match(indexHtml, /rel="canonical" href="https:\/\/mmtoolkit\.app\/"/);
assert.match(indexHtml, /<h1>小猫小狐工具箱<\/h1>/);
assert.match(indexHtml, /猫耳FM与漫播广播剧的更新、榜单、作品数据、付费ID数、趋势及统计工具/);
assert.match(indexHtml, /type="application\/ld\+json"/);

assert.match(robotsTxt, /^User-agent: \*$/m);
assert.match(robotsTxt, /^Allow: \/$/m);
assert.match(robotsTxt, /^Sitemap: https:\/\/mmtoolkit\.app\/sitemap\.xml$/m);

assert.match(sitemapXml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
assert.match(sitemapXml, /<loc>https:\/\/mmtoolkit\.app\/<\/loc>/);

console.log("SEO build artifacts validated.");
