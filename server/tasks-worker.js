// 任务派生 worker：在独立线程执行同步读库（node:sqlite），主线程 event loop 不被阻塞
// 一次性 worker（每次派生 fork 一个，用完即退），无跨请求状态残留
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const T = require('./task-derive')

let result
try {
  result = T.deriveTasksSafe(workerData && workerData.dbPath)
} catch (e) {
  result = T.taskDegraded('worker-error', '任务派生失败：' + String((e && e.message) || e))
}
parentPort.postMessage(result)
