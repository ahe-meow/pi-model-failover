import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "./theme.js";

export function renderKeyHints(
  hints: Array<[key: string, label: string]>,
  width: number,
): string[] {
  const lines: string[] = [""];
  for (const [key, label] of hints) {
    const chunk = ` ${theme.current(key)} ${theme.muted(label)} `;
    const current = lines.at(-1) ?? "";
    if (visibleWidth(current + chunk) <= width || current === "")
      lines.splice(-1, 1, current + chunk);
    else if (lines.length < 2) lines.push(chunk);
    else break;
  }
  return lines.map((line) => truncateToWidth(line.trimEnd(), width));
}
