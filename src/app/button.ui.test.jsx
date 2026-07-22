import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

test("button exposes native keyboard interaction and accessible name", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<Button onClick={onClick}>保存收藏</Button>);

  const button = screen.getByRole("button", { name: "保存收藏" });
  await user.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test("button and badge support Radix Slot composition", () => {
  render(
    <>
      <Button asChild>
        <a href="/compare">打开对比</a>
      </Button>
      <Badge asChild>
        <a href="/favorites">收藏</a>
      </Badge>
    </>,
  );

  expect(screen.getByRole("link", { name: "打开对比" })).toHaveAttribute("data-slot", "button");
  expect(screen.getByRole("link", { name: "收藏" })).toHaveAttribute("data-slot", "badge");
});
