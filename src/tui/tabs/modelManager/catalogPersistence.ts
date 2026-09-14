import type { ConfigStore } from "../../../config/configStore.js";
import { toModelNode } from "../../../domain/catalog.js";
import { addModelToProviders } from "../../../domain/providers.js";
import type { CatalogModel, ModelsJson } from "../../../domain/types.js";
import { updateCatalog } from "./forms.js";

export async function persistCatalog(
  config: ConfigStore,
  update: (catalog: CatalogModel[]) => CatalogModel[],
): Promise<boolean> {
  try {
    await updateCatalog(config, update);
    return true;
  } catch {
    return false;
  }
}

export async function persistModelsToProviders(
  modelsFile: { update(fn: (models: ModelsJson) => ModelsJson): Promise<ModelsJson> },
  providerModels: CatalogModel[],
  providerIds: string[],
  done: (models: ModelsJson) => void,
  fail: () => void,
): Promise<void> {
  try {
    const nodes = providerModels.map(toModelNode);
    const next = await modelsFile.update((models) =>
      nodes.reduce((current, node) => addModelToProviders(current, providerIds, node), models),
    );
    done(next);
  } catch {
    fail();
  }
}
