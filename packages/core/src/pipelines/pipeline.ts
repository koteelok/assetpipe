export interface Pipeline {
  id: string;
}

export class PipelineMixin<TOptions extends any, TReturn extends Pipeline> {
  static instances: PipelineMixin<any, any>[] = [];
  static optionsKey = "$Options";
  static rootKey = "$isPipeline";
  private instanceKey: string;
  private parentKeys: string[] = [];

  constructor(
    private name: string,
    private applyOptions: (obj: any, options: TOptions) => TReturn,
    private parent?: PipelineMixin<any, any>
  ) {
    this.instanceKey = `$is${this.name}`;
    let current = parent;
    while (current) {
      this.parentKeys.push(current.instanceKey);
      current = current.parent;
    }
    PipelineMixin.instances.push(this);
  }

  static is(obj: any): obj is Pipeline {
    return obj[PipelineMixin.rootKey] === true;
  }

  is(obj: any): obj is TReturn & { [PipelineMixin.optionsKey]: TOptions } {
    return obj[this.instanceKey] === true;
  }

  mixin(obj: any, options: TOptions) {
    for (const mixin of PipelineMixin.instances) {
      obj[mixin.instanceKey] = false;
    }
    obj[PipelineMixin.rootKey] = true;
    obj[this.instanceKey] = true;
    for (const parentSymbol of this.parentKeys) {
      obj[parentSymbol] = true;
    }
    obj[PipelineMixin.optionsKey] = options;
    return this.applyOptions(obj, options);
  }
}
