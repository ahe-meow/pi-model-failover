export class FakePi {
  commands = new Map<string, (args: unknown, ctx: unknown) => unknown>();
  commandDescriptions = new Map<string, string | undefined>();
  handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  providers = new Map<string, unknown>();

  registerCommand(
    name: string,
    spec:
      | {
          handler: (args: unknown, ctx: unknown) => unknown;
          description?: string;
        }
      | ((args: unknown, ctx: unknown) => unknown),
  ) {
    if (typeof spec === "function") {
      this.commands.set(name, spec);
      return;
    }
    this.commands.set(name, spec.handler);
    this.commandDescriptions.set(name, spec.description);
  }

  registerProvider(id: string, config: unknown) {
    this.providers.set(id, config);
  }

  unregisterProvider(id: string) {
    this.providers.delete(id);
  }

  on(event: string, handler: (...args: unknown[]) => unknown) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
}
