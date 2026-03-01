declare global {
    type UpdateUnsubscribe = () => void;

    interface Window {
        electronAPI: {
            file: {
                convertFileSrc: (filePath: string) => string;
            };
            dialog: {
                selectFolders: () => Promise<string[]>;
                selectInstallImportFile: () => Promise<string | null>;
                selectPlaylistImportFile: () => Promise<string | null>;
                selectPlaylistExportPath: (defaultName: string) => Promise<string | null>;
                selectPlaylistExportDirectory: (defaultName?: string) => Promise<string | null>;
                selectWebsiteVideoCacheDirectory: () => Promise<string | null>;
                selectConverterVideoFile: () => Promise<string | null>;
                selectMusicFiles: () => Promise<string[]>;
                selectConverterFunscriptFile: () => Promise<string | null>;
            };
            window: {
                isFullscreen: () => Promise<boolean>;
                setFullscreen: (value: boolean) => Promise<boolean>;
                toggleFullscreen: () => Promise<boolean>;
                close: () => Promise<boolean>;
            };
            updates: {
                subscribe: (callback: (state: import("../electron/services/updater").AppUpdateState) => void) => UpdateUnsubscribe;
            };
            appOpen: {
                consumePendingFiles: () => Promise<string[]>;
                subscribe: (callback: (filePaths: string[]) => void) => UpdateUnsubscribe;
            };
            auth?: {
                consumePendingCallback: () => Promise<string | null>;
                subscribe: (callback: (url: string) => void) => UpdateUnsubscribe;
            };
        };
    }
}

export { };
