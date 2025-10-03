import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const authPopupRef = useRef(null);
  const popupMonitorRef = useRef(null);

  const stopPopupMonitor = useCallback(() => {
    if (popupMonitorRef.current) {
      clearInterval(popupMonitorRef.current);
      popupMonitorRef.current = null;
    }
  }, []);

  const startPopupMonitor = useCallback(() => {
    stopPopupMonitor();
    if (typeof window === 'undefined') return;
    popupMonitorRef.current = window.setInterval(() => {
      const popup = authPopupRef.current;
      if (!popup || popup.closed) {
        stopPopupMonitor();
        authPopupRef.current = null;
        setIsProcessing(false);
      }
    }, 500);
  }, [stopPopupMonitor]);

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
      url: parsedUrl,
    } = parseOAuthParams(url);

    const urlForMessage = typeof parsedUrl === 'string' ? parsedUrl : parsedUrl?.toString?.() || url;

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
          if (isBrowser && window.opener && window.opener !== window) {
            try {
              window.opener.postMessage({ type: 'supabase-auth', url: urlForMessage }, window.location.origin);
            } catch (postMessageError) {
              console.warn('[Auth] Failed to post message to opener:', postMessageError);
            }
            setTimeout(() => {
              window.close();
            }, 100);
          }

          if (!isElectron && isBrowser) {
            const shouldResetLocation = window.location.pathname.startsWith('/auth/callback')
              || window.location.href.includes('auth/callback')
              || window.location.href.includes('access_token=')
              || window.location.href.includes('code=');
            if (shouldResetLocation) {
              window.location.replace('/');
              return;
            }
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
          if (isBrowser && window.opener && window.opener !== window) {
            try {
              window.opener.postMessage({ type: 'supabase-auth', url: urlForMessage }, window.location.origin);
            } catch (postMessageError) {
              console.warn('[Auth] Failed to post message to opener:', postMessageError);
            }
            setTimeout(() => {
              window.close();
            }, 100);
          }

          if (!isElectron && isBrowser) {
            const shouldResetLocation = window.location.pathname.startsWith('/auth/callback')
              || window.location.href.includes('auth/callback')
              || window.location.href.includes('access_token=')
              || window.location.href.includes('code=');
            if (shouldResetLocation) {
              window.location.replace('/');
              return;
            }
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

    let popup = null;
    let usePopupFlow = false;

    if (!isElectron) {
      try {
        popup = window.open('', 'schedule-auth', 'width=600,height=720,menubar=no,toolbar=no,location=no,status=no');
        if (popup) {
          popup.document.write('<!doctype html><title>認証中…</title><p style="font-family:sans-serif;padding:1rem;">Googleでログインしています…</p>');
          popup.focus();
          authPopupRef.current = popup;
          usePopupFlow = true;
          startPopupMonitor();
        }
      } catch (popupError) {
        console.warn('[Auth] Failed to open auth popup. Falling back to redirect flow.', popupError);
        authPopupRef.current = null;
        stopPopupMonitor();
      }
    }

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: isElectron || usePopupFlow,
        },
      });

      if (error) {
        console.error('[Auth] Google sign-in failed:', error);
        setAuthError(error.message);
        if (authPopupRef.current && !authPopupRef.current.closed) {
          authPopupRef.current.close();
        }
        authPopupRef.current = null;
        stopPopupMonitor();
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
            stopPopupMonitor();
            throw err;
          }
        } else {
          const fallbackError = new Error('Supabaseから認証URLを取得できませんでした。');
          setAuthError(fallbackError.message);
          setIsProcessing(false);
          stopPopupMonitor();
          throw fallbackError;
        }
      } else if (usePopupFlow) {
        if (data?.url && authPopupRef.current && !authPopupRef.current.closed) {
          authPopupRef.current.location.replace(data.url);
        } else {
          if (authPopupRef.current && !authPopupRef.current.closed) {
            authPopupRef.current.close();
          }
          authPopupRef.current = null;
          stopPopupMonitor();
          window.location.assign(data?.url || redirectTo);
        }
      } else if (!usePopupFlow && data?.url) {
        window.location.assign(data.url);
      }
    } catch (error) {
      if (authPopupRef.current && !authPopupRef.current.closed) {
        authPopupRef.current.close();
      }
      authPopupRef.current = null;
      stopPopupMonitor();
      if (!isElectron) {
        setIsProcessing(false);
      }
      throw error;
    }

    if (isElectron || !usePopupFlow) {
      setIsProcessing(false);
      stopPopupMonitor();
    }
  }, [startPopupMonitor, stopPopupMonitor]);

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
    if (!isBrowser) return undefined;

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data;
      if (!payload || payload.type !== 'supabase-auth' || !payload.url) return;

      handleOAuthResult(payload.url);

      if (authPopupRef.current && !authPopupRef.current.closed) {
        authPopupRef.current.close();
      }
      authPopupRef.current = null;
      stopPopupMonitor();

      try {
        window.focus();
      } catch (focusError) {
        console.warn('[Auth] Failed to focus main window after OAuth:', focusError);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleOAuthResult, stopPopupMonitor]);

  useEffect(() => {
    if (!isBrowser) return;

    const currentUrl = window.location.href;
    const hasOAuthParams = currentUrl.includes('auth/callback') || currentUrl.includes('access_token=') || currentUrl.includes('code=');

    if (hasOAuthParams) {
      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage({ type: 'supabase-auth', url: currentUrl }, window.location.origin);
        } catch (postMessageError) {
          console.warn('[Auth] Failed to notify opener about OAuth callback:', postMessageError);
        }
        setTimeout(() => {
          window.close();
        }, 100);
        return;
      }

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

  useEffect(() => () => {
    stopPopupMonitor();
    if (authPopupRef.current && !authPopupRef.current.closed) {
      authPopupRef.current.close();
    }
    authPopupRef.current = null;
  }, [stopPopupMonitor]);

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

