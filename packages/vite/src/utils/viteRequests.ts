const rawRE = /(\?|&)raw(?:&|$)/;
export function isRawRequest(url: string) {
  return rawRE.test(url);
}

const urlRE = /(\?|&)url(?:&|$)/;
export function isUrlRequest(url: string) {
  return urlRE.test(url);
}

const importRE = /(\?|&)import=?(?:&|$)/;
export function isImportRequest(url: string) {
  return importRE.test(url);
}

export function isInternalRequest(url: string) {
  return url.startsWith("/@");
}
