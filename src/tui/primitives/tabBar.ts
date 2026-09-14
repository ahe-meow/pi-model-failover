import { truncateToWidth } from "@earendil-works/pi-tui";
import { theme } from "./theme.js";

export class TabBar {
  active = 0;

  constructor(private labels: string[]) {}

  next(): void {
    this.active = (this.active + 1) % this.labels.length;
  }

  prev(): void {
    this.active = (this.active - 1 + this.labels.length) % this.labels.length;
  }

  set(i: number): void {
    if (i >= 0 && i < this.labels.length) this.active = i;
  }

  render(width: number): string {
    const parts = this.labels.map((label, i) =>
      i === this.active ? theme.current(`[${i + 1} ${label}]`) : ` ${i + 1} ${label} `,
    );
    return truncateToWidth(parts.join(" ").trimEnd(), width);
  }
}
