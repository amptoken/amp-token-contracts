import { shouldFail } from 'openzeppelin-test-helpers'

import { Constants, Helpers, TestHarness } from '../utils'

const { FLAG_CHANGE_PARTITION, ZERO_BYTE, DEFAULT_PARTITION } = Constants
const { concatHexData, formatCollateralPartition } = Helpers

const CollateralPoolStrategyValidator = artifacts.require(
  'CollateralPoolPartitionValidator'
)

const MockCollateralPool = artifacts.require('MockCollateralPool')

const PARTITION_PREFIX_COLLATERAL_POOL = '0xCCCCCCCC'

// A dummy issuance and supply amount
const issuanceAmount = 1000
const supplyAmount = 400

contract('CollateralPoolStrategyValidator', function ([
  owner,
  cmanager,
  tokenHolder,
  holder2,
  recipient,
  randomAddy,
  unknown,
]) {
  before(function () {
    this.harness = new TestHarness({ owner })
  })

  beforeEach(async function () {
    this.amp = await this.harness.init()
    await this.harness.mockSwap(tokenHolder, issuanceAmount)
    await this.harness.assertBalanceOf(tokenHolder, issuanceAmount)

    const strategyValidator = await CollateralPoolStrategyValidator.new(
      this.amp.address
    )

    await this.amp.setPartitionStrategy(
      PARTITION_PREFIX_COLLATERAL_POOL,
      strategyValidator.address,
      { from: owner }
    )
  })

  describe('when transferring tokens to the pool partition', function () {
    describe('when manager is not a registered collateral manager', function () {
      it('reverts', async function () {
        this.manager = await MockCollateralPool.new(this.amp.address, false)

        assert.equal(
          await this.amp.isCollateralManager(this.manager.address),
          false
        )

        const collateralPartition = formatCollateralPartition(
          PARTITION_PREFIX_COLLATERAL_POOL,
          this.manager.address,
          ''
        )
        const changeToCMPartition = concatHexData(
          FLAG_CHANGE_PARTITION,
          collateralPartition
        )
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            this.manager.address,
            supplyAmount,
            changeToCMPartition,
            ZERO_BYTE,
            { from: tokenHolder }
          )
        )
      })
    })

    describe('when manager is registered as a collateral manager', function () {
      beforeEach(async function () {
        this.manager = await MockCollateralPool.new(this.amp.address, true)

        assert.equal(
          await this.amp.isCollateralManager(this.manager.address),
          true
        )

        this.collateralPartition = formatCollateralPartition(
          PARTITION_PREFIX_COLLATERAL_POOL,
          this.manager.address,
          ''
        )
      })

      describe(`when the supplier transfers ${supplyAmount} tokens`, function () {
        describe(`to the manager address and the manager collateral partition`, function () {
          beforeEach(async function () {
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              this.manager.address,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
              ZERO_BYTE,
              { from: tokenHolder }
            )
          })

          it("results in tokens being moved from supplier's default partition", async function () {
            const wantRemainingAmount = issuanceAmount - supplyAmount
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              wantRemainingAmount
            )
          })

          it(`results in the manager having ${supplyAmount} Amp in the shared pool partition`, async function () {
            await this.harness.assertBalanceOfByPartition(
              this.collateralPartition,
              this.manager.address,
              supplyAmount
            )
          })
        })
      })
      describe(`to the manager in a different pool sub partition`, function () {
        it('succeeds', async function () {
          const collateralPartitionOther = formatCollateralPartition(
            PARTITION_PREFIX_COLLATERAL_POOL,
            this.manager.address,
            'sub' // formatCollateralPartition will convert this to hex
          )
          await this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            this.manager.address,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, collateralPartitionOther),
            ZERO_BYTE,
            { from: tokenHolder }
          )

          await this.harness.assertBalanceOfByPartition(
            this.collateralPartition,
            this.manager.address,
            0
          )
          await this.harness.assertBalanceOfByPartition(
            collateralPartitionOther,
            this.manager.address,
            supplyAmount
          )
        })
      })
      describe(`to a different manager address and the original manager's pool partition`, function () {
        it('reverts', async function () {
          const otherManager = await MockCollateralPool.new(
            this.amp.address,
            true
          )

          assert.equal(
            await this.amp.isCollateralManager(otherManager.address),
            true
          )

          await shouldFail.reverting(
            this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              randomAddy,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
              ZERO_BYTE,
              { from: tokenHolder }
            )
          )
        })
      })
    })
  })

  describe(`when transferring from the collateral partition`, function () {
    beforeEach(async function () {
      this.manager = await MockCollateralPool.new(this.amp.address, true)

      assert.equal(
        await this.amp.isCollateralManager(this.manager.address),
        true
      )

      this.collateralPartition = formatCollateralPartition(
        PARTITION_PREFIX_COLLATERAL_POOL,
        this.manager.address,
        ''
      )

      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        this.manager.address,
        supplyAmount,
        concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
        ZERO_BYTE,
        { from: tokenHolder }
      )
    })

    describe('when the tokenHolder transfers from the manager', function () {
      it('isOperatorForPartition returns true for the holder', async function () {
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            tokenHolder,
            this.manager.address
          )
        )
      })
      describe('when the holder submits valid data along with the transfer request', function () {
        it('succeeds due to the partition structure granting operator permissions', async function () {
          const VALID_DATA = web3.eth.abi.encodeParameters(
            ['bytes2'],
            ['0x1111']
          )

          await this.amp.transferByPartition(
            this.collateralPartition,
            this.manager.address,
            tokenHolder,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
            VALID_DATA,
            { from: tokenHolder }
          )

          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            issuanceAmount
          )

          await this.harness.assertBalanceOfByPartition(
            this.collateralPartition,
            this.manager.address,
            0
          )
        })
      })
      describe('when the holder submits invalid data along with the transfer request', function () {
        it('reverts', async function () {
          const INVALID_DATA = web3.eth.abi.encodeParameters(
            ['bytes2'],
            ['0xFFFF']
          )

          await shouldFail.reverting(
            this.amp.transferByPartition(
              this.collateralPartition,
              this.manager.address,
              tokenHolder,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
              INVALID_DATA,
              { from: tokenHolder }
            )
          )

          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            issuanceAmount - supplyAmount
          )

          await this.harness.assertBalanceOfByPartition(
            this.collateralPartition,
            this.manager.address,
            supplyAmount
          )
        })
      })
    })

    describe('when the manager tries to transfer from holders addresss', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            this.collateralPartition,
            tokenHolder,
            this.manager.address,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
            ZERO_BYTE,
            { from: owner }
          )
        )
      })
    })
  })

  describe(`isOperatorForPartition`, function () {
    describe('when checking against a random address', function () {
      it('returns false', async function () {
        const partition = formatCollateralPartition(
          PARTITION_PREFIX_COLLATERAL_POOL,
          randomAddy,
          ''
        )
        assert.isTrue(
          !(await this.amp.isOperatorForPartition(
            partition,
            tokenHolder,
            randomAddy
          ))
        )
      })
    })
    describe('when checking against a registered collateral manager', function () {
      beforeEach(async function () {
        this.manager = await MockCollateralPool.new(this.amp.address, true)

        assert.isTrue(await this.amp.isCollateralManager(this.manager.address))

        this.collateralPartition = formatCollateralPartition(
          PARTITION_PREFIX_COLLATERAL_POOL,
          this.manager.address,
          ''
        )
      })

      it('returns true for any address with this strategy', async function () {
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            tokenHolder,
            this.manager.address
          )
        )
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            randomAddy,
            this.manager.address
          )
        )
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            this.manager.address,
            this.manager.address
          )
        )
      })
    })
  })
})
