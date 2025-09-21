const DEFAULT_CONFIG = {
  clientId: '',
  owner: '',
  repo: '',
  baseBranch: 'main',
  submissionDirectory: 'submissions',
  tokenProxyUrl: '',
  tokenProxyBase: 'https://p.smokeslate.xyz/?url=',
  tokenProxyEndpoint: '',
  clientSecret: ''
};

const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.__SUBMISSION_CONFIG__ || {});
const GITHUB_OAUTH_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_TOKEN = 'https://github.com/login/oauth/access_token';
const API_ROOT = 'https://api.github.com';

const STATE_KEY = 'cg-submit-oauth-state';
const TOKEN_KEY = 'cg-submit-access-token';

const signInButton = document.getElementById('sign-in');
const signOutButton = document.getElementById('sign-out');
const authContainer = document.getElementById('authenticated');
const authUser = document.getElementById('auth-user');
const statusElement = document.getElementById('status');
const form = document.getElementById('submission-form');
const fieldset = form ? form.querySelector('fieldset') : null;
const submitButton = document.getElementById('submit-button');

let accessToken = sessionStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;

function updateStatus(message, level = 'info') {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message || '';
  statusElement.dataset.status = level;
  statusElement.hidden = !message;
}

function setFormEnabled(isEnabled) {
  if (!fieldset) {
    return;
  }
  fieldset.disabled = !isEnabled;
}

function setLoading(isLoading) {
  if (submitButton) {
    submitButton.disabled = isLoading;
    submitButton.classList.toggle('loading', isLoading);
  }
}

function generateState() {
  const random = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(random, value => value.toString(16)).join('');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function base64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function getRedirectUri() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveTokenProxyUrl() {
  const base = (CONFIG.tokenProxyBase || '').trim();
  const endpoint = (CONFIG.tokenProxyEndpoint || '').trim();

  if (base && endpoint) {
    const templated = base.includes('{{url}}') ? base.replace('{{url}}', encodeURIComponent(endpoint))
      : base.includes('{{URL}}') ? base.replace('{{URL}}', encodeURIComponent(endpoint))
      : null;

    if (templated) {
      return templated;
    }

    const needsJoiner = /[?&=]$/.test(base);
    if (needsJoiner) {
      return `${base}${encodeURIComponent(endpoint)}`;
    }

    if (base.includes('?')) {
      return `${base}&url=${encodeURIComponent(endpoint)}`;
    }

    return `${base}?url=${encodeURIComponent(endpoint)}`;
  }

  if (CONFIG.tokenProxyUrl) {
    return CONFIG.tokenProxyUrl;
  }

  if (endpoint) {
    return endpoint;
  }

  return '';
}

async function exchangeCodeForToken(code, state) {
  const body = { code, state, redirectUri: getRedirectUri() };
  if (!CONFIG.clientId) {
    throw new Error('GitHub OAuth clientId is not configured.');
  }

  const proxyUrl = resolveTokenProxyUrl();

  if (proxyUrl) {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ clientId: CONFIG.clientId }, body))
    });

    if (!response.ok) {
      throw new Error('Unable to exchange OAuth code (proxy error).');
    }

    const data = await response.json();
    if (!data || !data.access_token) {
      throw new Error('Proxy response missing access token.');
    }
    return data.access_token;
  }

  if (!CONFIG.clientSecret) {
    throw new Error('OAuth token exchange is not configured. Provide a tokenProxyUrl, tokenProxyEndpoint, or clientSecret.');
  }

  const response = await fetch(GITHUB_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      code,
      state,
      redirect_uri: getRedirectUri()
    })
  });

  if (!response.ok) {
    throw new Error('GitHub rejected the OAuth token exchange.');
  }

  const data = await response.json();
  if (!data || !data.access_token) {
    throw new Error(data.error_description || 'Unable to retrieve access token.');
  }
  return data.access_token;
}

