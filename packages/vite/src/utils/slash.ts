const windowsSlashRE = /\\/g;
export function slash(p: string) {
  return p.replace(windowsSlashRE, "/");
}
