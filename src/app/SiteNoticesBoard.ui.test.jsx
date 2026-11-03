import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SiteNoticesBoard } from "@/app/SiteNoticesBoard";
import AdminUpdatesView from "@/app/AdminUpdatesView";

const empty = { success: true, version: 1, revision: "empty", updatedAt: null, entries: [] };
const populated = { ...empty, revision: "published", entries: [
  { id: "older", date: "2026-11-01", title: "新增作品资料", body: "已补充作品信息。" },
  { id: "newer", date: "2026-11-02", title: "剧集资料缺失", body: "正在**核对来源**。" },
] };
const response = (payload = empty, status = 200) => ({ ok: status === 200, status, json: async () => payload });
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockResolvedValue(response()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function login(user) {
  await user.type(screen.getByLabelText("管理员令牌"), "admin-secret");
  await user.click(screen.getByRole("button", { name: "验证并编辑" }));
  await screen.findByRole("button", { name: "发布更新" });
}

test("public logs show a single newest-first feed with Markdown and matching lightbulb header", async () => {
  fetch.mockResolvedValue(response(populated));
  const { container } = render(<SiteNoticesBoard />);
  const feed = await screen.findByRole("list", { name: "管理员日志记录" });
  expect(within(feed).getAllByRole("article").map((article) => article.getAttribute("aria-label"))).toEqual(["剧集资料缺失", "新增作品资料"]);
  expect(screen.getByText("核对来源", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByText("一些数据库的更新和已发现待解决的问题")).toBeInTheDocument();
  expect(container.querySelector(".lucide-lightbulb")).toHaveClass("size-5");
  expect(container.querySelector(".lucide-lightbulb").parentElement).toHaveClass("size-10", "rounded-xl", "bg-primary/10");
  expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
  expect(within(feed).getAllByText("MMToolkit", { exact: true })).toHaveLength(2);
  expect(within(feed).queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "管理员编辑" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /管理/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("管理员令牌")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/feedback/notices");
  expect(fetch.mock.calls[0][1].headers).toBeUndefined();
});

test("public empty state has no category sections or editor", async () => {
  render(<SiteNoticesBoard />);
  expect(await screen.findByText("暂无管理员日志。")).toBeInTheDocument();
  expect(screen.queryByText("数据更新", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("已知问题", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
});

test("standalone manager initially shows only a token form and makes no log requests", () => {
  render(<AdminUpdatesView />);
  expect(screen.getByRole("heading", { name: "管理员日志管理" })).toBeInTheDocument();
  expect(screen.getByLabelText("管理员令牌")).toHaveAttribute("type", "password");
  expect(screen.queryByRole("button", { name: "添加日志" })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("manager can publish title-free posts, edit and delete without persisting the token", async () => {
  let latest = empty;
  fetch.mockImplementation(async (_url, options) => {
    if (options.method === "PUT") latest = { ...empty, revision: "new-revision", entries: JSON.parse(options.body).entries };
    return response(latest);
  });
  const storeToken = vi.spyOn(Storage.prototype, "setItem");
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await login(user);
  expect(fetch.mock.calls[0][0]).toBe("/admin/site-notices");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-secret");
  await user.click(screen.getByRole("button", { name: "添加日志" }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("内容（支持 Markdown）"), "请暂时手动导入。");
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByRole("article")).toHaveTextContent("请暂时手动导入。");
  const [, putOptions] = fetch.mock.calls.find(([, options]) => options.method === "PUT");
  expect(JSON.parse(putOptions.body)).toMatchObject({ revision: "empty", entries: [{ title: "", body: "请暂时手动导入。" }] });
  expect(putOptions.body).not.toMatch(/admin-secret|"type"|"status"/);
  expect(storeToken).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("标题（选填）"), "补充说明");
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByRole("heading", { name: "补充说明" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除日志 1" }));
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByText("暂无管理员日志。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "退出编辑" }));
  expect(screen.getByLabelText("管理员令牌")).toHaveValue("");
});

test("failed authentication hides the editor and publication conflict preserves the draft", async () => {
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await user.type(screen.getByLabelText("管理员令牌"), "wrong");
  fetch.mockResolvedValueOnce(response({ success: false, message: "管理员令牌无效。" }, 401));
  await user.click(screen.getByRole("button", { name: "验证并编辑" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("管理员令牌无效。");
  expect(screen.queryByRole("button", { name: "发布更新" })).not.toBeInTheDocument();
  fetch.mockResolvedValueOnce(response(populated));
  await user.click(screen.getByRole("button", { name: "验证并编辑" }));
  const titles = await screen.findAllByLabelText("标题（选填）");
  fireEvent.change(titles[0], { target: { value: "保留这份修改" } });
  fetch.mockResolvedValueOnce(response({ success: false, message: "内容已更新，请重新载入已发布内容后再编辑。" }, 409));
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("内容已更新");
  expect(titles[0]).toHaveValue("保留这份修改");
  expect(screen.getByRole("article", { name: "新增作品资料" })).toBeInTheDocument();
});

test("restoring published logs fetches the latest revision after conflict and permits publishing again", async () => {
  let latest = populated;
  fetch.mockImplementation(async (_url, options) => {
    if (options.method === "PUT") {
      const payload = JSON.parse(options.body);
      if (payload.revision !== latest.revision) {
        return response({ success: false, message: "内容已更新，请重新载入已发布内容后再编辑。" }, 409);
      }
      latest = { ...latest, revision: "republished", entries: payload.entries };
    }
    return response(latest);
  });
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await login(user);
  fireEvent.change(screen.getAllByLabelText("标题（选填）")[0], { target: { value: "旧窗口的修改" } });
  // Another editor publishes after this page has loaded its original snapshot.
  latest = { ...populated, revision: "another-editor", entries: [
    { ...populated.entries[0], title: "服务器最新日志", body: "另一个窗口发布的内容。" },
  ] };
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("内容已更新");

  await user.click(screen.getByRole("button", { name: "放弃草稿，恢复已发布内容" }));
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "PUT", "GET"]);
  const [restoreUrl, restoreOptions] = fetch.mock.calls[2];
  expect(restoreUrl).toBe("/admin/site-notices");
  expect(restoreOptions).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer admin-secret" } });
  expect(await screen.findByRole("article", { name: "服务器最新日志" })).toBeInTheDocument();
  expect(screen.getByLabelText("标题（选填）")).toHaveValue("服务器最新日志");
  expect(screen.getByLabelText("内容（支持 Markdown）")).toHaveValue("另一个窗口发布的内容。");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("标题（选填）"), "（继续编辑）");
  await user.click(screen.getByRole("button", { name: "发布更新" }));
  expect(await screen.findByRole("article", { name: "服务器最新日志（继续编辑）" })).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[3][1].body).revision).toBe("another-editor");
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "PUT", "GET", "PUT"]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("restoring published logs preserves the draft and snapshot when reading fails, and can be retried", async () => {
  fetch.mockResolvedValue(response(populated));
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await login(user);
  fireEvent.change(screen.getAllByLabelText("标题（选填）")[0], { target: { value: "需要保留的草稿" } });
  let finishRestore;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { finishRestore = resolve; }));

  await user.click(screen.getByRole("button", { name: "放弃草稿，恢复已发布内容" }));
  expect(screen.getByRole("button", { name: "放弃草稿，恢复已发布内容" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "日志记录" })).toBeDisabled();
  expect(screen.getAllByLabelText("标题（选填）")[0]).toHaveValue("需要保留的草稿");
  finishRestore(response({ success: false, message: "读取已发布内容失败，请稍后重试。" }, 503));
  expect(await screen.findByRole("alert")).toHaveTextContent("读取已发布内容失败");
  expect(screen.getAllByLabelText("标题（选填）")[0]).toHaveValue("需要保留的草稿");
  expect(screen.getByRole("article", { name: "新增作品资料" })).toBeInTheDocument();

  fetch.mockResolvedValueOnce(response({ ...populated, revision: "latest-empty", entries: [] }));
  await user.click(screen.getByRole("button", { name: "放弃草稿，恢复已发布内容" }));
  expect(await screen.findByText("暂无管理员日志。")).toBeInTheDocument();
  expect(screen.queryByLabelText("标题（选填）")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "GET", "GET"]);
});

test("manager recovers an unavailable startup through one explicit authenticated reload", async () => {
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await user.type(screen.getByLabelText("管理员令牌"), "admin-secret");
  await user.click(screen.getByRole("button", { name: "从存储重新载入" }));
  await screen.findByRole("button", { name: "发布更新" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/admin/site-notices/reload");
  expect(fetch.mock.calls[0][1].method).toBe("POST");
});

test("published deletion requires confirmation, saves once and preserves unrelated unsaved edits", async () => {
  let latest = populated;
  let revision = 0;
  fetch.mockImplementation(async (_url, options) => {
    if (options.method === "PUT") latest = { ...empty, revision: `revision-${++revision}`, entries: JSON.parse(options.body).entries };
    return response(latest);
  });
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await login(user);
  fireEvent.change(screen.getAllByLabelText("标题（选填）")[0], { target: { value: "未发布的修改" } });
  await user.click(screen.getByRole("button", { name: "添加日志" }));
  await user.type(screen.getAllByLabelText("内容（支持 Markdown）")[0], "尚未发布的新日志");

  await user.click(screen.getByRole("button", { name: "删除已发布日志：剧集资料缺失" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("其他未发布的修改会保留");
  await user.click(screen.getByRole("button", { name: "取消", exact: true }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("article", { name: "剧集资料缺失" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "删除已发布日志：剧集资料缺失" }));
  await user.click(screen.getByRole("button", { name: "确认删除", exact: true }));
  await waitFor(() => expect(screen.queryByRole("article", { name: "剧集资料缺失" })).not.toBeInTheDocument());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ revision: "published", entries: [populated.entries[0]] });
  expect(screen.getByRole("article", { name: "新增作品资料" })).toBeInTheDocument();
  expect(screen.getAllByLabelText("标题（选填）").some((input) => input.value === "未发布的修改")).toBe(true);
  expect(screen.getAllByLabelText("内容（支持 Markdown）")[0]).toHaveValue("尚未发布的新日志");

  await user.click(screen.getByRole("button", { name: "发布更新" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  const published = JSON.parse(fetch.mock.calls[2][1].body);
  expect(published.revision).toBe("revision-1");
  expect(published.entries).toHaveLength(2);
  expect(published.entries.some((entry) => entry.title === "未发布的修改")).toBe(true);
});

test("failed published deletion retains both the published post and unsaved draft", async () => {
  fetch.mockResolvedValue(response(populated));
  const user = userEvent.setup();
  render(<AdminUpdatesView />);
  await login(user);
  fireEvent.change(screen.getAllByLabelText("标题（选填）")[0], { target: { value: "仍在编辑" } });
  fetch.mockResolvedValueOnce(response({ success: false, message: "删除暂时失败，请重试。" }, 503));
  await user.click(screen.getByRole("button", { name: "删除已发布日志：剧集资料缺失" }));
  await user.click(screen.getByRole("button", { name: "确认删除", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("删除暂时失败");
  expect(screen.getByRole("article", { name: "剧集资料缺失" })).toBeInTheDocument();
  expect(screen.getAllByLabelText("标题（选填）")[0]).toHaveValue("仍在编辑");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("public polling retains posts on failure and pauses while hidden", async () => {
  fetch.mockResolvedValue(response(populated));
  vi.useFakeTimers();
  await act(async () => { render(<SiteNoticesBoard />); });
  fetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("article", { name: "剧集资料缺失" })).toBeInTheDocument();
  expect(screen.getByText("管理员日志暂时无法读取，已有内容将保留。")).toBeInTheDocument();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("post bodies do not render active HTML, external images or script links", async () => {
  fetch.mockResolvedValue(response({ ...populated, entries: [{ ...populated.entries[0], body: '<script>alert(1)</script>\n\n<img src="https://example.com/a.png">\n\n![image](https://example.com/a.png)\n\n[unsafe](javascript:alert%281%29)' }] }));
  const { container } = render(<SiteNoticesBoard />);
  await screen.findByRole("article");
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector('img[src^="https:"]')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});
