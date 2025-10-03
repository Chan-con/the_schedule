import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AuthContext } from './AuthContextBase.js';

const isBrowser = typeof window !== 'undefined';
const isElectron = isBrowser && !!window.electronAPI;

const isLocalhost = (hostname) => ['localhost', '127.0.0.1'].includes(hostname);

const getWebRedirectUrl = () => {
  if (!isBrowser) return undefined;

  const origin = window.location.origin || '';
  const envRedirect = import.meta.env.VITE_SUPABASE_REDIRECT_URL;

  if (envRedirect) {
    try {
      const configuredUrl = new URL(envRedirect, origin);
      const configuredHostname = configuredUrl.hostname;
      const currentHostname = window.location.hostname;

      const envIsLocal = isLocalhost(configuredHostname);
      const currentIsLocal = isLocalhost(currentHostname);

      if (envIsLocal && !currentIsLocal) {
        console.warn('[Auth] VITE_SUPABASE_REDIRECT_URL points to localhost while running on a remote origin. Falling back to window.location origin.');
      } else {
        return configuredUrl.toString();
      }
    } catch (error) {
      console.warn('[Auth] Failed to parse VITE_SUPABASE_REDIRECT_URL. Falling back to window.location origin.', error);
    }
  }

  return `${origin.replace(/\/$/, '')}/auth/callback`;
};

const getElectronRedirectUrl = () => {
  const envRedirect = import.meta.env.VITE_SUPABASE_ELECTRON_REDIRECT_URL;
  if (envRedirect) return envRedirect;
  return getWebRedirectUrl();
};

const parseOAuthParams = (rawUrl) => {
  if (!rawUrl) return {};
  try {
    const url = new URL(rawUrl);
    const searchParams = url.searchParams;
    const hashParams = new URLSearchParams(url.hash?.replace(/^#/, '') || '');

    return {
      code: searchParams.get('code'),
      error: searchParams.get('error') || searchParams.get('error_description') || hashParams.get('error_description') || hashParams.get('error'),
      accessToken: hashParams.get('access_token'),
      refreshToken: hashParams.get('refresh_token'),
      expiresIn: hashParams.get('expires_in'),
      tokenType: hashParams.get('token_type'),
      providerToken: hashParams.get('provider_token'),
      url,
    };
  } catch (error) {
    console.error('[Auth] Failed to parse OAuth URL:', rawUrl, error);
    return {};
  }
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [authError, setAuthError] = useState(null);

  const finishProcessing = useCallback(() => {
    setIsProcessing(false);
  }, []);

  const handleOAuthResult = useCallback(async (url) => {
    if (!url) return;

    const {
      code,
      error,
      accessToken,
      refreshToken,
      expiresIn,
      tokenType,
    } = parseOAuthParams(url);

    if (error) {
      const decoded = decodeURIComponent(error);
      console.error('[Auth] OAuth error:', decoded);
      setAuthError(decoded);
      finishProcessing();
      return;
    }

    if (code) {
      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession({ authCode: code });
        if (exchangeError) {
          console.error('[Auth] Failed to exchange OAuth code:', exchangeError);
          setAuthError(exchangeError.message);
        } else {
          setAuthError(null);
          if (!isElectron && isBrowser) {
            window.location.replace('/');
            return;
          }
        }
      } catch (exchangeError) {
        console.error('[Auth] Exception during code exchange:', exchangeError);
        setAuthError(exchangeError.message);
      } finally {
        finishProcessing();
      }
      return;
    }

    if (accessToken && refreshToken) {
      try {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn ? Number(expiresIn) : undefined,
          token_type: tokenType || 'bearer',
        });
        if (setSessionError) {
          console.error('[Auth] Failed to set session from hash params:', setSessionError);
          setAuthError(setSessionError.message);
        } else {
          setAuthError(null);
          if (!isElectron && isBrowser) {
            window.location.replace('/');
            return;
          }
        }
      } catch (hashError) {
        console.error('[Auth] Exception while setting session from hash params:', hashError);
        setAuthError(hashError.message);
      } finally {
        finishProcessing();
      }
      return;
    }

    // No actionable params; stop processing
    finishProcessing();
  }, [finishProcessing]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);

    const redirectTo = isElectron ? getElectronRedirectUrl() : getWebRedirectUrl();

    if (!redirectTo) {
      const message = 'リダイレクト先URLが構成されていません。環境変数を確認してください。';
      setAuthError(message);
      throw new Error(message);
    }

    setIsProcessing(true);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: isElectron,
        },
      });

      if (error) {
        console.error('[Auth] Google sign-in failed:', error);
        setAuthError(error.message);
        setIsProcessing(false);
        throw error;
      }

      if (isElectron) {
        if (data?.url) {
          const result = await window.electronAPI?.openUrl?.(data.url);
          if (result && result.success === false) {
            const err = new Error(result.error || '外部ブラウザを起動できませんでした。');
            setAuthError(err.message);
            setIsProcessing(false);
            throw err;
          }
        } else {
          const fallbackError = new Error('Supabaseから認証URLを取得できませんでした。');
          setAuthError(fallbackError.message);
          setIsProcessing(false);
          throw fallbackError;
        }
      }
    } catch (error) {
      if (!isElectron) {
        // Webでは即座にローディングを解除する
        setIsProcessing(false);
      }
      throw error;
    }

    if (!isElectron) {
      // Web環境ではリダイレクト前にローディングを解除
      setIsProcessing(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    setIsProcessing(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[Auth] Sign-out failed:', error);
        setAuthError(error.message);
        setIsProcessing(false);
        throw error;
      }
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const initialiseSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (error) {
          console.error('[Auth] Failed to get initial session:', error);
          setAuthError(error.message);
        }

        setSession(data?.session ?? null);
        setUser(data?.session?.user ?? null);
      } catch (error) {
        if (isMounted) {
          console.error('[Auth] Exception while fetching initial session:', error);
          setAuthError(error.message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initialiseSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      finishProcessing();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [finishProcessing]);

  useEffect(() => {
    if (!isBrowser) return;

    const currentUrl = window.location.href;
    const hasOAuthParams = currentUrl.includes('auth/callback') || currentUrl.includes('access_token=') || currentUrl.includes('code=');

    if (hasOAuthParams) {
      handleOAuthResult(currentUrl).finally(() => {
        try {
          const basePath = window.location.pathname.startsWith('/auth/callback') ? '/' : window.location.pathname;
          window.history.replaceState({}, '', basePath);
        } catch (error) {
          console.warn('[Auth] Failed to clean OAuth callback URL', error);
        }
      });
    }
  }, [handleOAuthResult]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.getPendingAuthUrl) return;
    let cancelled = false;

    (async () => {
      try {
        const pending = await window.electronAPI.getPendingAuthUrl();
        if (!cancelled && pending) {
          await handleOAuthResult(pending);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[Auth] Failed to consume pending auth URL:', error);
          setAuthError(error.message);
          finishProcessing();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [finishProcessing, handleOAuthResult]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onAuthCallback) return;
    const unsubscribe = window.electronAPI.onAuthCallback((url) => {
      handleOAuthResult(url);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleOAuthResult]);

  const value = useMemo(() => ({
    supabase,
    session,
    user,
    isLoading,
    isProcessing,
    authError,
    signInWithGoogle,
    signOut,
    clearAuthError: () => setAuthError(null),
    isElectron,
  }), [authError, isLoading, isProcessing, session, signInWithGoogle, signOut, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

