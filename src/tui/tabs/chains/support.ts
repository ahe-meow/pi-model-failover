import { Key, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type {
  Chain,
  FailoverEvent,
  Target,
  TargetRef,
  TargetState,
} from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { type Field, Form } from "../../primitives/form.js";
import type { ScrollList } from "../../primitives/scrollList.js";

export function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

export const targetRef = (target: Target): TargetRef =>
  `${target.provider}/${target.modelId}` as TargetRef;

export function firstTargetRef(targets: Target[]): string {
  const target = targets[0];
  return target === undefined ? S.chains.noTarget : targetRef(target);
}

export const nowMs = (now: string): number => Date.parse(now) || 0;

export function targetStatus(state: TargetState | undefined, now: number): string {
  if (state?.manualRecovery) return S.chains.status.manual;
  const until = state?.cooldownUntil === null ? Number.NaN : Date.parse(state?.cooldownUntil ?? "");
  return Number.isFinite(until) && until > now
    ? S.chains.status.cool(Math.max(1, Math.ceil((until - now) / 60_000)))
    : S.chains.status.ok;
}

export function chainStatus(
  targets: Target[],
  states: Record<TargetRef, TargetState>,
  now: number,
): string {
  if (targets.length === 0) return S.chains.notRegistered;
  const statuses = targets.map((target) => targetStatus(states[targetRef(target)], now));
  const manual = statuses.filter((status) => status === S.chains.status.manual).length;
  return S.chains.status.summary(
    statuses.filter((status) => status !== S.chains.status.ok).length - manual,
    manual,
  );
}

export function move(list: ScrollList, data: string): void {
  const keys = [Key.up, Key.down, Key.pageUp, Key.pageDown, Key.home, Key.end];
  const index = keys.findIndex((key) => isKey(data, key));
  [list.up, list.down, list.pageUp, list.pageDown, list.home, list.end][index]?.call(list);
}

export function fitBody(lines: string[], width: number, listRows: number): string[] {
  const body = lines
    .slice(0, listRows)
    .map((line) => (line.length > width ? line.slice(0, width) : line));
  while (body.length < listRows) body.push(String());
  return body;
}

export function textField(
  key: string,
  label: string,
  value: string,
): Extract<Field, { kind: "text" }> {
  return { kind: "text", key, label, value };
}

export function createChainForm(
  mode: "new" | "rename",
  current: Chain | undefined,
  createChainId: () => string,
  submit: (values: Record<string, unknown>) => void,
  cancel: () => void,
): Form {
  const fields: Field[] =
    mode === "new"
      ? [
          textField("id", S.chains.form.labels.id, createChainId()),
          textField("name", S.chains.form.labels.name, String()),
        ]
      : [textField("name", S.chains.form.labels.name, current?.name ?? String())];
  return new Form(fields, submit, cancel);
}

export function manualEvent(ref: TargetRef, ts: string, sessionId: string): FailoverEvent {
  return { ts, sessionId, requestSeq: 0, from: ref, to: null, reason: "manual", elapsedMs: 0 };
}
