import { activeTextFilter, TextFilter } from "../../primitives/textFilter.js";

export class ModelManagerFilters {
  readonly provider = new TextFilter();
  readonly model = new TextFilter();

  active(screen: string): TextFilter | undefined {
    return activeTextFilter(screen, this.provider, this.model);
  }

  isEditing(screen: string, nestedEditing: boolean): boolean {
    return this.active(screen)?.isEditing || nestedEditing;
  }
}
