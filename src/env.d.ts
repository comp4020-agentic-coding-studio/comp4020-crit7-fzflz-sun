/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    // Set once per request by src/middleware.ts, resolved from the session
    // cookie. Null for an unauthenticated request that middleware allows
    // through (public routes like /readme/).
    user: { id: number; username: string; displayName: string } | null;
  }
}
