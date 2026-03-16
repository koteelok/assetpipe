export interface AssetpipeOptions {
  entry: string;
  outputDirectory: string;
  cacheDirectory?: string;
  /**
   * @default true
   */
  useWorker?: boolean;
}
