export interface Pipeline {
  id: number;
}

export class PipelineMixin<TSchema extends Pipeline> {
  static instances: PipelineMixin<any>[] = [];
  static mixinKey = "$isPipeline";
  private instanceKey: string;

  constructor(
    private name: string,
    private applyOptions: (obj: TSchema, options: Partial<TSchema>) => TSchema,
    private parent?: PipelineMixin<any>,
  ) {
    this.instanceKey = `$is${this.name}`;
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
    for (let i = 0; i < PipelineMixin.instances.length; i++) {
      const mixin = PipelineMixin.instances[i];
      obj[mixin.instanceKey] = false;
    }
    obj[PipelineMixin.mixinKey] = this;
    let current: PipelineMixin<any> | undefined = this;
    while (current) {
      obj[current.instanceKey] = true;
      current.applyOptions(obj, options);
      current = current.parent;
    }
  }
}
