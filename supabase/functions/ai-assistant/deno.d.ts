// Ambient declarations for the Deno runtime so editors and tsc (which do not
// resolve npm:/jsr: specifiers) treat imports as any-typed externals.
declare module "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {
  export interface Request extends globalThis.Request {}
  export interface Response extends globalThis.Response {}
}
declare module "npm:@supabase/supabase-js@2" {
  export * as unknown from "unknown";
  export const createClient: any;
  export type SupabaseClient = any;
}
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export const createClient: any;
}
