// Wahoo PKCE authentication
const clientId = "Jm_cbkNKssVAPN9wa0583ZKzdyVnjbVs0Jo9FlZ25vo";
const redirectUri = window.location.origin + window.location.pathname;
const authEndpoint = "https://api.wahooligan.com/oauth/authorize";
const tokenEndpoint = "https://api.wahooligan.com/oauth/token";
const scope = "user_read workouts_read";

function base64URLEncode(str) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(digest);
}

async function initiateAuth() {
  try {
    const codeVerifier = await generateCodeVerifier();
    localStorage.setItem("code_verifier", codeVerifier);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const authUrl = new URL(authEndpoint);
    authUrl.searchParams.append("client_id", clientId);
    authUrl.searchParams.append("redirect_uri", redirectUri);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("scope", scope);
    authUrl.searchParams.append("code_challenge", codeChallenge);
    authUrl.searchParams.append("code_challenge_method", "S256");

    window.location.href = authUrl.toString();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function exchangeCodeForToken(code) {
  try {
    const codeVerifier = localStorage.getItem("code_verifier");
    if (!codeVerifier) {
      throw new Error("Code verifier not found");
    }

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirectUri);
    params.append("code_verifier", codeVerifier);

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }

    const data = await response.json();
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    localStorage.setItem("token_expiry", Date.now() + data.expires_in * 1000);
    localStorage.removeItem("code_verifier");

    return { success: true, token: data.access_token };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getAccessToken() {
  const accessToken = localStorage.getItem("access_token");
  const tokenExpiry = localStorage.getItem("token_expiry");

  if (accessToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
    return accessToken;
  }

  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    return null;
  }

  try {
    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    localStorage.setItem("token_expiry", Date.now() + data.expires_in * 1000);

    return data.access_token;
  } catch (error) {
    return null;
  }
}

async function handleAuthRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const error = urlParams.get("error");

  window.history.replaceState({}, document.title, window.location.pathname);

  if (error) {
    return { authenticated: false, error };
  }

  if (code) {
    const result = await exchangeCodeForToken(code);
    return {
      authenticated: result.success,
      token: result.success ? result.token : null,
      error: result.success ? null : result.error,
    };
  } else {
    const token = await getAccessToken();
    return { authenticated: !!token, token };
  }
}

function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("token_expiry");
  localStorage.removeItem("code_verifier");
}

export default {
  initiateAuth,
  getAccessToken,
  handleAuthRedirect,
  logout,
};
