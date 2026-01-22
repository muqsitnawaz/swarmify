interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/oauth/exchange' && request.method === 'POST') {
      try {
        const { code, provider } = await request.json() as { code: string; provider: string };

        if (!code || !provider) {
          return Response.json({ error: 'Missing code or provider' }, { status: 400, headers: CORS_HEADERS });
        }

        if (provider === 'github') {
          const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: env.GITHUB_CLIENT_ID,
              client_secret: env.GITHUB_CLIENT_SECRET,
              code,
            }),
          });

          const data = await response.json() as { access_token?: string; error?: string };

          if (data.error) {
            return Response.json({ error: data.error }, { status: 400, headers: CORS_HEADERS });
          }

          return Response.json({ access_token: data.access_token }, { headers: CORS_HEADERS });

        } else if (provider === 'linear') {
          const response = await fetch('https://api.linear.app/oauth/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: env.LINEAR_CLIENT_ID,
              client_secret: env.LINEAR_CLIENT_SECRET,
              code,
              grant_type: 'authorization_code',
              redirect_uri: 'vscode://swarm-ext/oauth/callback',
            }),
          });

          const data = await response.json() as { access_token?: string; error?: string };

          if (data.error) {
            return Response.json({ error: data.error }, { status: 400, headers: CORS_HEADERS });
          }

          return Response.json({ access_token: data.access_token }, { headers: CORS_HEADERS });

        } else {
          return Response.json({ error: 'Unknown provider' }, { status: 400, headers: CORS_HEADERS });
        }

      } catch (err) {
        console.error('OAuth exchange error:', err);
        return Response.json({ error: 'Internal error' }, { status: 500, headers: CORS_HEADERS });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
  },
};
