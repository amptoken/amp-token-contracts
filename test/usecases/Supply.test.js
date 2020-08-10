import { shouldFail } from 'openzeppelin-test-helpers'

import { Constants, TestHarness, assertEqualEvent } from '../utils'
import {
  ZERO_ADDRESS,
  FLAG_CHANGE_PARTITION,
  ZERO_BYTE,
} from '../utils/constants'
import { concatHexData } from '../utils/helpers'

const ExampleCollateralManager = artifacts.require('ExampleCollateralManager')
const { DEFAULT_PARTITION } = Constants

const issuanceAmount = 1000
const supplyAmount = 500

const COL_PARTITION =
  '0x0000000000000000000000000000000000000000000000000000000000001111'
const BAD_PARTITION =
  '0x000000000000000000000000000000000000000000000000000000000000dead'

contract('Amp: Supplying', function ([
  owner,
  collateralManagerOwner,
  tokenHolder,
  unknown,
]) {
  beforeEach(async function () {
    this.harness = new TestHarness({ owner })
    this.amp = await this.harness.init()

    await this.harness.mockSwap(tokenHolder, 1000)

    this.collateralContract = await ExampleCollateralManager.new(
      this.amp.address,
      {
        from: collateralManagerOwner,
      }
    )
  })

  describe('On supplying AMP token as collateral', function () {
    describe('Revert conditions', function () {
      it('reverts if the target collateral manager address is zero address', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            ZERO_ADDRESS,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
            ZERO_BYTE,
            {
              from: tokenHolder,
            }
          )
        )
      })

      it('reverts if there is not enough balance for token holder to supply', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            this.collateralContract.address,
            issuanceAmount + 1,
            concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
            ZERO_BYTE,
            {
              from: tokenHolder,
            }
          )
        )
      })

      it('reverts if the supplied amount is negative value', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            this.collateralContract.address,
            -1,
            concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
            ZERO_BYTE,
            {
              from: tokenHolder,
            }
          )
        )
      })

      it('reverts if the supplying to the "bad" partition', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            this.collateralContract.address,
            issuanceAmount,
            concatHexData(FLAG_CHANGE_PARTITION, BAD_PARTITION),
            ZERO_BYTE,
            {
              from: tokenHolder,
            }
          )
        )
      })
    })

    describe('Successful conditions', function () {
      it('verifies if token holder available balance is greater than or equal to the supplied amount', async function () {
        assert(
          (
            await this.amp.balanceOfByPartition(DEFAULT_PARTITION, tokenHolder)
          ).toNumber() >= supplyAmount
        )
      })

      it('succeeds if amount is 0', async function () {
        await this.amp.transferByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          this.collateralContract.address,
          0,
          concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
          ZERO_BYTE,
          {
            from: tokenHolder,
          }
        )
      })

      it(`allows token holder to supply and allocate ${supplyAmount} to application partition on collateral manager address`, async function () {
        await this.amp.authorizeOperator(this.collateralContract.address, {
          from: tokenHolder,
        })

        const data = concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION)
        const tx = await this.amp.transferByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          this.collateralContract.address,
          supplyAmount,
          data,
          ZERO_BYTE,
          {
            from: tokenHolder,
          }
        )

        const events = await this.collateralContract.getPastEvents(
          'allEvents',
          { fromBlock: tx.receipt.blockNumber, toBlock: tx.receipt.blockNumber }
        )
        assert.equal(events.length, 1)
        assertEqualEvent(events[0], 'Supply', {
          supplier: tokenHolder,
          value: supplyAmount,
          data,
        })

        // assert balance of token holder to be deducted by 500 tokens
        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          issuanceAmount - supplyAmount
        )

        await this.harness.assertBalanceOfByPartition(
          COL_PARTITION,
          this.collateralContract.address,
          supplyAmount
        )
      })
    })
  })
})
