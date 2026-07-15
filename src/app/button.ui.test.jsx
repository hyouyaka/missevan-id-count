import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Button } from "@/components/ui/button";

test("button exposes native keyboard interaction and accessible name", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<Button onClick={onClick}>保存收藏</Button>);

  const button = screen.getByRole("button", { name: "保存收藏" });
  await user.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});
