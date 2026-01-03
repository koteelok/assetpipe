export interface Pipeline {
  id: string;
}

export class PipelineMixin<TOptions extends any, TReturn extends Pipeline> {
  static instances: PipelineMixin<any, any>[] = [];
  static optionsSymbol = Symbol("PipelineMixinOptions");
  static rootSymbol = Symbol("PipelineMixin");
  private instanceSymbol: symbol;
  private parentSymbols: symbol[] = [];

  constructor(
    private name: string,
    private applyOptions: (obj: any, options: TOptions) => TReturn,
    private parent?: PipelineMixin<any, any>
  ) {
    this.instanceSymbol = Symbol(this.name);
    let current = parent;
    while (current) {
      this.parentSymbols.push(current.instanceSymbol);
      current = current.parent;
    }
    PipelineMixin.instances.push(this);
  }

  static is(obj: any): obj is Pipeline {
    return obj[PipelineMixin.rootSymbol] === true;
  }

  is(obj: any): obj is TReturn & { [PipelineMixin.optionsSymbol]: TOptions } {
    return obj[this.instanceSymbol] === true;
  }

  mixin(obj: any, options: TOptions) {
    for (const mixin of PipelineMixin.instances) {
      obj[mixin.instanceSymbol] = false;
    }
    obj[PipelineMixin.rootSymbol] = true;
    obj[this.instanceSymbol] = true;
    for (const parentSymbol of this.parentSymbols) {
      obj[parentSymbol] = true;
    }
    obj[PipelineMixin.optionsSymbol] = options;
    return this.applyOptions(obj, options);
  }
}
