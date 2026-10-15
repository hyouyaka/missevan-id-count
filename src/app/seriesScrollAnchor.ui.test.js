import { afterEach, expect, test, vi } from "vitest";
import { captureSeriesScrollAnchor, restoreSeriesScrollAnchor } from "@/app/seriesScrollAnchor";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test("collapsing earlier page content preserves the clicked control's viewport position instantly", () => {
  const button = document.createElement("button");
  const icon = document.createElement("span");
  button.append(icon);
  document.body.append(button);
  let top = 420;
  button.getBoundingClientRect = () => ({ top });
  const scroll = vi.spyOn(window, "scrollBy").mockImplementation(({ top: delta }) => { top -= delta; });
  const anchor = captureSeriesScrollAnchor(icon);
  top = -594;
  restoreSeriesScrollAnchor(anchor);
  expect(top).toBe(420);
  expect(scroll).toHaveBeenCalledWith({ top: -1014, left: 0, behavior: "instant" });
});

test("rank work lists restore their own scroll position before adjusting page scroll", () => {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  Object.defineProperties(container, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } });
  const button = document.createElement("button");
  container.append(button);
  document.body.append(container);
  let scrollTop = 300;
  let contentTop = 500;
  container.getBoundingClientRect = () => ({ top: 100 });
  button.getBoundingClientRect = () => ({ top: 100 + contentTop - scrollTop });
  container.scrollBy = vi.fn(({ top }) => { scrollTop += top; });
  const pageScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const anchor = captureSeriesScrollAnchor(button);
  contentTop -= 200;
  restoreSeriesScrollAnchor(anchor);
  expect(button.getBoundingClientRect().top).toBe(300);
  expect(container.scrollBy).toHaveBeenCalledWith({ top: -200, left: 0, behavior: "instant" });
  expect(pageScroll).not.toHaveBeenCalled();
});

test("removed controls and positions already preserved by the browser need no correction", () => {
  const button = document.createElement("button");
  document.body.append(button);
  button.getBoundingClientRect = () => ({ top: 420 });
  const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const anchor = captureSeriesScrollAnchor(button);
  restoreSeriesScrollAnchor(anchor);
  button.remove();
  restoreSeriesScrollAnchor(anchor);
  expect(scroll).not.toHaveBeenCalled();
  expect(captureSeriesScrollAnchor(document.body)).toBeNull();
});
