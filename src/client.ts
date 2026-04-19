import type { BetterAuthClientPlugin } from "better-auth/client";
import type { atproto } from "./server.js";

export const atprotoClient = () =>
  ({
    id: "atproto",
    // oxlint-disable-next-line no-unsafe-type-assertion -- required by better-auth plugin inference
    $InferServerPlugin: {} as ReturnType<typeof atproto>,
    getActions: ($fetch) => ({
      signIn: {
        atproto: async (data: { handle: string; callbackURL?: string }) => {
          return $fetch("/sign-in/atproto", {
            method: "POST",
            body: data,
          });
        },
      },
      atproto: {
        getSession: async () => $fetch("/atproto/session", { method: "GET" }),
        restore: async () => $fetch("/atproto/restore", { method: "POST" }),
        signOut: async () => $fetch("/atproto/sign-out", { method: "POST" }),
      },
    }),
  }) satisfies BetterAuthClientPlugin;
