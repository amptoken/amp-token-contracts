import { shouldFail } from 'openzeppelin-test-helpers'
import { TestHarness, Constants, Events } from './utils'

const { FXC_GRAVEYARD, ZERO_ADDRESS, DEFAULT_PARTITION } = Constants
const emptyBalance = 0
const fxcBalanceMock = 1000

contract('Amp: Swapping', function ([owner, controller, tokenHolder, unknown]) {
  before(async function () {
    this.harness = new TestHarness({ owner })
  })

  beforeEach(async function () {
    this.amp = await this.harness.init()
    this.fxc = this.harness.fxc
  })

  it('sets the FXC contract upon deployment', async function () {
    const fxcAddress = await this.amp.swapToken.call()
    assert.equal(fxcAddress, this.fxc.address)
  })

  describe('when holder has tokens and transfer is approved', function () {
    beforeEach(async function () {
      await this.fxc.mint(tokenHolder, fxcBalanceMock, { from: owner })
      await this.fxc.approve(this.amp.address, fxcBalanceMock, {
        from: tokenHolder,
      })
    })

    describe('when the holder execute the swapping', function () {
      it('swap accordingly', async function () {
        const { logs } = await this.amp.swap(tokenHolder, {
          from: tokenHolder,
        })
        assert.equal(logs[2].event, Events.Minted)
        assert.equal(logs[3].event, Events.Transfer)
        assert.equal(logs[4].event, Events.TransferByPartition)
        assert.equal(logs[5].event, Events.Swap)

        const fxcHolderBalance = (
          await this.fxc.balanceOf.call(tokenHolder)
        ).toNumber()
        assert.equal(fxcHolderBalance, emptyBalance)

        const graveyardFxcBalance = (
          await this.fxc.balanceOf.call(FXC_GRAVEYARD)
        ).toNumber()
        assert.equal(graveyardFxcBalance, fxcBalanceMock)

        const fxcHolderAmpBalance = (
          await this.amp.balanceOf.call(tokenHolder)
        ).toNumber()
        assert.equal(fxcHolderAmpBalance, fxcBalanceMock)

        const fxcHolderAmpBalanceOfDefaultPartition = (
          await this.amp.balanceOfByPartition.call(
            DEFAULT_PARTITION,
            tokenHolder
          )
        ).toNumber()
        assert.equal(fxcHolderAmpBalanceOfDefaultPartition, fxcBalanceMock)
      })
    })

    describe('when unknown address executes the swapping for the holder', function () {
      it('swap accordingly', async function () {
        const { logs } = await this.amp.swap(tokenHolder, { from: unknown })
        assert.equal(logs[2].event, Events.Minted)
        assert.equal(logs[3].event, Events.Transfer)
        assert.equal(logs[4].event, Events.TransferByPartition)
        assert.equal(logs[5].event, Events.Swap)

        const fxcHolderBalance = (
          await this.fxc.balanceOf.call(tokenHolder)
        ).toNumber()
        assert.equal(fxcHolderBalance, emptyBalance)

        const graveyardFxcBalance = (
          await this.fxc.balanceOf.call(FXC_GRAVEYARD)
        ).toNumber()
        assert.equal(graveyardFxcBalance, fxcBalanceMock)

        const fxcHolderAmpBalance = (
          await this.amp.balanceOf.call(tokenHolder)
        ).toNumber()
        assert.equal(fxcHolderAmpBalance, fxcBalanceMock)

        const fxcHolderAmpBalanceOfDefaultPartition = (
          await this.amp.balanceOfByPartition.call(
            DEFAULT_PARTITION,
            tokenHolder
          )
        ).toNumber()
        assert.equal(fxcHolderAmpBalanceOfDefaultPartition, fxcBalanceMock)
      })
    })
  })

  describe('when holder has tokens but transfer is not approved', function () {
    beforeEach(async function () {
      await this.fxc.mint(tokenHolder, fxcBalanceMock, { from: owner })
    })

    it('reverts', async function () {
      await shouldFail.reverting(
        this.amp.swap(tokenHolder, { from: tokenHolder })
      )
    })
  })

  describe('when holder has no tokens and transfer is approved', function () {
    beforeEach(async function () {
      await this.fxc.approve(this.amp.address, 0, { from: tokenHolder })
    })

    it('reverts', async function () {
      await shouldFail.reverting(
        this.amp.swap(tokenHolder, { from: tokenHolder })
      )
    })
  })

  describe('when swap is executed for the 0x0 address', function () {
    it('reverts', async function () {
      await shouldFail.reverting(this.amp.swap(ZERO_ADDRESS, { from: unknown }))
      // TODO: This error code cannot be tested now that we are stripping the
      // revert code
      // await assertRevertErrCode(
      //   this.amp.swap(ZERO_ADDRESS, { from: unknown }),
      //   '53'
      // )
    })
  })
})
