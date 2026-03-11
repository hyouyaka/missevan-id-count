import express from "express";
import fetch from "node-fetch";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// 鎼滅储鍓ч泦
app.get("/search", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) {
    return res.json({ success: false, message: "缂哄皯 keyword 鍙傛暟" });
  }

  try {
    const url = `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(keyword)}&page=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.success) {
      return res.json({ success: false });
    }

    const results = data.info.Datas.map((d) => ({
      id: d.id,
      name: d.name,
      checked: false,
    }));

    res.json({ success: true, results });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* 鑾峰彇鍓ч泦 */
app.post("/getdramas", async (req, res) => {
  const ids = req.body.drama_ids;
  const results = [];

  for (const id of ids) {
    try {
      const resp = await fetch(
        `https://www.missevan.com/dramaapi/getdrama?drama_id=${id}`
      );
      const data = await resp.json();

      if (data.success) {
        results.push({
          success: true,
          id,
          info: data.info,
        });
      } else {
        results.push({ success: false, id });
      }
    } catch (e) {
      results.push({ success: false, id });
    }
  }

  res.json(results);
});

/* 缁熻寮瑰箷 */
app.post("/getdanmaku", async (req, res) => {
  const soundInfos = req.body.sounds;
  /*
  {
    sound_id
    drama_title
  }
  */

  const allUsers = new Set();
  let allDanmaku = 0;
  const dramaMap = {};

  /* 骞惰璇锋眰 */
  const tasks = soundInfos.map(async (info) => {
    try {
      const resp = await fetch(
        `https://www.missevan.com/sound/getdm?soundid=${info.sound_id}`
      );

      const text = await resp.text();

      const lines = text.split("\n").filter((l) => l.includes('<d p='));

      const users = new Set();

      lines.forEach((l) => {
        const match = l.match(/<d p="([^"]+)"/);
        if (match) {
          const uid = match[1].split(",")[6];
          users.add(uid);
        }
      });

      return {
        success: true,
        sound_id: info.sound_id,
        drama: info.drama_title,
        total: lines.length,
        users: [...users],
      };
    } catch (e) {
      return {
        success: false,
        sound_id: info.sound_id,
      };
    }
  });

  const results = await Promise.all(tasks);

  /* 姹囨€?*/
  results.forEach((r) => {
    if (!r.success) {
      return;
    }

    if (!dramaMap[r.drama]) {
      dramaMap[r.drama] = {
        title: r.drama,
        danmaku: 0,
        users: new Set(),
      };
    }

    const d = dramaMap[r.drama];
    d.danmaku += r.total;
    r.users.forEach((uid) => {
      d.users.add(uid);
      allUsers.add(uid);
    });

    allDanmaku += r.total;
  });

  /* 杈撳嚭 */
  const dramaResults = Object.values(dramaMap).map((d) => {
    return {
      title: d.title,
      danmaku: d.danmaku,
      users: d.users.size,
    };
  });

  res.json({
    dramaResults,
    allDanmakuCount: allDanmaku,
    allUserCount: allUsers.size,
  });
});

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(3000, () => {
  console.log("server running on 3000");
});
