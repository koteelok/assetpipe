import { createSession } from "./createSession";
import type { AssetpipeOptions } from "./options";

export async function run(options: AssetpipeOptions): Promise<void> {
  const { outputDirectory, onOutput } = options;
  if (!outputDirectory && !onOutput) {
    throw new Error("Either outputDirectory or onOutput must be provided");
  }

  const { session, terminate } = await createSession(options);
  try {
    const { files, metadata } = await session.runCycle();
    if (files) onOutput?.(files, metadata);
  } finally {
    await terminate();
  }
}
