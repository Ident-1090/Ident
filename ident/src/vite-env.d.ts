/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IDENT_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Latest release tag, injected by vite.config at build time ("" if unavailable).
declare const __IDENT_VERSION__: string;
