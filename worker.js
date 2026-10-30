export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. GitHub OAuth initiation
    if (url.pathname === "/api/auth" || url.pathname === "/auth") {
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=repo`;
      return Response.redirect(authUrl, 302);
    }

    // 2. GitHub OAuth callback
    if (url.pathname === "/callback" || url.pathname === "/api/auth/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing code parameter", { status: 400 });
      }

      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const data = await tokenResponse.json();
      if (data.error) {
        return new Response(`GitHub OAuth Error: ${data.error_description || data.error}`, { status: 400 });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <body>
          <script>
            const receiveMessage = (message) => {
              window.opener.postMessage(
                'authorization:github:success:${JSON.stringify({ token: data.access_token, provider: "github" })}',
                message.origin
              );
              window.removeEventListener("message", receiveMessage, false);
            };
            window.addEventListener("message", receiveMessage, false);
            window.opener.postMessage("authorizing:github", "*");
          </script>
        </body>
        </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // 3. API endpoint to fetch CMS events (No GitHub API token or rate-limits needed)
    if (url.pathname === "/api/events") {
      try {
        // Query repo file tree via jsDelivr CDN
        const treeRes = await fetch(
          "https://data.jsdelivr.net/v1/packages/gh/kokkkkk/tandem-website@main/flat"
        );

        if (!treeRes.ok) {
          return new Response(JSON.stringify({ events: [], error: "Failed to read repo tree" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const data = await treeRes.json();
        // Filter for markdown files inside content/events/
        const mdFiles = (data.files || []).filter(
          (file) => file.name.startsWith("/content/events/") && file.name.endsWith(".md")
        );

        if (mdFiles.length === 0) {
          return new Response(JSON.stringify({ events: [] }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        // Fetch each raw markdown file directly from raw.githubusercontent.com
        const events = await Promise.all(
          mdFiles.map(async (file) => {
            const rawUrl = `https://raw.githubusercontent.com/kokkkkk/tandem-website/main${file.name}`;
            const rawRes = await fetch(rawUrl);
            const text = await rawRes.text();
            return {
              name: file.name.split("/").pop(),
              content: text,
            };
          })
        );

        return new Response(JSON.stringify({ events }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30, s-maxage=30",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ events: [], error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // Default: Fallback to static assets
    return env.ASSETS.fetch(request);
  },
};