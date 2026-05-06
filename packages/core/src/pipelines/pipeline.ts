export interface Pipeline {
  id: number;
}

export interface PipelineOptions {
  kind: string;
}

export type Materialize = <T extends Pipeline>(options: PipelineOptions) => T;

export class PipelineMixin<
  TInstance extends Pipeline = Pipeline,
  TOptions extends PipelineOptions = PipelineOptions,
> {
  static instances: PipelineMixin<any, any>[] = [];
  static byKind = new Map<string, PipelineMixin<any, any>>();
  static mixinKey = "$isPipeline";

  private instanceKey: string;

  constructor(
    private name: string,
    private apply: (
      obj: TInstance,
      options: TOptions,
      materialize: Materialize,
    ) => void,
    private parent?: PipelineMixin<any, any>,
  ) {
    this.instanceKey = `$is${this.name}`;
    PipelineMixin.instances.push(this);
    PipelineMixin.byKind.set(name, this);
  }

  static is(
    obj: any,
  ): obj is Pipeline & { [PipelineMixin.mixinKey]: PipelineMixin<any, any> } {
    return obj && obj[PipelineMixin.mixinKey] !== undefined;
  }

  is(
    obj: any,
  ): obj is TInstance & { [PipelineMixin.mixinKey]: PipelineMixin<any, any> } {
    return obj && obj[this.instanceKey] === true;
  }

  build(options: TOptions, materialize: Materialize): TInstance {
    const obj: any = {};
    for (let i = 0; i < PipelineMixin.instances.length; i++) {
      obj[PipelineMixin.instances[i].instanceKey] = false;
    }
    obj[PipelineMixin.mixinKey] = this;
    let current: PipelineMixin<any, any> | undefined = this;
    while (current) {
      obj[current.instanceKey] = true;
      current.apply(obj, options, materialize);
      current = current.parent;
    }
    return obj;
  }

  static materialize<T extends Pipeline>(rootOptions: PipelineOptions): T {
    const seen = new WeakMap<PipelineOptions, Pipeline>();
    const materialize = <U extends Pipeline>(options: PipelineOptions): U => {
      const cached = seen.get(options);
      if (cached) return cached as U;
      const mixin = PipelineMixin.byKind.get(options.kind);
      if (!mixin) {
        throw new Error(`Unknown pipeline kind: ${options.kind}`);
      }
      const obj = mixin.build(options, materialize);
      seen.set(options, obj);
      return obj as U;
    };
    return materialize<T>(rootOptions);
  }
}
