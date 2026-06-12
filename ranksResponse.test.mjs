import test from "node:test";
import assert from "node:assert/strict";

test("rank response appends normalized CV ranks per platform", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");

  const snapshot = {
    _meta: { updated_at: "2026-06-10T08:00:00+00:00" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const cvSnapshot = {
    version: 2,
    date: "2026-06-10",
    generated_at: "2026-06-10T09:30:00+00:00",
    missevanDramaCount: 842,
    manboDramaCount: 331,
    rankings: {
      missevan: [
        {
          cvName: "路知行",
          avatar: "https://avatar.test/missevan.jpg",
          totalViewCount: 1188561622,
          rank: 1,
          workCount: 2,
          works: [
            {
              platform: "missevan",
              dramaId: "22602",
              title: "魔道祖师 第三季",
              cover: "https://cover.test/missevan.jpg",
              mainCvs: ["路知行", "魏超"],
              viewCount: 295782463,
            },
          ],
        },
      ],
      manbo: [
        {
          cvName: "张福正",
          avatar: "https://avatar.test/manbo.jpg",
          totalViewCount: 248362571,
          rank: 1,
          works: [
            {
              platform: "manbo",
              dramaId: "1697533863498088523",
              title: "人鱼陷落·第一季",
              cover: "https://cover.test/manbo.jpg",
              mainCvs: ["张福正", "马正阳"],
              viewCount: 58396828,
            },
          ],
        },
      ],
    },
  };

  const response = buildNormalizedRanksResponse(snapshot, null, cvSnapshot);

  assert.equal(response.schemaVersion, 4);
  assert.deepEqual(response.cvSummary, {
    updatedAt: "2026-06-10T09:30:00+00:00",
    missevanDramaCount: 842,
    manboDramaCount: 331,
  });

  const missevanCvCategory = response.platforms.missevan.categories.find((category) => category.key === "cv");
  assert.equal(missevanCvCategory.label, "CV榜");
  assert.equal(missevanCvCategory.ranks[0].fetchedAt, "2026-06-10T09:30:00+00:00");
  assert.equal(missevanCvCategory.ranks[0].items[0].cvName, "路知行");
  assert.equal(missevanCvCategory.ranks[0].items[0].workCount, 2);
  assert.equal(missevanCvCategory.ranks[0].items[0].topWorks[0].title, "魔道祖师 第三季");
  assert.equal(missevanCvCategory.ranks[0].items[0].works[0].dramaId, "22602");

  const manboCvCategory = response.platforms.manbo.categories.find((category) => category.key === "cv");
  assert.equal(manboCvCategory.ranks[0].items[0].works[0].platform, "manbo");
});

test("rank response keeps ordinary ranks when CV snapshot is unavailable", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");

  const response = buildNormalizedRanksResponse(
    {
      _meta: { updated_at: "2026-06-10T08:00:00+00:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    null,
    null
  );

  assert.equal(response.schemaVersion, 4);
  assert.equal(response.cvSummary.updatedAt, "");
  assert.equal(response.platforms.missevan.categories.some((category) => category.key === "cv"), false);
  assert.equal(response.platforms.manbo.categories.some((category) => category.key === "cv"), false);
});
