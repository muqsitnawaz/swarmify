interface Env {
  // GitHub OAuth secrets per IDE (client_id -> secret mapping)
  GITHUB_SECRET_Ov23liKYaRnJ5DqzmPYO: string;  // VS Code
  GITHUB_SECRET_Ov23libl1NZ18xfKlvhi: string;  // Cursor
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
        const { code, provider, client_id } = await request.json() as { code: string; provider: string; client_id?: string };

        if (!code || !provider) {
          return Response.json({ error: 'Missing code or provider' }, { status: 400, headers: CORS_HEADERS });
        }

        if (provider === 'github') {
          if (!client_id) {
            return Response.json({ error: 'Missing client_id' }, { status: 400, headers: CORS_HEADERS });
          }

          // Look up secret by client_id
          const secretKey = `GITHUB_SECRET_${client_id}` as keyof Env;
          const clientSecret = env[secretKey];

          if (!clientSecret) {
            return Response.json({ error: 'Unknown client_id' }, { status: 400, headers: CORS_HEADERS });
          }

          const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id,
              client_secret: clientSecret,
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
