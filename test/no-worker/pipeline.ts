import { select, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

export default select.bulk("assets/*").pipe(async (files) => {
  const content = tmpfile();

  const text = await Promise.all(
    files.map((file) => readFile(file.content, "utf-8")),
  ).then((v) => v.join(" | "));

  await writeFile(content, text);

  return [
    {
      basename: "file.txt",
      dirname: "",
      content,
    },
  ];
});
