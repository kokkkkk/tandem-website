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

    // 3. API endpoint to fetch CMS events
    if (url.pathname === "/api/events") {
      try {
        const ghRes = await fetch("https://api.github.com/repos/kokkkkk/tandem-website/contents/content/events", {
          headers: {
            "User-Agent": "Tandem-Website-Worker",
            "Accept": "application/vnd.github.v3+json"
          }
        });

        if (!ghRes.ok) {
          return new Response(JSON.stringify({ events: [] }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const files = await ghRes.json();
        const mdFiles = Array.isArray(files) ? files.filter(f => f.name.endsWith(".md")) : [];

        const events = await Promise.all(
          mdFiles.map(async (file) => {
            const rawRes = await fetch(file.download_url);
            const text = await rawRes.text();
            return { name: file.name, content: text };
          })
        );

        return new Response(JSON.stringify({ events }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ events: [], error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Default: Fallback to static assets
    return env.ASSETS.fetch(request);
  },
};