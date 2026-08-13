import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReasoningLevelsInput } from "@/components/providers/forms/shared/ReasoningLevelsInput";

describe("ReasoningLevelsInput", () => {
  it("keeps the comma in the visible draft while typing", () => {
    const onChange = vi.fn();
    render(
      <ReasoningLevelsInput
        value={[]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    const input = screen.getByLabelText("levels") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "low," } });
    expect(input.value).toBe("low,");
    // 结构化值实时归一化提交（未闭合逗号被规范化掉，但显示不受影响）
    expect(onChange).toHaveBeenLastCalledWith(["low"]);
  });

  it("normalizes and commits on blur", () => {
    const onChange = vi.fn();
    render(
      <ReasoningLevelsInput
        value={undefined}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    const input = screen.getByLabelText("levels") as HTMLInputElement;

    fireEvent.change(input, { target: { value: " low, high, low,, " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(["low", "high"]);
    expect(input.value).toBe("low, high");
  });

  it("commits undefined when emptied", () => {
    const onChange = vi.fn();
    render(
      <ReasoningLevelsInput
        value={["low"]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    const input = screen.getByLabelText("levels") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(input.value).toBe("");
  });

  it("does not reset the draft while focused when external value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReasoningLevelsInput
        value={["low"]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    const input = screen.getByLabelText("levels") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "low, med" } });
    rerender(
      <ReasoningLevelsInput
        value={["high"]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    expect(input.value).toBe("low, med");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(["low", "med"]);
  });

  it("resets the draft from external value when not focused", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReasoningLevelsInput
        value={["low"]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    rerender(
      <ReasoningLevelsInput
        value={["high", "max"]}
        onChange={onChange}
        aria-label="levels"
      />,
    );
    const input = screen.getByLabelText("levels") as HTMLInputElement;
    expect(input.value).toBe("high, max");
  });
});
