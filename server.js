import express from "express";
import fetch from "node-fetch";
import cors from "cors";

import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express();

app.use(cors());
app.use(express.json());

// 搜索剧集
app.get("/search", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) return res.json({ success: false, message: "缺少 keyword 参数" });

  try {
    const url = `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(keyword)}&page=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.success) return res.json({ success: false });

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

/* 获取剧集 */
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

/* 统计弹幕 */
app.post("/getdanmaku", async (req, res) => {
  const soundInfos = req.body.sounds;
  /*
  {
    sound_id
    drama_title
  }
  */

  let allUsers = new Set();
  let allDanmaku = 0;
  const dramaMap = {};

  /* 并行请求 */
  const tasks = soundInfos.map(async (info) => {
    try {
      const resp = await fetch(
        `https://www.missevan.com/sound/getdm?soundid=${info.sound_id}`
      );

      const text = await resp.text();

      const lines = text
        .split("\n")
        .filter((l) => l.includes('<d p='));

      let users = new Set();

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

  /* 汇总 */
  results.forEach((r) => {
    if (!r.success) return;

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

  /* 输出 */
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

/* 新增：通过搜索关键词获取剧集ID和标题 */
app.get("/searchdramas", async (req, res) => {
  const keyword = req.query.keyword || "";
  const page = req.query.page || 1;

  try {
    const resp = await fetch(
      `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(
        keyword
      )}&page=${page}`
    );
    const data = await resp.json();

    if (data.success && data.info && data.info.Datas) {
      // 返回简化版：只包含 id 和 name
      const results = data.info.Datas.map((d) => ({
        id: d.id,
        name: d.name,
      }));
      res.json({ success: true, results });
    } else {
      res.json({ success: false, results: [] });
    }
  } catch (e) {
    res.json({ success: false, results: [] });
  }
});

app.use(express.static(path.join(__dirname, "dist")))

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"))
})

app.listen(3000, () => {
  console.log("server running on 3000");
});