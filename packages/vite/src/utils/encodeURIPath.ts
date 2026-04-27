import { cleanUrl } from "./cleanUrl";

export function encodeURIPath(uri: string) {
  if (uri.startsWith("data:")) return uri;
  const filePath = cleanUrl(uri);
  const postfix = filePath !== uri ? uri.slice(filePath.length) : "";
  return encodeURI(filePath) + postfix;
}
