import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const [modelsPath, authPath] = process.argv.slice(2);
if (!modelsPath || !authPath) throw new Error("models.json and auth.json paths are required");

const runtime = await ModelRuntime.create({
  modelsPath,
  authPath,
  refreshOnCreate: false,
  allowModelNetwork: false,
});
const model = runtime.getModel("failover", "coding");
if (!model) throw new Error("persisted failover model was not discovered");

process.stdout.write(
  JSON.stringify({
    provider: model.provider,
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
    registeredExtension: runtime.getRegisteredProviderConfig("failover") !== undefined,
  }),
);
