/*!
 * littleDJ 系统通知 Service Worker（task318）。
 *
 * 只做两件事：提供 registration.showNotification() 能力（安卓/鸿蒙浏览器
 * 不支持页面里 new Notification()，只有 SW 能发系统通知，锁屏时带系统提示音+振动），
 * 以及处理通知点击（聚焦已开的小 DJ 窗口）。
 *
 * 故意不注册 fetch handler：不缓存、不拦截任何请求，页面行为保持不变。
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      try {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of all) {
          if ('focus' in client) {
            await client.focus()
            return
          }
        }
        if (self.clients.openWindow) await self.clients.openWindow('/')
      } catch (e) {
        /* 打不开就算了，通知本身已经响过 */
      }
    })(),
  )
})
