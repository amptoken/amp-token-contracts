import * as INames from './inames'
import * as Constants from './constants'
import * as Helpers from './helpers'
import * as Events from './events'

export { Constants, INames, Helpers, Events }
export { default as TestHarness } from './harness'

export const assertEqualEvent = (event, name, values = {}) => {
  assert.equal(event.event, name)
  Object.keys(values).forEach((k) => {
    assert.equal(event.args[k], values[k])
  })
}

export const assertEqualEvents = (events, wanted) => {
  assert.equal(events.length, wanted.length)
  events.forEach((event, i) => {
    assertEqualEvent(event, wanted[i].name, wanted[i].values)
  })
}

export const assertLogsContainEvent = (logs = [], wanted) => {
  const found = logs.find((log) => log.event === wanted.name)
  assert.exists(found)
  assertEqualEvent(found, wanted.name, wanted.values)
}
