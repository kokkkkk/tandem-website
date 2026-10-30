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

// 3. API endpoint to fetch CMS events (Bypasses API rate limits via public web view & raw CDN)
    if (url.pathname === "/api/events") {
      try {
        // Fetch the public directory page from GitHub (no API rate limit)
        const htmlRes = await fetch(
          "https://github.com/kokkkkk/tandem-website/tree/main/content/events",
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html",
            },
          }
        );

        if (!htmlRes.ok) {
          return new Response(JSON.stringify({ events: [], status: htmlRes.status }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const html = await htmlRes.text();

        // Extract all markdown file paths from the page source
        // Matches links like: /kokkkkk/tandem-website/blob/main/content/events/xxxx.md
        const regex = /href="\/kokkkkk\/tandem-website\/blob\/main\/content\/events\/([^"]+\.md)"/g;
        const filenames = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
          if (!filenames.includes(match[1])) {
            filenames.push(match[1]);
          }
        }

        // Fetch the raw markdown content for each discovered event
        const events = await Promise.all(
          filenames.map(async (filename) => {
            const rawUrl = `https://raw.githubusercontent.com/kokkkkk/tandem-website/main/content/events/${filename}`;
            const res = await fetch(rawUrl, {
              headers: { "User-Agent": "Mozilla/5.0" }
            });
            const text = await res.text();
            return {
              name: filename,
              content: text,
            };
          })
        );

        return new Response(JSON.stringify({ events }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60, s-maxage=60",
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