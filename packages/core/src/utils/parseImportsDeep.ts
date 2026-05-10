import { readFile } from "fs/promises";
import { parse, Visitor } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";
import path from "path";

const RESOLVER_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

let specifiers!: string[];

function addSpecifier(value: string) {
  if (!specifiers.includes(value)) {
    specifiers.push(value);
  }
}

const visitor = new Visitor({
  CallExpression: (node) => {
    if (
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments[0]?.type === "Literal" &&
      typeof node.arguments[0].value === "string"
    ) {
      addSpecifier(node.arguments[0].value);
    }
  },

  ImportExpression: (node) => {
    if (node.source.type === "Literal" && typeof node.source.value === "string") {
      addSpecifier(node.source.value);
    }
  },

  ImportDeclaration: (node) => {
    addSpecifier(node.source.value);
  },

  ExportNamedDeclaration: (node) => {
    if (node.source) addSpecifier(node.source.value);
  },

  ExportAllDeclaration: (node) => {
    if (node.source) addSpecifier(node.source.value);
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

    if (result.path && !result.path.includes(NODE_MODULES_SEGMENT)) {
      await parseImports(resolver, result.path, resolved);
    }
  }
}

export async function parseImportsDeep(filename: string) {
  const resolved = new Set<string>();
  await parseImports(
    new ResolverFactory({ extensions: RESOLVER_EXTENSIONS }),
    path.resolve(filename),
    resolved,
  );
  return resolved;
}
