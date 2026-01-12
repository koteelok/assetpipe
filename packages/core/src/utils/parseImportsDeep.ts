import { readFile } from "fs/promises";
import { parse, Visitor } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";
import path from "path";

let specifiers!: string[];

const visitor = new Visitor({
  CallExpression: (node) => {
    if (
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments[0].type === "Literal" &&
      typeof node.arguments[0].value === "string"
    ) {
      const value = node.arguments[0].value;
      if (!specifiers.includes(value)) {
        specifiers.push(value);
      }
    }
  },

  ImportDeclaration: (node) => {
    const value = node.source.value;
    if (!specifiers.includes(value)) {
      specifiers.push(value);
    }
  },
});

async function parseImports(
  resolver: ResolverFactory,
  filename: string,
  resolved: Set<string>,
) {
  if (resolved.has(filename)) return;
  resolved.add(filename);

  const contents = await readFile(filename, "utf-8");
  const { program } = await parse(filename, contents);

  specifiers = [];
  visitor.visit(program);

  for (const specifier of specifiers) {
    const result = await resolver.resolveFileAsync(filename, specifier);

    if (result.path) {
      await parseImports(resolver, result.path, resolved);
    }
  }
}

export async function parseImportsDeep(filename: string) {
  const resolved = new Set<string>();
  await parseImports(
    ResolverFactory.default(),
    path.resolve(filename),
    resolved,
  );
  return resolved;
}
