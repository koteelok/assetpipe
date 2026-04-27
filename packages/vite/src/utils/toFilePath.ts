import * as path from "path";

import { cleanUrl } from "./cleanUrl";
import { slash } from "./slash";

export function toFilePath(url: string) {
  let filePath = cleanUrl(url);
  if (filePath.indexOf("%") !== -1) {
    try {
      filePath = decodeURI(filePath);
    } catch {
      /* malformed URI */
    }
  }
  return path.posix.normalize(slash(filePath));
}
