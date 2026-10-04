const rawUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const API_BASE_URL = rawUrl ? (rawUrl.endsWith('/api') ? rawUrl : `${rawUrl}/api`) : '/api';
