export interface Pipeline {
  id: string;
  delaminated: boolean;
}

export class PipelineMixin<TArgs extends any[], TReturn extends Pipeline> {
  private static instances: PipelineMixin<any, any>[] = [];
  private static rootSymbol = Symbol("PipelineMixin");
  private instanceSymbol: symbol;
  private parentSymbols: symbol[] = [];

  constructor(
    private name: string,
    private applyOptions: (obj: any, ...args: TArgs) => TReturn,
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

  is(obj: any): obj is TReturn {
    return obj[this.instanceSymbol] === true;
  }

  mixin(obj: any, ...args: TArgs) {
    for (const mixin of PipelineMixin.instances) {
      obj[mixin.instanceSymbol] = false;
    }
    obj[PipelineMixin.rootSymbol] = true;
    obj[this.instanceSymbol] = true;
    for (const parentSymbol of this.parentSymbols) {
      obj[parentSymbol] = true;
    }
    return this.applyOptions(obj, ...args);
  }
}
