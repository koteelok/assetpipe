// --- Utility functions ---
const postfixRE = /[?#].*$/;
export function cleanUrl(url: string) {
  return url.replace(postfixRE, "");
}
