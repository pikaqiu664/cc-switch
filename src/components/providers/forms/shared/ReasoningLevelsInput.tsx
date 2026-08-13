import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/** 思考等级文本归一化：去空白、去空串、去重，保持填写顺序 */
export function normalizeReasoningLevels(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((level) => level.trim())
    .filter((level) => {
      if (!level || seen.has(level)) return false;
      seen.add(level);
      return true;
    });
}

interface ReasoningLevelsInputProps {
  id?: string;
  /** 结构化思考等级列表（未归一化的草稿由组件内部维护） */
  value?: string[];
  /** 失焦时归一化后回调；空列表回调 undefined */
  onChange: (levels: string[] | undefined) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}

/**
 * 思考等级输入框：显示层保留输入原文（未闭合的逗号不会被吞），
 * 结构层实时归一化（去空白/去空串/去重）回调给父组件，保证提交时
 * 不需要依赖 blur 时序；失焦时再把回显文本规范化为提交后的值。
 * 外部 value 变化仅在未聚焦时重置草稿，避免打断正在进行的输入。
 */
export function ReasoningLevelsInput({
  id,
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
}: ReasoningLevelsInputProps) {
  const [draft, setDraft] = useState(value?.join(", ") ?? "");
  const lastCommittedRef = useRef(value);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    const nextText = value?.join(", ") ?? "";
    if (!isFocusedRef.current && lastCommittedRef.current !== value) {
      setDraft(nextText);
    }
    lastCommittedRef.current = value;
  }, [value]);

  /** 归一化并提交结构化值（同时用于实时回调与失焦提交） */
  const commitText = (text: string) => {
    const levels = normalizeReasoningLevels(text);
    onChange(levels.length > 0 ? levels : undefined);
    lastCommittedRef.current = levels.length > 0 ? levels : undefined;
  };

  return (
    <Input
      id={id}
      type="text"
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        commitText(text);
      }}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        commitText(draft);
        // 失焦后回显规范化文本，去掉未闭合逗号/多余空格
        setDraft(normalizeReasoningLevels(draft).join(", "));
      }}
      placeholder={placeholder}
      autoComplete="off"
      aria-label={ariaLabel}
      className={className}
    />
  );
}
