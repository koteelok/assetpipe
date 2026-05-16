import { createSession } from "./createSession";
import type { AssetpipeOptions } from "./options";
import { rehydrateFiles, rehydrateMetadata } from "./rehydrate";

export async function run(options: AssetpipeOptions): Promise<void> {
  const { outputDirectory, onOutput } = options;
  if (!outputDirectory && !onOutput) {
    throw new Error("Either outputDirectory or onOutput must be provided");
  }

  const { session, terminate } = await createSession(options);
  try {
    const { files, metadata } = await session.runCycle();
    if (files) {
      onOutput?.(
        rehydrateFiles(files),
        metadata ? rehydrateMetadata(metadata) : undefined,
      );
    }
  } finally {
    await terminate();
  }
}
