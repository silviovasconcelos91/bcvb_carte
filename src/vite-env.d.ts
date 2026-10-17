/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CLUB_NAME?: string;
  readonly VITE_CLUB_SHORT?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_LOGIN_EMAIL_DOMAIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
