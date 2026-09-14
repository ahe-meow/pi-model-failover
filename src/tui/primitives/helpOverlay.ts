import { truncateToWidth } from "@earendil-works/pi-tui";

export class HelpOverlay {
  visible = false;

  constructor(private sections: Array<{ title: string; hints: Array<[string, string]> }>) {}

  setSections(sections: Array<{ title: string; hints: Array<[string, string]> }>): void {
    this.sections = sections;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  render(width: number, height: number): string[] {
    const lines: string[] = [];
    for (const section of this.sections) {
      lines.push(section.title);
      for (const [key, label] of section.hints) lines.push(`  ${key.padEnd(10)} ${label}`);
      lines.push("");
    }
    const out = lines.slice(0, height).map((line) => truncateToWidth(line, width));
    while (out.length < height) out.push("");
    return out;
  }
}
