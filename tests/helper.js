
import _Y from '../../yjs/src/y.js'

import yMemory from '../../y-memory/src/Memory.js'
import yArray from '../src/y-array.js'
import yMap from '../../y-map/src/Map.js'
import yTest from './test-connector.js'

import Chance from 'chance'

export let Y = _Y

Y.extend(yMemory, yArray, yMap, yTest)

export async function garbageCollectAllUsers (t, users) {
  await flushAll(t, users)
  await Promise.all(users.map(u => u.db.emptyGarbageCollector()))
}

export async function compareUsers (t, users) {
  var unsynced = users.filter(u => !u.connector.isSynced)
  unsynced.forEach(u => u.reconnect())
  if (users[0].connector.testRoom != null) {
    // flush for sync if test-connector
    await users[0].connector.testRoom.flushAll(users)
  }
  await Promise.all(unsynced.map(u => {
    return new Promise(function (resolve) {
      u.connector.whenSynced(resolve)
    })
  }))
  await flushAll(t, users)
  // types must be equal before garbage collect
  var userTypeContents = users.map(u => u.share.array._content.map(c => c.val || JSON.stringify(c.type)))
  var data = await Promise.all(users.map(async (u) => {
    var data = {}
    await u.db.garbageCollect()
    await u.db.garbageCollect()
    u.db.requestTransaction(function * () {
      data.os = yield * this.getOperationsUntransformed()
      data.os = data.os.untransformed.map((op) => {
        return Y.Struct[op.struct].encode(op)
      })
      data.ds = yield * this.getDeleteSet()
      data.ss = yield * this.getStateSet()
    })
    await u.db.whenTransactionsFinished()
    return data
  }))
  for (var i = 0; i < data.length - 1; i++) {
    await t.asyncGroup(async () => {
      t.compare(userTypeContents[i], userTypeContents[i + 1], 'types')
      t.compare(data[i].os, data[i + 1].os, 'os')
      t.compare(data[i].ds, data[i + 1].ds, 'ds')
      t.compare(data[i].ss, data[i + 1].ss, 'ss')
    }, `Compare user${i} with user${i + 1}`)
  }
}

export async function initArrays (t, opts) {
  var result = {
    users: []
  }
  var share = Object.assign({ flushHelper: 'Map', array: 'Array' }, opts.share)
  var chance = opts.chance || new Chance(t.getSeed() * 1000000000)
  var connector = Object.assign({ room: 'debugging_' + t.name, testContext: t, chance }, opts.connector)
  for (let i = 0; i < opts.users; i++) {
    let y = await Y({
      connector: connector,
      db: opts.db,
      share: share
    })
    result.users.push(y)
    for (let name in share) {
      result[name + i] = y.share[name]
    }
  }
  result.array0.delete(0, result.array0.length)
  if (result.users[0].connector.testRoom != null) {
    // flush for sync if test-connector
    await result.users[0].connector.testRoom.flushAll(result.users)
  }
  await Promise.all(result.users.map(u => {
    return new Promise(function (resolve) {
      u.connector.whenSynced(resolve)
    })
  }))
  await flushAll(t, result.users)
  return result
}

export async function flushAll (t, users) {
  users = users.filter(u => u.connector.isSynced)
  if (users.length === 0) {
    return
  }
  await wait(0)
  if (users[0].connector.testRoom != null) {
    // use flushAll method specified in Test Connector
    await users[0].connector.testRoom.flushAll(users)
  } else {
    // flush for any connector
    await Promise.all(users.map(u => { return u.db.whenTransactionsFinished() }))

    var flushCounter = users[0].share.flushHelper.get('0') || 0
    flushCounter++
    await Promise.all(users.map(async (u, i) => {
      // wait for all users to set the flush counter to the same value
      await new Promise(resolve => {
        function observer () {
          var allUsersReceivedUpdate = true
          for (var i = 0; i < users.length; i++) {
            if (u.share.flushHelper.get(i + '') !== flushCounter) {
              allUsersReceivedUpdate = false
              break
            }
          }
          if (allUsersReceivedUpdate) {
            resolve()
          }
        }
        u.share.flushHelper.observe(observer)
        u.share.flushHelper.set(i + '', flushCounter)
      })
    }))
  }
}

export async function flushSome (t, users) {
  if (users[0].connector.testRoom == null) {
    // if not test-connector, wait for some time for operations to arrive
    await wait(100)
  }
}

export function wait (t) {
  return new Promise(function (resolve) {
    setTimeout(resolve, t != null ? t : 100)
  })
}
