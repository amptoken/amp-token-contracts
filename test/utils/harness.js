import {
  DEFAULT_PARTITION,
  FLAG_CHANGE_PARTITION,
  ZERO_BYTE,
} from './constants'
import { concatHexData, toPartition } from './helpers'

const AmpContract = artifacts.require('Amp')
const MockFXCContract = artifacts.require('MockFXC')
const ERC1820Registry = artifacts.require('ERC1820Registry')

export default class TestHarness {
  _name = 'Amp'
  _symbol = 'AMP'

  constructor({ owner }) {
    this._owner = owner
  }

  async init() {
    return await this._createContracts()
  }

  async _createContracts() {
    this.fxc = await MockFXCContract.new({ from: this._owner })
    this.amp = await AmpContract.new(this.fxc.address, this._name, this._symbol)
    this.registry = await ERC1820Registry.at(
      '0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24'
    )
    return this.amp
  }

  async mockSwap(tokenHolder, amount, partitions = []) {
    const totalAmount = amount * (partitions.length + 1)
    try {
      await this.fxc.mint(tokenHolder, totalAmount, { from: this._owner })
      await this.fxc.approve(this.amp.address, totalAmount, {
        from: tokenHolder,
      })
      await this.amp.swap(tokenHolder, { from: tokenHolder })

      if (partitions.length > 0) {
        partitions.forEach(async (partition) => {
          const data = concatHexData(
            toPartition(FLAG_CHANGE_PARTITION),
            toPartition(partition)
          )

          await this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            tokenHolder,
            amount,
            data,
            ZERO_BYTE,
            {
              from: tokenHolder,
            }
          )
        })
      }
    } catch (error) {
      console.error(error)
    }
  }

  async assertBalanceOf(tokenHolder, amount) {
    const balance = await this.amp.balanceOf(tokenHolder)
    assert.equal(balance, amount)
  }

  async assertBalanceOfByPartition(partition, tokenHolder, amount) {
    const balance = await this.amp.balanceOfByPartition(partition, tokenHolder)
    assert.equal(balance, amount)
  }

  async assertBalances(tokenHolder, partitions = [], amounts = []) {
    let totalBalance = 0
    partitions.forEach(async (partition, i) => {
      totalBalance += amounts[i]
      await this.assertBalanceOfByPartition(partition, tokenHolder, amounts[i])
    })
    await this.assertBalanceOf(tokenHolder, totalBalance)
  }
}
