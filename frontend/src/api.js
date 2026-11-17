// Thin wrapper around fetch for the exercise-tracker backend.
// The base URL is public configuration; tokens are never read from env files.
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status, retryAfterSeconds = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 means the server could not be reached at all.
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function request(path, { method = 'GET', body, query, token, signal } = {}) {
  let url = API_BASE_URL + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const text = params.toString();
    if (text) url += `?${text}`;
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server', 0);
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }
  if (!response.ok) {
    // Retry-After is only readable when the backend exposes it to browsers.
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new ApiError(
      data?.error?.message || 'Request failed',
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  if (data === null) throw new ApiError('The server sent an unreadable response', response.status);
  return data;
}

// Plain-language messages for the people using the site.
export function describeError(error) {
  if (!error) return '';
  switch (error.status) {
    case 0:
      return 'We could not reach the server. Check that it is running and that you are connected, then try again.';
    case 401:
      return 'Your session has ended. Please sign in again.';
    case 403:
      return 'You do not have permission to do that.';
    case 404:
      return 'That record could not be found, or you no longer have access to it.';
    case 413:
      return 'That entry is too long. Please shorten it and try again.';
    case 429: {
      const seconds = error.retryAfterSeconds;
      const wait = seconds ? `about ${Math.max(1, Math.ceil(seconds / 60))} minute(s)` : 'up to 15 minutes';
      return `Too many sign-in attempts. Please wait ${wait} before trying again.`;
    }
    case 400:
    case 409:
      return error.message;
    default:
      if (error.status >= 500) return 'The server had a problem. Please try again in a moment.';
      return error.message || 'Something went wrong. Please try again.';
  }
}
