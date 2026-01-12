export interface Pipeline {
  id: number;
}

export class PipelineMixin<TSchema extends Pipeline> {
  static instances: PipelineMixin<any>[] = [];
  static mixinKey = "$isPipeline";
  private instanceKey: string;
  private parentKeys: string[] = [];

  constructor(
    private name: string,
    private applyOptions: (obj: TSchema, options: Partial<TSchema>) => TSchema,
    private parent?: PipelineMixin<any>,
  ) {
    this.instanceKey = `$is${this.name}`;
    let current = parent;
    while (current) {
      this.parentKeys.push(current.instanceKey);
      current = current.parent;
    }
    PipelineMixin.instances.push(this);
  }

  static is(
    obj: any,
  ): obj is Pipeline & { [PipelineMixin.mixinKey]: PipelineMixin<Pipeline> } {
    return obj[PipelineMixin.mixinKey] !== undefined;
  }

  is(
    obj: any,
  ): obj is TSchema & { [PipelineMixin.mixinKey]: PipelineMixin<TSchema> } {
    return obj[this.instanceKey] === true;
  }

  mix(obj: any, options: Partial<TSchema>) {
    for (const mixin of PipelineMixin.instances) {
      obj[mixin.instanceKey] = false;
    }
    obj[PipelineMixin.mixinKey] = this;
    obj[this.instanceKey] = true;
    for (const parentSymbol of this.parentKeys) {
      obj[parentSymbol] = true;
    }
    return this.applyOptions(obj, options);
  }
}
