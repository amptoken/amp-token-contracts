import { Constants, TestHarness } from './utils'

const { NAME, SYMBOL, GRANULARITY, DEFAULT_PARTITION } = Constants

contract('Amp with', function ([owner]) {
  before(async function () {
    const harness = new TestHarness({ owner })
    this.amp = await harness.init()
  })

  describe('Amp properties', function () {
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
})
