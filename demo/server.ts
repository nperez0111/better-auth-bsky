import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth.js";

const PORT = 3456;
const useLocal = process.argv.includes("--local") || process.env.LOCAL === "1";

let baseURL: string;
if (useLocal) {
  baseURL = `http://localhost:${PORT}`;
  console.log("\nRunning in local-only mode (no tunnel)");
} else {
  const { startTunnel } = await import("untun");
  const tunnel = await startTunnel({
    port: PORT,
    acceptCloudflareNotice: true,
  });
  const tunnelURL = await tunnel?.getURL();
  baseURL = (tunnelURL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
}

console.log(`Using baseURL: ${baseURL}`);

// 2. Initialize auth with the known (tunnel) baseURL, then run migrations
const auth = createAuth(baseURL);
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();

// 3. Build Hono app with fully-initialized auth
const app = new Hono();

app.use("*", logger());
app.use("/api/auth/**", cors({ origin: (o) => o, credentials: true }));
app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));
app.get("/", (c) => c.html(PAGE_HTML));

// 4. Serve via Bun's native fetch-based server
Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log("Auth ready — open the URL above to sign in\n");

const PAGE_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ATProto Auth Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a; color: #e5e5e5;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #171717; border: 1px solid #262626;
      border-radius: 12px; padding: 2rem; width: 400px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; color: #a3a3a3; margin-bottom: 0.375rem; }
    input {
      width: 100%; padding: 0.625rem 0.75rem;
      background: #0a0a0a; border: 1px solid #333; border-radius: 8px;
      color: #e5e5e5; font-size: 0.9375rem; outline: none;
    }
    input:focus { border-color: #3b82f6; }
    button {
      width: 100%; margin-top: 1rem; padding: 0.625rem;
      background: #3b82f6; color: white; font-weight: 600;
      border: none; border-radius: 8px; font-size: 0.9375rem;
      cursor: pointer;
    }
    button:hover { background: #2563eb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.danger { background: #dc2626; }
    button.danger:hover { background: #b91c1c; }
    .error { color: #ef4444; font-size: 0.875rem; margin-top: 0.75rem; }
    .session { margin-top: 1rem; }
    .session dt { font-size: 0.75rem; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.75rem; }
    .session dd { font-size: 0.9375rem; word-break: break-all; }
    .profile-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .profile-header img {
      width: 48px; height: 48px; border-radius: 50%;
      object-fit: cover; border: 2px solid #333;
    }
    .profile-header .name { font-size: 1rem; font-weight: 600; }
    .profile-header .handle { font-size: 0.8125rem; color: #737373; }
    #status { font-size: 0.8125rem; color: #737373; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>ATProto Auth Demo</h1>

    <div id="sign-in-view">
      <label for="handle">Bluesky Handle</label>
      <input id="handle" type="text" placeholder="yourname.bsky.social" />
      <button id="sign-in-btn">Sign in with ATProto</button>
      <div id="error" class="error"></div>
      <div id="status"></div>
    </div>

    <div id="session-view" style="display:none">
      <div class="profile-header">
        <img id="s-avatar" src="" alt="" style="display:none" />
        <div>
          <div class="name" id="s-name"></div>
          <div class="handle" id="s-handle-display"></div>
        </div>
      </div>
      <dl class="session">
        <dt>DID</dt><dd id="s-did"></dd>
        <dt>Handle</dt><dd id="s-handle"></dd>
        <dt>PDS</dt><dd id="s-pds"></dd>
      </dl>
      <button id="sign-out-btn" class="danger">Sign Out</button>
    </div>
  </div>

  <script>
    const signInView = document.getElementById("sign-in-view");
    const sessionView = document.getElementById("session-view");
    const handleInput = document.getElementById("handle");
    const signInBtn = document.getElementById("sign-in-btn");
    const signOutBtn = document.getElementById("sign-out-btn");
    const errorEl = document.getElementById("error");
    const statusEl = document.getElementById("status");

    async function checkSession() {
      try {
        const res = await fetch("/api/auth/atproto/session", { credentials: "include" });
        if (!res.ok) return false;
        const data = await res.json();
        document.getElementById("s-did").textContent = data.did;
        document.getElementById("s-handle").textContent = data.handle;
        document.getElementById("s-handle-display").textContent = "@" + data.handle;
        document.getElementById("s-pds").textContent = data.pdsUrl;

        // Fetch user session for profile info (name, avatar)
        const userRes = await fetch("/api/auth/get-session", { credentials: "include" });
        if (userRes.ok) {
          const userData = await userRes.json();
          const user = userData.user;
          if (user?.name) {
            document.getElementById("s-name").textContent = user.name;
          } else {
            document.getElementById("s-name").textContent = data.handle;
          }
          if (user?.image) {
            const avatarEl = document.getElementById("s-avatar");
            avatarEl.src = user.image;
            avatarEl.style.display = "block";
          }
        } else {
          document.getElementById("s-name").textContent = data.handle;
        }

        signInView.style.display = "none";
        sessionView.style.display = "block";
        return true;
      } catch {
        return false;
      }
    }

    signInBtn.addEventListener("click", async () => {
      const handle = handleInput.value.trim();
      if (!handle) { errorEl.textContent = "Enter a handle"; return; }

      errorEl.textContent = "";
      signInBtn.disabled = true;
      statusEl.textContent = "Resolving identity...";

      try {
        const res = await fetch("/api/auth/sign-in/atproto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ handle, callbackURL: "/" }),
        });
        const data = await res.json();
        if (data.url) {
          statusEl.textContent = "Redirecting to authorization server...";
          window.location.href = data.url;
        } else {
          errorEl.textContent = data.message || "Sign-in failed";
          signInBtn.disabled = false;
          statusEl.textContent = "";
        }
      } catch (e) {
        errorEl.textContent = e.message;
        signInBtn.disabled = false;
        statusEl.textContent = "";
      }
    });

    signOutBtn.addEventListener("click", async () => {
      await fetch("/api/auth/atproto/sign-out", {
        method: "POST",
        credentials: "include",
      });
      signInView.style.display = "block";
      sessionView.style.display = "none";
    });

    handleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") signInBtn.click();
    });

    checkSession();
  </script>
</body>
</html>`;
