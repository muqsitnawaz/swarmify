export const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID || '';
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';

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
