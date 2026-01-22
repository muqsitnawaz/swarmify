import * as vscode from 'vscode';

export const OAUTH_CALLBACK_SCHEME = 'swarmify';

export function setupOAuthCallbackHandler(context: vscode.ExtensionContext): void {
  const handle = vscode.window.registerUriHandler({
    scheme: OAUTH_CALLBACK_SCHEME,
    authority: 'swarmify.swarm-ext'
  });

  context.subscriptions.push(handle);

  handle.event(async (uri: vscode.Uri) => {
    const query = new URLSearchParams(uri.query);
    const code = query.get('code');
    const state = query.get('state');
    const provider = query.get('provider');

    const token = await exchangeCodeForToken(provider, code);

    await vscode.env.set(`${provider}_mcp_token`, token);

    vscode.window.showInformationMessage(`Connected to ${provider}!`);
  });
}

export async function exchangeCodeForToken(provider: string, code: string): Promise<string> {
  const token = await vscode.postMessage({
    type: 'exchangeCodeForToken',
    provider,
    code
  });
  return token;
}

export function generateLinearOAuthURL(redirectUri: string): string {
  const oauthUrl = new URL('https://linear.app/oauth/authorize');
  oauthUrl.searchParams.set('client_id', LINEAR_CLIENT_ID);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('response_type', 'code');
  oauthUrl.searchParams.set('scope', 'read');
  oauthUrl.searchParams.set('state', generateState('linear'));
  oauthUrl.searchParams.set('actor', 'User');
  return oauthUrl.toString();
}

export function generateGitHubOAuthURL(redirectUri: string): string {
  const oauthUrl = new URL('https://github.com/login/oauth/authorize');
  oauthUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('scope', 'read:issue repo');
  oauthUrl.searchParams.set('state', generateState('github'));
  return oauthUrl.toString();
}

function generateState(provider: string): string {
  return `${provider}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
}