async function apiRequest(path, options = {}) {
  if (!accessToken) {
    throw new Error('Not authenticated with GitHub.');
  }

  const url = `${API_ROOT}${path}`;
  const headers = Object.assign({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`
  }, options.headers || {});

  const response = await fetch(url, Object.assign({}, options, { headers }));
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload && payload.message ? payload.message : 'GitHub API request failed.');
    error.status = response.status;
    error.response = payload;
    throw error;
  }

  return payload;
}

async function fetchCurrentUser() {
  currentUser = await apiRequest('/user');
  if (authContainer && authUser) {
    authUser.textContent = `Signed in as @${currentUser.login}`;
    authContainer.hidden = false;
  }
  if (signInButton) {
    signInButton.hidden = true;
  }
  setFormEnabled(true);
  updateStatus('You are ready to submit a game.', 'success');
}

async function ensureFork(login) {
  try {
    return await apiRequest(`/repos/${login}/${CONFIG.repo}`);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  await apiRequest(`/repos/${CONFIG.owner}/${CONFIG.repo}/forks`, { method: 'POST' });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      return await apiRequest(`/repos/${login}/${CONFIG.repo}`);
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  throw new Error('Timed out while waiting for your fork to be ready.');
}

async function createBranch(login, branchName, baseSha) {
  try {
    await apiRequest(`/repos/${login}/${CONFIG.repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
    });
  } catch (error) {
    if (error.status === 422) {
      throw new Error('A submission branch already exists. Try again in a moment.');
    }
    throw error;
  }
}

async function ensureCleanBranch(login, branchName) {
  try {
    await apiRequest(`/repos/${login}/${CONFIG.repo}/git/ref/heads/${branchName}`);
    const randomSuffix = Math.random().toString(16).slice(2, 8);
    return `${branchName}-${randomSuffix}`;
  } catch (error) {
    if (error.status === 404) {
      return branchName;
    }
    throw error;
  }
}

function buildSubmissionPayload(formData, login) {
  const files = (formData.get('files') || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const record = {
    title: formData.get('title')?.trim(),
    author: formData.get('authors')?.trim(),
    description: formData.get('description')?.trim(),
    download: formData.get('download')?.trim() || undefined,
    image: formData.get('image')?.trim() || undefined,
    source: formData.get('source')?.trim() || undefined,
    notes: formData.get('notes')?.trim() || undefined,
    fileUpload: files.length ? files : undefined,
    transferer: login,
    submittedAt: new Date().toISOString(),
    status: 'pending',
    submission: 'web-form'
  };

  return JSON.stringify(record, null, 2) + '\n';
}

function validateForm(formData) {
  const title = formData.get('title')?.trim();
  const authors = formData.get('authors')?.trim();
  const description = formData.get('description')?.trim();

  if (!title || !authors || !description) {
    throw new Error('Title, author, and description are required.');
  }
}

function buildPullRequestBody(details, filePath, login) {
  const lines = [];
  lines.push('## New game submission');
  lines.push('');
  lines.push(`- **Title:** ${details.title}`);
  lines.push(`- **Author(s):** ${details.author}`);
  if (details.download) {
    lines.push(`- **Download:** ${details.download}`);
  }
  if (details.image) {
    lines.push(`- **Cover image:** ${details.image}`);
  }
  if (details.source) {
    lines.push(`- **Source:** ${details.source}`);
  }
  lines.push('');
  lines.push(`Intake file: \`${filePath}\``);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Transferer: @' + login);
  lines.push('');
  lines.push('> This pull request was generated automatically by the public submission form.');
  return lines.join('\n');
}

async function submitGame(formData) {
  if (!currentUser) {
    throw new Error('You must sign in with GitHub before submitting a game.');
  }

  validateForm(formData);

  const login = currentUser.login;
  updateStatus('Preparing your submission…', 'info');

  await ensureFork(login);

  const baseRef = await apiRequest(`/repos/${CONFIG.owner}/${CONFIG.repo}/git/ref/heads/${CONFIG.baseBranch}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) {
    throw new Error('Could not find the base branch in the repository.');
  }

  const branchSlug = slugify(formData.get('title') || 'submission');
  const initialBranchName = `submission/${branchSlug}-${Date.now().toString(16)}`;
  const branchName = await ensureCleanBranch(login, initialBranchName);
  await createBranch(login, branchName, baseSha);

  const submissionJson = buildSubmissionPayload(formData, login);
  const submissionData = JSON.parse(submissionJson);

  const fileSlug = slugify(formData.get('title') || 'game');
  const filePath = `${CONFIG.submissionDirectory}/${new Date().toISOString().replace(/[:T]/g, '-').split('.')[0]}-${fileSlug}.json`;

  await apiRequest(`/repos/${login}/${CONFIG.repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add submission for ${submissionData.title}`,
      content: base64EncodeUnicode(submissionJson),
      branch: branchName
    })
  });

  const prTitle = `Add ${submissionData.title} (submission)`;
  const prBody = buildPullRequestBody(submissionData, filePath, login);

  const pullRequest = await apiRequest(`/repos/${CONFIG.owner}/${CONFIG.repo}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: prTitle,
      head: `${login}:${branchName}`,
      base: CONFIG.baseBranch,
      body: prBody,
      maintainer_can_modify: true
    })
  });

  return pullRequest;
}

