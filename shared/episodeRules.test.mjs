import assert from "node:assert/strict";
import test from "node:test";

import { orderDetectedOverflowEpisodeKeys } from "./episodeRules.js";

test("overflow episode keys follow source order instead of concurrent completion order", () => {
  const sourceOrder = [4, 5, 6, 7, 8].map((episode) => `drama-第${episode}集`);
  const completionOrder = [7, 4, 5, 8, 6].map((episode) => `drama-第${episode}集`);

  assert.deepEqual(orderDetectedOverflowEpisodeKeys(completionOrder, sourceOrder), sourceOrder);
});

test("overflow episode keys preserve per-drama source order", () => {
  const sourceOrder = ["a-第1集", "a-第2集", "b-番外", "b-第3集"];
  const completionOrder = ["b-第3集", "a-第2集", "b-番外", "a-第1集"];

  assert.deepEqual(orderDetectedOverflowEpisodeKeys(completionOrder, sourceOrder), sourceOrder);
});

test("overflow episode keys are deduplicated and unknown keys remain at the end", () => {
  assert.deepEqual(
    orderDetectedOverflowEpisodeKeys(
      ["drama-第3集", "unknown-花絮", "drama-第1集", "unknown-花絮", "unknown-彩蛋"],
      ["drama-第1集", "drama-第2集", "drama-第3集"]
    ),
    ["drama-第1集", "drama-第3集", "unknown-花絮", "unknown-彩蛋"]
  );
});

test("overflow episode keys keep detected subset ordered for partial results", () => {
  assert.deepEqual(
    orderDetectedOverflowEpisodeKeys(
      ["drama-第8集", "drama-第5集"],
      ["drama-第4集", "drama-第5集", "drama-第6集", "drama-第7集", "drama-第8集"]
    ),
    ["drama-第5集", "drama-第8集"]
  );
});
