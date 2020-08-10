import { shouldFail } from 'openzeppelin-test-helpers'

import { Constants, TestHarness, assertEqualEvent } from '../utils'
import { FLAG_CHANGE_PARTITION, ZERO_BYTE } from '../utils/constants'
import { concatHexData } from '../utils/helpers'

const ExampleCollateralManager = artifacts.require('ExampleCollateralManager')
const { DEFAULT_PARTITION } = Constants

const issuanceAmount = 1000
const supplyAmount = 500

const COL_PARTITION =
  '0x0000000000000000000000000000000000000000000000000000000000001111'

const VALID_DATA = web3.eth.abi.encodeParameters(['bytes2'], ['0x1111'])

contract('Amp: Withdrawing', function ([
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

    const withdrawAmount = 300

    describe(`when the token holder executes a standard withdrawal for ${
      supplyAmount + 1
    } tokens`, function () {
      it('reverts', async function () {
        const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
        const operatorData = VALID_DATA
        await shouldFail.reverting(
          this.amp.transferByPartition(
            COL_PARTITION,
            this.collateralContract.address,
            tokenHolder,
            supplyAmount + 1,
            data,
            operatorData,
            { from: tokenHolder }
          )
        )
      })
    })

    describe(`when the token holder executes a standard withdrawal for ${withdrawAmount} tokens`, function () {
      describe('with no proof data', function () {
        it('reverts', async function () {
          const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
          const operatorData = '0x'
          await shouldFail.reverting(
            this.amp.transferByPartition(
              COL_PARTITION,
              this.collateralContract.address,
              tokenHolder,
              withdrawAmount,
              data,
              operatorData,
              { from: tokenHolder }
            )
          )
        })
      })

      describe('with invalid proof data', function () {
        it('reverts', async function () {
          const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
          const operatorData = web3.eth.abi.encodeParameters(
            ['bytes2'],
            ['0x2222']
          )
          await shouldFail.reverting(
            this.amp.transferByPartition(
              COL_PARTITION,
              this.collateralContract.address,
              tokenHolder,
              withdrawAmount,
              data,
              operatorData,
              { from: tokenHolder }
            )
          )
        })
      })

      describe('with valid proof data', function () {
        it('succeeds', async function () {
          const holderBalance = await this.amp.balanceOf(tokenHolder)
          const poolBalance = await this.amp.balanceOfByPartition(
            COL_PARTITION,
            this.collateralContract.address
          )

          const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
          const operatorData = VALID_DATA
          const tx = await this.amp.transferByPartition(
            COL_PARTITION,
            this.collateralContract.address,
            tokenHolder,
            withdrawAmount,
            data,
            operatorData,
            { from: tokenHolder }
          )

          await this.harness.assertBalanceOf(
            tokenHolder,
            Number(holderBalance) + Number(withdrawAmount)
          )

          await this.harness.assertBalanceOfByPartition(
            COL_PARTITION,
            this.collateralContract.address,
            Number(poolBalance) - Number(withdrawAmount)
          )

          const events = await this.collateralContract.getPastEvents(
            'allEvents',
            {
              fromBlock: tx.receipt.blockNumber,
              toBlock: tx.receipt.blockNumber,
            }
          )
          assert.equal(events.length, 1)
          assertEqualEvent(events[0], 'Withdraw', { data })
        })
      })
    })
  })

  describe(`when the token holder has supplied 0 tokens`, function () {
    const withdrawAmount = 300

    describe(`when the token holder executes a standard withdrawal for ${withdrawAmount} tokens`, function () {
      it('reverts', async function () {
        const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
        const operatorData = VALID_DATA
        await shouldFail.reverting(
          this.amp.transferByPartition(
            COL_PARTITION,
            this.collateralContract.address,
            tokenHolder,
            supplyAmount + 1,
            data,
            operatorData,
            { from: tokenHolder }
          )
        )
      })
    })

    describe(`when the token holder executes a withdrawal for their rewards`, function () {
      const rewardAmount = 200
      beforeEach(async function () {
        // Just transfer all of the mock swapped tokens from the holder to the
        // collateral manager to begin.
        await this.amp.transfer(
          this.collateralContract.address,
          issuanceAmount,
          { from: tokenHolder }
        )

        const operatorData = web3.eth.abi.encodeParameters(
          ['address'],
          [tokenHolder]
        )

        await this.amp.transferByPartition(
          DEFAULT_PARTITION,
          this.collateralContract.address,
          this.collateralContract.address,
          rewardAmount,
          concatHexData(FLAG_CHANGE_PARTITION, COL_PARTITION),
          operatorData,
          { from: collateralManagerOwner }
        )
      })

      it('first shows the rewards were successfully applied', async function () {
        assert.equal(
          await this.collateralContract.rewardsOf(tokenHolder),
          rewardAmount
        )
      })

      it('succeeds', async function () {
        const data = concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION)
        const operatorData = VALID_DATA

        const tx = await this.amp.transferByPartition(
          COL_PARTITION,
          this.collateralContract.address,
          tokenHolder,
          0,
          data,
          operatorData,
          { from: tokenHolder }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          rewardAmount
        )
        await this.harness.assertBalanceOf(
          this.collateralContract.address,
          issuanceAmount - rewardAmount
        )

        const events = await this.collateralContract.getPastEvents(
          'allEvents',
          {
            fromBlock: tx.receipt.blockNumber,
            toBlock: tx.receipt.blockNumber,
          }
        )
        assert.equal(events.length, 3)
        assertEqualEvent(events[0], 'RewardsApplied', { value: rewardAmount })
        assertEqualEvent(events[1], 'Withdraw', { value: rewardAmount })
        assertEqualEvent(events[2], 'Withdraw', { value: 0 })
      })
    })
  })
})
