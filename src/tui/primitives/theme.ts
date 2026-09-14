const RESET = "\x1b[39m";

const color = (code: string, value: string): string => `${code}${value}${RESET}`;

export const theme = {
  title: (value: string): string => color("\x1b[96m", value),
  current: (value: string): string => color("\x1b[96m", value),
  header: (value: string): string => color("\x1b[94m", value),
  success: (value: string): string => color("\x1b[92m", value),
  warning: (value: string): string => color("\x1b[93m", value),
  danger: (value: string): string => color("\x1b[91m", value),
  muted: (value: string): string => color("\x1b[90m", value),
  status: (value: string): string => {
    if (value.includes("manual")) return theme.danger(value);
    if (value.includes("cool")) return theme.warning(value);
    return theme.success(value);
  },
};
