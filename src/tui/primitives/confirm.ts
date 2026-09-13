import { Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { S } from "../../strings.js";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

export class Confirm {
  private choice: 0 | 1 = 1;

  constructor(
    private title: string,
    private details: string[],
    private onConfirm: () => void,
    private onCancel: () => void,
  ) {}

  render(width: number): string[] {
    const button = (label: string, index: 0 | 1) =>
      this.choice === index ? `\x1b[7m[ ${label} ]\x1b[27m` : `[ ${label} ]`;
    return [
      this.title,
      ...this.details.slice(0, 3),
      "",
      `${button(S.confirm, 0)}   ${button(S.cancel, 1)}`,
    ].map((line) => truncateToWidth(line, width));
  }

  handleInput(data: string): void {
    if (isKey(data, Key.tab)) this.choice = this.choice === 0 ? 1 : 0;
    else if (isKey(data, Key.left) || isKey(data, Key.up)) this.choice = 0;
    else if (isKey(data, Key.right) || isKey(data, Key.down)) this.choice = 1;
    else if (isKey(data, Key.enter)) (this.choice === 0 ? this.onConfirm : this.onCancel)();
    else if (isKey(data, Key.escape)) this.onCancel();
  }
}
