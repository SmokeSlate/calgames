/**
 * GitHub OAuth token exchange proxy for Google Apps Script.
 *
 * Deploy this as a web app (Execute as: Me, Access: Anyone) and then
 * reference the published URL inside the submission config. The front-end
 * should call the web app through the CORS proxy at
 * https://p.smokeslate.xyz/?url= to avoid browser restrictions.
 */
const CLIENT_ID = 'YOUR_GITHUB_OAUTH_CLIENT_ID';
const CLIENT_SECRET = 'YOUR_GITHUB_OAUTH_CLIENT_SECRET';

// Optional: restrict which redirect URIs are accepted by this proxy.
const ALLOWED_REDIRECT_URIS = [
  'https://your-domain.example/tools/submit/',
  'http://localhost:5000/tools/submit/'
];

const GITHUB_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';

/**
 * Handle the OAuth code exchange via POST.
 * @param {Object} e The Apps Script request event.
 * @returns {ContentService.TextOutput}
 */
function doPost(e) {
  const corsHeaders = buildCorsHeaders();

  if (!e || !e.postData || !e.postData.contents) {
    return respond({ error: 'Missing request body.' }, corsHeaders, 400);
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (error) {
    return respond({ error: 'Request body must be valid JSON.' }, corsHeaders, 400);
  }

  const code = payload.code;
  const state = payload.state;
  const redirectUri = payload.redirectUri;
  const clientId = payload.clientId;

  if (!code || !state || !redirectUri) {
    return respond({ error: 'code, state, and redirectUri are required.' }, corsHeaders, 400);
  }

  if (clientId && clientId !== CLIENT_ID) {
    return respond({ error: 'clientId does not match the configured proxy.' }, corsHeaders, 403);
  }

  if (!isRedirectAllowed(redirectUri)) {
    return respond({ error: 'redirectUri is not allowed for this proxy.' }, corsHeaders, 403);
  }

  try {
    const githubResponse = UrlFetchApp.fetch(GITHUB_TOKEN_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: 'application/json' },
      payload: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        state: state,
        redirect_uri: redirectUri
      }),
      muteHttpExceptions: true
    });

    const status = githubResponse.getResponseCode();
    const bodyText = githubResponse.getContentText();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      body = { error: 'Unable to parse GitHub response.', raw: bodyText };
    }

    if (status >= 400) {
      return respond({ error: 'GitHub rejected the OAuth exchange.', details: body }, corsHeaders, status);
    }

    return respond({
      access_token: body.access_token,
      scope: body.scope,
      token_type: body.token_type
    }, corsHeaders, 200);
  } catch (error) {
    return respond({ error: 'Unexpected error while contacting GitHub.', details: String(error) }, corsHeaders, 500);
  }
}

/**
 * Respond to simple GET requests (health checks / lightweight preflight fallback).
 * @returns {ContentService.TextOutput}
 */
function doGet() {
  return respond({ status: 'ok' }, buildCorsHeaders(), 200);
}

/**
 * Build a consistent set of CORS headers for responses.
 * @returns {Object<string, string>}
 */
function buildCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

/**
 * Validate the redirect URI if a whitelist is defined.
 * @param {string} redirectUri
 * @returns {boolean}
 */
function isRedirectAllowed(redirectUri) {
  if (!ALLOWED_REDIRECT_URIS || ALLOWED_REDIRECT_URIS.length === 0) {
    return true;
  }
  return ALLOWED_REDIRECT_URIS.indexOf(redirectUri) !== -1;
}

/**
 * Create an Apps Script response with optional status metadata.
 * @param {Object} body
 * @param {Object<string, string>} headers
 * @param {number} status
 * @returns {ContentService.TextOutput}
 */
function respond(body, headers, status) {
  const output = ContentService.createTextOutput(JSON.stringify(body));
  output.setMimeType(ContentService.MimeType.JSON);
  if (headers) {
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key)) {
        output.setHeader(key, headers[key]);
      }
    }
  }
  if (typeof status === 'number') {
    output.setHeader('X-Proxy-Status', String(status));
  }
  return output;
}
