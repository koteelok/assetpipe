export interface Pipeline {
  id: string;
  delaminated: boolean;
}

export class PipelineMixin<TArgs extends any[], TReturn extends Pipeline> {
  private static instances: PipelineMixin<any, any>[] = [];
  private static staticSymbol = Symbol();
  private instanceSymbol = Symbol();
  private parentSymbols: symbol[] = [];

  constructor(
    private applyOptions: (obj: any, ...args: TArgs) => TReturn,
    private parent?: PipelineMixin<any, any>
  ) {
    let current = parent;
    while (current) {
      this.parentSymbols.push(current.instanceSymbol);
      if (current.parent) current = current.parent;
    }
    PipelineMixin.instances.push(this);
  }

  static is(obj: any): obj is Pipeline {
    return obj[PipelineMixin.staticSymbol] === true;
  }

  is(obj: any): obj is TReturn {
    return obj[this.instanceSymbol] === true;
  }

  mixin(obj: any, ...args: TArgs) {
    for (const mixin of PipelineMixin.instances) {
      obj[mixin.instanceSymbol] = false;
    }
    obj[PipelineMixin.staticSymbol] = true;
    obj[this.instanceSymbol] = true;
    for (const parentSymbol of this.parentSymbols) {
      obj[parentSymbol] = true;
    }
    return this.applyOptions(obj, ...args);
  }
}
