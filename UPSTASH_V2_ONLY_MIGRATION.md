# 消费端移除 v1 依赖，仅读取 v2 数据

本文档用于未来把 `missevan-id-count` 从当前的 `prefer-v2 + v1 fallback` 切换为 v2-only。当前版本仍必须保留 v1 回退；只有全部前置条件满足并经过单独审批后，才执行本文档。

## 1. 范围定义

本次未来迁移所说的 v1 包括：

- 资料库 String：`missevan:info:v1`、`manbo:info:v1`。
- 普通趋势聚合 String：`ranks:trend:missevan`、`ranks:trend:manbo`。
- CV 趋势聚合 String：`ranks:trend:cv:missevan`、`ranks:trend:cv:manbo`。
- 巅峰趋势聚合 String：`ranks:trend:peak:missevan`。
- 上述数据在 `server/application.js` 中对应的 legacy 读取、缓存和 fallback 分支。

以下是未版本化的公共数据，不属于“移除 v1”范围：

- `ranks:latest`、`ranks:cv:latest`、`ranks:meta`。
- `ongoing:missevan`、`ongoing:manbo`。
- 周播 canonical 数据：`missevan:watchcount:history`、`manbo:watchcount:history`、`missevan:watchcount:index`、`manbo:watchcount:index` 及索引指向的快照 key。

切换后的数据链路：

```text
层A PersonalDramaDatabase
  ✅ 只发布 info v2 / trend v2
        →
层B Upstash
  ✅ v2 Hash、v2 info、meta 与未版本化公共数据继续存在
  ❌ 消费端不再访问 v1 聚合 String
        →
层C missevan-id-count
  ✅ 固定读取 v2/canonical key
  ✅ HTTP 路由、响应 schema、状态码和 ETag 语义保持不变
```

## 2. 切换前置条件

所有条件必须同时满足，并保存核验记录：

| 条件 | 验收标准 |
|---|---|
| 消费端覆盖 | 所有仍受支持的网页端和桌面版均已包含 v2 读取能力 |
| 双写稳定期 | PersonalDramaDatabase 的 v1/v2 双写连续稳定至少 30 天 |
| 生产端错误 | 最近 14 天 v2 发布失败为 0 |
| 消费端回退 | 最近 14 天 v1 fallback 为 0 |
| 其他读取者 | 已检索其他仓库、定时任务和人工脚本，确认没有读取待停用 v1 key |
| 备份与演练 | 已完成全部 v1 key 备份，并演练恢复 v1 双写和消费端回滚 |

不得用“当前 v2 数据看起来完整”替代稳定期、日志和回滚演练。

在两个仓库执行迁移前创建同名兼容标签，回滚版本固定为该标签，不使用模糊的“上一个版本”：

```powershell
Set-Location F:\VSProjects\MissevanWebApp\missevan-id-count
git tag -a upstash-v1-compat -m "Last verified Upstash v1-compatible consumer"
git push origin upstash-v1-compat

Set-Location F:\VSProjects\PersonalDramaDatabase
git tag -a upstash-v1-compat -m "Last verified Upstash v1-compatible producer"
git push origin upstash-v1-compat
```

在生产端仓库生成固定名称的 v1 备份；文件必须进入受控备份存储，不提交到 Git：

```powershell
Set-Location F:\VSProjects\PersonalDramaDatabase
New-Item -ItemType Directory -Force recovery_backups | Out-Null
python -c "import json; from sync_new_drama_ids import ROOT,load_env_file,upstash_request; load_env_file(ROOT/'.env'); keys=['missevan:info:v1','manbo:info:v1','ranks:trend:missevan','ranks:trend:manbo','ranks:trend:cv:missevan','ranks:trend:cv:manbo','ranks:trend:peak:missevan']; print(json.dumps({key:upstash_request(['GET',key]) for key in keys},ensure_ascii=False))" | Set-Content -Encoding utf8 recovery_backups/upstash-v1-compat.json
```

## 3. 消费端改造清单

在 `server/application.js` 中完成以下删除和收敛：

1. 删除 `UPSTASH_DATA_READ_MODE=legacy|prefer-v2` 分支，固定使用 v2；同时从 `envConfig.js`、README 和部署环境中移除该变量。
2. 保留 `loadInfoStoresV2()`、`parseInfoV2Meta()` 和 SHA-1 校验；删除 `readLegacyInfoStoreSnapshot()`、info v1 预加载、周期刷新及 SHA 失败后的 v1 fallback。v2 刷新失败时继续保留上一份已验证的内存快照并报告错误。
3. 普通趋势固定使用 `readRankTrendV2Snapshot()`；删除 `getCachedLegacyRankTrendAggregateSnapshot()`、普通趋势聚合 String 读取函数及其全量聚合缓存。
4. CV 趋势固定使用 `readCvRankTrendV2Snapshots()` 和 `buildCvRankTrendV2Snapshots()`；删除两平台 CV 聚合 String 的读取和回退。
5. 巅峰趋势固定使用 `readPeakRankTrendV2Snapshot()`；删除巅峰聚合 String 的读取和回退。
6. 改造 `readInitialRanksBatch()`：首次 `MGET` 只读取未版本化的 `ranks:latest`、`ranks:cv:latest` 和 `ranks:meta`；再根据当前榜单中的 CV/巅峰实体，通过对应 v2 Hash 的 `HMGET` 补齐榜单展示所需趋势摘要。不得继续把 `ranks:trend:cv:missevan`、`ranks:trend:cv:manbo` 或 `ranks:trend:peak:missevan` 放入冷启动批量读取。
7. 周播保留 `{platform}:watchcount:history` 为主路径，保留 `{platform}:watchcount:index` + `MGET` 为 history 异常时的 canonical 回退；删除 `{platform}:watchcount:weekly:index` 和 `SCAN` 旧兼容分支。
8. 删除只服务于 v1 的解析器、缓存、环境变量和测试 fixture。HTTP API、当前 schema version 7 的响应字段、状态码与 ETag 计算必须保持兼容。

