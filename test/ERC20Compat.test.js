import { Constants, TestHarness } from './utils'

const MockERC20Interactor = artifacts.require('MockERC20Interactor')

const { NAME, SYMBOL, GRANULARITY, DEFAULT_PARTITION } = Constants

contract('Amp: ERC20 Compatibility', function ([owner, tokenHolder]) {
  before(async function () {
    this.harness = new TestHarness({ owner })
    this.amp = await this.harness.init()
  })

  describe('ERC20 properties', function () {
    it(`returns the name ${NAME}`, async function () {
      const name = await this.amp.name()

      assert.equal(name, NAME)
    })

    it(`returns the symbol ${SYMBOL}`, async function () {
      const symbol = await this.amp.symbol()

      assert.equal(symbol, SYMBOL)
    })

    it(`returns the granularity ${GRANULARITY}`, async function () {
      const granularity = await this.amp.granularity()

      assert.equal(granularity.toNumber(), GRANULARITY)
    })

    it('returns the default partitions', async function () {
      const defaultPartition = await this.amp.defaultPartition()

      assert.equal(defaultPartition, DEFAULT_PARTITION)
    })
  })

  describe('when another contract needs Amp to satisfy the ERC20 interface', function () {
    it('works', async function () {
      const amount = 1000
      const interactor = await MockERC20Interactor.new(this.amp.address)

      await this.harness.mockSwap(tokenHolder, amount)
      await this.harness.assertBalanceOf(tokenHolder, amount)

      await this.amp.transfer(interactor.address, amount, { from: tokenHolder })
      await this.harness.assertBalanceOf(tokenHolder, 0)
      await this.harness.assertBalanceOf(interactor.address, amount)

      await interactor.moveSomeTokens(tokenHolder, amount)
      await this.harness.assertBalanceOf(tokenHolder, amount)
      await this.harness.assertBalanceOf(interactor.address, 0)
    })
  })
})
