// ============================================================
// 🔔 CasePool — Firebase Cloud Messaging Service Worker
// ไฟล์นี้ต้องอยู่ที่ root ของ repo (ข้างๆ index.html)
// ============================================================
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC1bnlkqxibYxA4T_giYeN7dyZHcSN5Dek",
  authDomain: "casepool-11685.firebaseapp.com",
  projectId: "casepool-11685",
  storageBucket: "casepool-11685.firebasestorage.app",
  messagingSenderId: "755729743792",
  appId: "1:755729743792:web:327d192340509e4c036075"
});

const messaging = firebase.messaging();

// รับ push notification เมื่อแอปปิดอยู่ (background)
messaging.onBackgroundMessage(payload => {
  const notif = payload.notification || {};
  const title = notif.title || '🚗 CasePool';
  const body  = notif.body  || '';

  return self.registration.showNotification(title, {
    body,
    icon:  'https://raw.githubusercontent.com/umhomecar03-cmyk/umhomecar/main/do.png',
    badge: 'https://raw.githubusercontent.com/umhomecar03-cmyk/umhomecar/main/do.png',
    tag:   'casepool-notif',
    renotify: true,
    requireInteraction: false,
    data: payload.data || {}
  });
});

// คลิก notification เปิดแอป
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
