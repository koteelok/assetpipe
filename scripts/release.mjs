import { createInterface } from "readline";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const packages = ["core", "config", "image", "vite", "cli"];

const pkgPath = (name) => resolve(root, "packages", name, "package.json");
const readPkg = (name) => JSON.parse(readFileSync(pkgPath(name), "utf8"));
const writePkg = (name, data) =>
  writeFileSync(pkgPath(name), JSON.stringify(data, null, 2) + "\n");

const currentVersion = readPkg("core").version;

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "major") return `${major + 1}.0.0`;
  return type;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const answer = await ask(
  `Current version: ${currentVersion}\nRelease (patch/minor/major/x.y.z): `,
);
rl.close();

const newVersion = bumpVersion(currentVersion, answer.trim());
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Invalid version: "${newVersion}"`);
  process.exit(1);
}

console.log(`\nBumping to ${newVersion}...`);

for (const name of packages) {
  const pkg = readPkg(name);
  pkg.version = newVersion;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!pkg[field]) continue;
    for (const dep of Object.keys(pkg[field])) {
      if (dep.startsWith("@assetpipe/")) {
        pkg[field][dep] = `^${newVersion}`;
      }
    }
  }
  writePkg(name, pkg);
}

execSync("npm install", { cwd: root, stdio: "inherit" });
execSync("git add packages/*/package.json package-lock.json", {
  cwd: root,
  stdio: "inherit",
});
execSync(`git commit -m "Release ${newVersion}"`, {
  cwd: root,
  stdio: "inherit",
});
execSync(`git tag v${newVersion}`, { cwd: root, stdio: "inherit" });

console.log(`\nRelease ${newVersion} tagged as v${newVersion}.`);
console.log("Run: git push && git push --tags");
