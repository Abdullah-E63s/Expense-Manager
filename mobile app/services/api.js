import axios from 'axios';

// ── Base URL ─────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  'https://ghost993-expensemanager.hf.space';

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 60000, // Longer timeout for AI models
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ── Response interceptor: normalise errors ───────────────────────────────────
api.interceptors.response.use(
  (res) => {
    // If response is data wrapped by axios, we usually just return res
    // But since the API returns JSON directly with success checks:
    return res.data;
  },
  (err) => {
    const message =
      err.response?.data?.error ||
      err.response?.data?.message ||
      err.message ||
      'Something went wrong';
    return Promise.reject(new Error(message));
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

export const sendVerification = (email) =>
  api.post('/api/auth/send-verification', { email });

export const verifyCode = (email, code) =>
  api.post('/api/auth/verify-code', { email, code });

export const signup = (payload) => api.post('/api/auth/signup', payload);

export const login = (email, password) =>
  api.post('/api/auth/login', { email, password });

export const logout = () => api.post('/api/auth/logout');

export const getProfile = () => api.get('/api/auth/account/profile');

export const updateProfile = (payload) => api.put('/api/auth/account/profile', payload);

export const changePassword = (current_password, new_password, confirm_password) =>
  api.post('/api/auth/change-password', {
    current_password,
    new_password,
    confirm_password,
  });

export const forgotPassword = (email) =>
  api.post('/api/auth/forgot-password', { email });

export const deleteAccount = (password) =>
  api.delete('/api/auth/account', { data: { confirm: true, password } });

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════════

export const getExpenses = () => api.get('/api/expenses');

// Handles both plain JSON or FormData (if image is attached)
export const createExpense = (payload) => {
  if (payload instanceof FormData) {
    return api.post('/api/expenses', payload, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
  return api.post('/api/expenses', payload);
};

export const updateExpense = (id, payload) => api.patch(`/api/expenses/${id}`, payload);

export const deleteExpense = (id) => api.delete(`/api/expenses/${id}`);

export const deleteAllExpenses = () => api.delete('/api/expenses/all');

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIPT OCR / YOLO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a receipt image to God Mode YOLO AI (as multipart/form-data).
 */
export const processReceipt = (formData) =>
  api.post('/api/yolo/detect', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS & BUDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const getAnalytics = () => api.get('/api/expenses/analytics');

export const getBudget = () => api.get('/api/expenses/budget');

export const setBudget = (amount, period = 'monthly') =>
  api.post('/api/expenses/budget', { amount, period });

export const deleteBudget = () => api.delete('/api/expenses/budget');

export const exportExpenses = () =>
  api.get('/api/expenses/export', { responseType: 'text' });

export default api;
