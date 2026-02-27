/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_DEVELOPER_EMAILS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
