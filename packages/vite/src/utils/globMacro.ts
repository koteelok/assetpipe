import { parse, Visitor } from "oxc-parser";

/** The import source whose `output` binding activates the macro. */
export const CLIENT_MODULE_ID = "@assetpipe/vite/client";

/** Quick pre-filter so most modules skip parsing entirely. */
export function mayContainGlobCalls(id: string, code: string): boolean {
  return (
    /\.[cm]?[jt]sx?$/.test(id.split("?")[0]) && code.includes(CLIENT_MODULE_ID)
  );
}

export interface OutputGlobCall {
  /** Start offset of the whole `output.glob(...)` call expression. */
  start: number;
  /** End offset of the whole call expression. */
  end: number;
  /** The glob pattern, or `null` when the argument is not a string literal. */
  pattern: string | null;
}

/**
 * Find `output.glob("...")` call expressions where `output` is imported
 * from "@assetpipe/vite/client" (possibly renamed via `import { output as x }`).
 */
export async function findOutputGlobCalls(
  filename: string,
  code: string,
): Promise<OutputGlobCall[]> {
  const { program } = await parse(filename, code);

  const locals = new Set<string>();
  const calls: OutputGlobCall[] = [];

  const visitor = new Visitor({
    ImportDeclaration(node) {
      if (node.source.value !== CLIENT_MODULE_ID) return;
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === "output"
        ) {
          locals.add(specifier.local.name);
        }
      }
    },

    CallExpression(node) {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.computed) return;
      if (
        callee.object.type !== "Identifier" ||
        !locals.has(callee.object.name)
      )
        return;
      if (
        callee.property.type !== "Identifier" ||
        callee.property.name !== "glob"
      )
        return;

      const argument = node.arguments[0];
      const pattern =
        argument?.type === "Literal" && typeof argument.value === "string"
          ? argument.value
          : null;
      calls.push({ start: node.start, end: node.end, pattern });
    },
  });

  visitor.visit(program);
  return calls;
}
