const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const isPushSupported = () => {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
};

export const getReadyServiceWorkerRegistration = async () => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker が利用できません。');
  }
  const registration = await navigator.serviceWorker.ready;
  if (!registration) {
    throw new Error('Service Worker の準備ができていません。');
  }
  return registration;
};

export const getExistingPushSubscription = async () => {
  const registration = await getReadyServiceWorkerRegistration();
  return registration.pushManager.getSubscription();
};

export const subscribePush = async ({ vapidPublicKey }) => {
  if (!isPushSupported()) {
    throw new Error('この環境はPush通知に対応していません。');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('通知が許可されていません。');
  }

  const registration = await getReadyServiceWorkerRegistration();

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  if (!vapidPublicKey) {
    throw new Error('VAPID公開鍵が未設定です。');
  }

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  return subscription;
};

export const unsubscribePush = async () => {
  const registration = await getReadyServiceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return true;
  return existing.unsubscribe();
};
