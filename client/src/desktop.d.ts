export {};

declare global {
  interface Window {
    scorelabDesktop?: {
      getStorageLocation: () => Promise<{
        dataDir: string;
        previousDataDirs: Array<{ path: string; changedAt: string; exists: boolean }>;
      }>;
      changeStorageLocation: () => Promise<{
        changed: boolean;
        dataDir?: string;
        previousDataDir?: string;
      }>;
      acknowledgePreviousStorageLocation: (previousPath: string) => Promise<{ ok: boolean }>;
    };
  }
}
