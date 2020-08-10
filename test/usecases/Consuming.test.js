import { Constants, TestHarness, assertEqualEvent } from '../utils'
import { FLAG_CHANGE_PARTITION, ZERO_BYTE } from '../utils/constants'
import { concatHexData } from '../utils/helpers'

const ExampleCollateralManager = artifacts.require('ExampleCollateralManager')
const { DEFAULT_PARTITION } = Constants

const issuanceAmount = 1000
const supplyAmount = 500

const COL_PARTITION =
  '0x0000000000000000000000000000000000000000000000000000000000001111'

contract('Amp: Consuming', function ([
  owner,
  collateralManagerOwner,
  tokenHolder,
  unknown,
]) {
  beforeEach(async function () {
    this.harness = new TestHarness({ owner })
    this.amp = await this.harness.init()

    await this.harness.mockSwap(tokenHolder, issuanceAmount)

    this.collateralContract = await ExampleCollateralManager.new(
      this.amp.address,
      {
        from: collateralManagerOwner,
      }
    )
  })

  describe(`when the token holder has supplied ${supplyAmount} tokens`, function () {
    beforeEach(async function () {
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        this.collateralContract.address,
        supplyAmount,
        concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
        ZERO_BYTE,
        { from: tokenHolder }
      )
    })

    const consumeAmount = 300

    describe(`when the collateral manager consumes ${consumeAmount} from the token holder`, function () {
      it('succeeds', async function () {
        const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
        const operatorData = web3.eth.abi.encodeParameters(
          ['address'],
          [tokenHolder]
        )

        const tx = await this.amp.transferByPartition(
          COL_PARTITION,
          this.collateralContract.address,
          this.collateralContract.address,
          consumeAmount,
          data,
          operatorData,
          { from: collateralManagerOwner }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          issuanceAmount - supplyAmount
        )
        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.collateralContract.address,
          consumeAmount
        )
        await this.harness.assertBalanceOf(
          this.collateralContract.address,
          supplyAmount
        )
        await this.harness.assertBalanceOfByPartition(
          COL_PARTITION,
          this.collateralContract.address,
          supplyAmount - consumeAmount
        )
        assert.equal(
          await this.collateralContract.supplyOf(tokenHolder),
          supplyAmount - consumeAmount
        )

        const events = await this.collateralContract.getPastEvents(
          'allEvents',
          {
            fromBlock: tx.receipt.blockNumber,
            toBlock: tx.receipt.blockNumber,
          }
        )
        assert.equal(events.length, 2)
        assertEqualEvent(events[0], 'Consume')
        assertEqualEvent(events[1], 'GenericReceive')
      })
    })
  })
})
