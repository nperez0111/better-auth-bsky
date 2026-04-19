import type { BetterAuthClientPlugin } from "better-auth/client";
import type { atproto } from "./server.js";

export const atprotoClient = () =>
  ({
    id: "atproto",
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
        signOut: async () => $fetch("/atproto/sign-out", { method: "POST" }),
      },
    }),
  }) satisfies BetterAuthClientPlugin;
