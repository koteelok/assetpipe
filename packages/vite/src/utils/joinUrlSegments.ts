export function joinUrlSegments(a: string, b: string) {
  if (!a || !b) return a || b || "";
  if (a.endsWith("/")) a = a.substring(0, a.length - 1);
  if (b[0] !== "/") b = "/" + b;
  return a + b;
}