测试环境应把所有 Upstash 命令记录下来，出现以下任一 key 即判定失败：

```text
missevan:info:v1
manbo:info:v1
ranks:trend:missevan
ranks:trend:manbo
ranks:trend:cv:missevan
ranks:trend:cv:manbo
ranks:trend:peak:missevan
```

## 4. 生产端停止 v1 的顺序

严格按顺序执行，任一观察阶段出现异常即停止：

1. 先发布并验证 v2-only 消费端，生产端仍维持 v1/v2 双写。
2. 观察至少一个完整普通榜、周榜/CV 和 info 更新周期。
3. 在 PersonalDramaDatabase 中把 v1 发布切换为“只告警、不删除”；v2 发布仍保持正常。
4. 再观察 30 天，确认消费端、其他仓库和人工脚本均无 v1 读取。
5. 最后停止 v1 写入。

删除 v1 key 不属于上述步骤。任何 `DEL`、过期时间设置或批量清理必须作为另一个显式审批任务单独执行。

生产端 v2 回填与恢复命令：

```powershell
Set-Location F:\VSProjects\PersonalDramaDatabase
$env:UPSTASH_V2_PUBLISH_MODE = "best-effort"
python sync_new_drama_ids.py --backfill-info-v2
python fetch_rank_data.py --backfill-rank-trend-v2
python build_cv_ranks.py --backfill-cv-trend-v2
```

当前 `UPSTASH_V2_PUBLISH_MODE=off` 仅停止 v2 best-effort 发布，不能用来实现停止 v1；未来停止 v1 必须另做明确代码改造和审批。

## 5. 测试、验收与回滚

### 测试与验收

- 在 v2-only 测试环境通过 mock 或 Upstash 命令记录断言：所有读取只访问 v2 或 canonical key，不得出现上一节列出的 v1 key。
- 对搜索、普通榜单、趋势、CV、巅峰、在播和周播执行切换前后 HTTP 响应深度快照对比；忽略合法变化的发布时间，其他响应 schema 保持一致。
- 覆盖 info meta 未变化、单平台变化、SHA 不匹配、v2 缺失、Hash field 缺失、超时和上一份内存快照保留。
- 覆盖周播正常路径一次 `HGET/HMGET`、history 异常后的 canonical index 回退，以及“至少两个不同日期的数据点才可显示”。
- 执行：

```powershell
npm run test:node
npm run test:ui
npm run typecheck
npm run lint
npm run build
```

- 发布后监控 404、503、空搜索结果、趋势不可用、v1 key 命令和 fallback 指标。v1 key 命令与 v1 fallback 的预期值都为 0。

### 回滚

回滚包固定为前置步骤创建的 `upstash-v1-compat` 标签。回滚流程：

1. 从消费端 `upstash-v1-compat` 标签构建并部署，设置 `UPSTASH_DATA_READ_MODE=legacy`。
2. 从 `recovery_backups/upstash-v1-compat.json` 恢复上述 v1 String key；恢复后校验 JSON 可解析、记录数和更新时间。
3. 从生产端 `upstash-v1-compat` 标签恢复 v1 双写代码，并保持 `$env:UPSTASH_V2_PUBLISH_MODE = "best-effort"`，避免回滚期间中断 v2。
4. 运行三个 v2 回填命令，保证回滚期间 v2 仍持续可用。
5. 验证搜索、榜单、趋势、CV、巅峰、在播和周播，再解除故障状态。

可直接执行的回滚命令：

```powershell
Set-Location F:\VSProjects\MissevanWebApp\missevan-id-count
git switch --detach upstash-v1-compat
npm ci
npm run test
npm run build
$env:UPSTASH_DATA_READ_MODE = "legacy"

Set-Location F:\VSProjects\PersonalDramaDatabase
git switch --detach upstash-v1-compat
$env:UPSTASH_V2_PUBLISH_MODE = "best-effort"
python -c "import json; from sync_new_drama_ids import ROOT,load_env_file,upstash_request; load_env_file(ROOT/'.env'); data=json.load(open('recovery_backups/upstash-v1-compat.json',encoding='utf-8-sig')); results={key:upstash_request(['SET',key,value]) for key,value in data.items()}; assert all(value=='OK' for value in results.values()),results; print(results)"
python sync_new_drama_ids.py --backfill-info-v2
python fetch_rank_data.py --backfill-rank-trend-v2
python build_cv_ranks.py --backfill-cv-trend-v2
```

消费端的构建产物按现有部署流程发布；生产端标签中的日常任务入口即为恢复后的 v1/v2 双写入口。

小贴士：v1 停写与 v1 删除必须拆成两个审批阶段；只要回滚支持期尚未结束，就保留可恢复的 v1 备份。
