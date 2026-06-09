/**
 * Cloudflare Pages Worker — Basic Auth for the playground.
 * Copied into dist/ by the deploy script.
 *
 * Username: mog
 * Password: fundamental_mog
 */
export default {
  async fetch(request, env) {
    const CREDENTIALS = { user: 'mog', pass: 'fundamental_mog' };

    const auth = request.headers.get('Authorization');
    if (auth) {
      const [scheme, encoded] = auth.split(' ');
      if (scheme === 'Basic') {
        const decoded = atob(encoded);
        const [user, pass] = decoded.split(':');
        if (user === CREDENTIALS.user && pass === CREDENTIALS.pass) {
          return env.ASSETS.fetch(request);
        }
      }
    }

    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Mog Playground"' },
    });
  },
};
