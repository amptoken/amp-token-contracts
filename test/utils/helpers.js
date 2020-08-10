import { padRight, hexToBytes, bytesToHex, isAddress, toHex } from 'web3-utils'

export const assertTransferEvent = (
  _logs,
  _fromPartition,
  _operator,
  _from,
  _to,
  _amount,
  _data,
  _operatorData
) => {
  const i = 0
  assert.equal(_logs[i].event, 'Transfer')
  assert.equal(_logs[i].args.from, _from)
  assert.equal(_logs[i].args.to, _to)
  assert.equal(_logs[i].args.value, _amount)

  assert.equal(_logs[i + 1].event, 'TransferByPartition')
  assert.equal(_logs[i + 1].args.fromPartition, _fromPartition)
  assert.equal(_logs[i + 1].args.operator, _operator)
  assert.equal(_logs[i + 1].args.from, _from)
  assert.equal(_logs[i + 1].args.to, _to)
  assert.equal(_logs[i + 1].args.value, _amount)
  assert.equal(_logs[i + 1].args.data, _data)
  assert.equal(_logs[i + 1].args.operatorData, _operatorData)
}

export const assertChangePartitionEvent = (
  logs,
  fromPartition,
  toPartition,
  amount
) => {
  const event = logs.find((l) => l.event === 'ChangedPartition')
  assert.exists(event)

  assert.equal(event.args.fromPartition, fromPartition)
  assert.equal(event.args.toPartition, toPartition)
  assert.equal(event.args.value, amount)
}

export const assertBalances = async (
  _contract,
  _tokenHolder,
  _partitions,
  _amounts
) => {
  let totalBalance = 0
  for (var i = 0; i < _partitions.length; i++) {
    totalBalance += _amounts[i]
    await assertBalanceOfByPartition(
      _contract,
      _tokenHolder,
      _partitions[i],
      _amounts[i]
    )
  }
  await assertTotalBalance(_contract, _tokenHolder, totalBalance)
}

export const assertBalanceOf = async (
  _contract,
  _tokenHolder,
  _partition,
  _amount
) => {
  await assertTotalBalance(_contract, _tokenHolder, _amount)
  await assertBalanceOfByPartition(_contract, _tokenHolder, _partition, _amount)
}

export const assertBalanceOfByPartition = async (
  _contract,
  _tokenHolder,
  _partition,
  _amount
) => {
  const balanceByPartition = await _contract.balanceOfByPartition(
    _partition,
    _tokenHolder
  )
  assert.equal(balanceByPartition, _amount)
}

export const assertTotalBalance = async (_contract, _tokenHolder, _amount) => {
  const balance = await _contract.totalBalanceOf(_tokenHolder)
  assert.equal(balance, _amount)
}

export const assertBalance = async (_contract, _tokenHolder, _amount) => {
  const balance = await _contract.balanceOf(_tokenHolder)
  assert.equal(balance, _amount)
}

export const assertTotalSupply = async (_contract, _amount) => {
  const totalSupply = await _contract.totalSupply()
  assert.equal(totalSupply, _amount)
}

export const assertEscResponse = async (
  _response,
  _escCode,
  _additionalCode,
  _destinationPartition
) => {
  assert.equal(_response[0], _escCode)
  assert.equal(_response[1], _additionalCode)
  assert.equal(_response[2], _destinationPartition)
}

export const assertRevertErrCode = async (p, code) => {
  let res
  try {
    res = await p
  } catch (error) {
    assert.equal(error.reason, code)
  }
  assert.notExists(res)
}

export const toPartition = (hex) => {
  const v = padRight(hex, 64)
  return v
}

export const concatHexData = (...parts) => {
  const data = parts.reduce((val, d) => {
    const b = hexToBytes(d)
    return val.concat(...b)
  }, [])

  return bytesToHex(data)
}

export const formatCollateralPartition = (flag, address, sub = '') => {
  if (!isAddress(address)) {
    throw new Error(
      `format partition: ${address} is not a valid ethereum address`
    )
  }

  const subHex = padRight(toHex(sub), 16)
  if (subHex.length > 18) {
    throw new Error(`format partition: sub-partition ${subHex} is too long`)
  }

  const partition = concatHexData(flag, subHex, address)
  if (partition.length !== 66) {
    throw new Error(
      `format partition: partition length must be 64 (was ${
        partition.length - 2
      })`
    )
  }
  return partition
}
