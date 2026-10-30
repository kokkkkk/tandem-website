export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. 發起 GitHub OAuth 請求
  if (url.pathname === "/api/auth") {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=repo`;
    return Response.redirect(authUrl, 302);
  }

  // 2. 接收 GitHub Callback 並換取 Token
  if (url.pathname === "/api/auth/callback") {
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

    // 傳送 token 返畀 Decap CMS 視窗
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

  return new Response("Not Found", { status: 404 });
}