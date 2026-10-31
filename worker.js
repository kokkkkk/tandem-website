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

// 3. API endpoint to fetch CMS events with strict 4s timeout (never hangs)
    if (url.pathname === "/api/events") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        // Query GitHub commit feed / tree with timeout
        const feedRes = await fetch(
          "https://github.com/kokkkkk/tandem-website/commits/main/content/events.atom",
          {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              "Accept": "application/atom+xml, text/xml",
            },
          }
        );

        clearTimeout(timeoutId);

        if (!feedRes.ok) {
          return new Response(JSON.stringify({ events: [] }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const xml = await feedRes.text();
        
        // Extract filenames modified in commits under content/events
        // GitHub commit messages or links include the event slug
        const commitRegex = /<title>[\s\S]*?Update\s+([^\s<]+\.md)|Create\s+([^\s<]+\.md)/gi;
        const filenames = new Set();
        let m;
        while ((m = commitRegex.exec(xml)) !== null) {
          const file = m[1] || m[2];
          if (file && file.endsWith(".md")) {
            filenames.add(file.replace(/^content\/events\//, ''));
          }
        }

        // If atom feed regex has matches, fetch raw content; otherwise fallback
        const fileList = Array.from(filenames);

        const events = await Promise.all(
          fileList.map(async (fname) => {
            try {
              const r = await fetch(
                `https://raw.githubusercontent.com/kokkkkk/tandem-website/main/content/events/${fname}`,
                { headers: { "User-Agent": "Mozilla/5.0" } }
              );
              if (!r.ok) return null;
              const content = await r.text();
              return { name: fname, content };
            } catch (_) {
              return null;
            }
          })
        );

        return new Response(JSON.stringify({ events: events.filter(Boolean) }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30",
          },
        });
      } catch (err) {
        clearTimeout(timeoutId);
        // Fail gracefully and immediately if timed out
        return new Response(JSON.stringify({ events: [], error: "Request timed out" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // Default: Fallback to static assets
    return env.ASSETS.fetch(request);
  },
};