function clearQueryString() {
  const url = new URL(window.location.href);
  if (url.search) {
    history.replaceState({}, document.title, url.pathname + url.hash);
  }
}

async function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) {
    return;
  }

  const storedState = sessionStorage.getItem(STATE_KEY);
  const returnedState = params.get('state') || '';

  try {
    if (params.has('error')) {
      const description = params.get('error_description') || params.get('error');
      throw new Error(description || 'Authorization was cancelled.');
    }

    if (!storedState || storedState !== returnedState) {
      throw new Error('OAuth state mismatch. Please try signing in again.');
    }

    const code = params.get('code');
    if (!code) {
      throw new Error('Missing authorization code.');
    }

    updateStatus('Completing GitHub sign-in…', 'info');
    accessToken = await exchangeCodeForToken(code, returnedState);
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.removeItem(STATE_KEY);
    updateStatus('Signed in! Loading your GitHub profile…', 'info');
    await fetchCurrentUser();
  } catch (error) {
    updateStatus(error.message || 'GitHub sign-in failed.', 'error');
    sessionStorage.removeItem(TOKEN_KEY);
    accessToken = '';
  } finally {
    clearQueryString();
  }
}

function startOAuthFlow() {
  if (!CONFIG.clientId) {
    updateStatus('GitHub OAuth clientId is missing from the configuration.', 'error');
    return;
  }

  const state = generateState();
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(GITHUB_OAUTH_AUTHORIZE);
  url.searchParams.set('client_id', CONFIG.clientId);
  url.searchParams.set('scope', 'public_repo');
  url.searchParams.set('redirect_uri', getRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');

  window.location.href = url.toString();
}

function signOut() {
  accessToken = '';
  currentUser = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (authContainer) {
    authContainer.hidden = true;
  }
  if (authUser) {
    authUser.textContent = '';
  }
  if (signInButton) {
    signInButton.hidden = false;
  }
  setFormEnabled(false);
  updateStatus('You have been signed out.', 'info');
}

if (signInButton) {
  signInButton.addEventListener('click', event => {
    event.preventDefault();
    startOAuthFlow();
  });
}

if (signOutButton) {
  signOutButton.addEventListener('click', event => {
    event.preventDefault();
    signOut();
  });
}

if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!accessToken) {
      updateStatus('Please sign in with GitHub first.', 'error');
      return;
    }

    setLoading(true);
    updateStatus('Submitting your game…', 'info');

    const formData = new FormData(form);

    try {
      const pullRequest = await submitGame(formData);
      form.reset();
      const prUrl = pullRequest.html_url;
      updateStatus(`Submission created! Review it at ${prUrl}`, 'success');
      if (statusElement) {
        const link = document.createElement('a');
        link.href = prUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'your pull request';
        statusElement.textContent = 'Submission created! Review it at ';
        statusElement.appendChild(link);
        statusElement.append('.');
      }
    } catch (error) {
      updateStatus(error.message || 'Submission failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  });
}

(async () => {
  if (accessToken) {
    try {
      await fetchCurrentUser();
    } catch (error) {
      accessToken = '';
      sessionStorage.removeItem(TOKEN_KEY);
      updateStatus('Your GitHub session expired. Please sign in again.', 'warning');
    }
  } else {
    setFormEnabled(false);
  }

  await handleOAuthRedirect();
})();
