import { shouldFail } from 'openzeppelin-test-helpers'

import { Constants, Helpers, TestHarness } from '../utils'

const { FLAG_CHANGE_PARTITION, ZERO_BYTE, DEFAULT_PARTITION } = Constants
const { concatHexData, formatCollateralPartition } = Helpers

const HolderCollateralPartitionValidator = artifacts.require(
  'HolderCollateralPartitionValidator'
)
const MockCollateralPool = artifacts.require('MockCollateralPool')

const PARTITION_FLAG_HOLDER_COLLATERAL = '0xAAAAAAAA'

// A dummy issuance and supply amount
const issuanceAmount = 1000
const supplyAmount = 400

contract('HolderCollateralPartitionValidator', function ([
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

    const validator = await HolderCollateralPartitionValidator.new(
      this.amp.address
    )

    await this.amp.setPartitionStrategy(
      PARTITION_FLAG_HOLDER_COLLATERAL,
      validator.address,
      { from: owner }
    )
  })

  describe('when transferring tokens to the collateral partition', function () {
    describe('when manager is not a registered collateral manager', function () {
      it('reverts', async function () {
        this.manager = await MockCollateralPool.new(this.amp.address, false)

        assert.equal(
          await this.amp.isCollateralManager(this.manager.address),
          false
        )

        const collateralPartition = formatCollateralPartition(
          PARTITION_FLAG_HOLDER_COLLATERAL,
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
            tokenHolder,
            supplyAmount,
            changeToCMPartition,
            ZERO_BYTE,
            { from: tokenHolder }
          )
        )
      })
    })

    describe('when manager is registered as a collateral manager', async function () {
      beforeEach(async function () {
        this.manager = await MockCollateralPool.new(this.amp.address, true)

        assert.equal(
          await this.amp.isCollateralManager(this.manager.address),
          true
        )

        this.collateralPartition = formatCollateralPartition(
          PARTITION_FLAG_HOLDER_COLLATERAL,
          this.manager.address,
          ''
        )
      })

      describe(`when the holder transfers ${supplyAmount} tokens`, function () {
        describe(`to the token holder address and the manager collateral partition`, function () {
          beforeEach(async function () {
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              tokenHolder,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
              ZERO_BYTE,
              { from: tokenHolder }
            )
          })

          it("results in tokens being moved from the supplier's default partition", async function () {
            const wantRemainingAmount = issuanceAmount - supplyAmount
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              wantRemainingAmount
            )
          })

          it('results in the token holder having Amp in the collateral partition', async function () {
            await this.harness.assertBalanceOfByPartition(
              this.collateralPartition,
              tokenHolder,
              supplyAmount
            )
          })

          it('results in no tokens at the manager address', async function () {
            await this.harness.assertBalanceOfByPartition(
              this.collateralPartition,
              this.manager.address,
              0
            )
          })
        })

        describe(`to the manager address and the manager collateral partition`, function () {
          it('reverts', async function () {
            await shouldFail.reverting(
              this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                this.manager.address,
                supplyAmount,
                concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
                ZERO_BYTE,
                { from: tokenHolder }
              )
            )
          })
        })

        describe(`to the tokenHolder address and a manager collateral sub partition`, function () {
          it('succeeds', async function () {
            const collateralPartitionOther = formatCollateralPartition(
              PARTITION_FLAG_HOLDER_COLLATERAL,
              this.manager.address,
              'sub' // formatCollateralPartition will convert this to hex
            )

            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              tokenHolder,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, collateralPartitionOther),
              ZERO_BYTE,
              { from: tokenHolder }
            )

            await this.harness.assertBalanceOfByPartition(
              this.collateralPartition,
              tokenHolder,
              0
            )
            await this.harness.assertBalanceOfByPartition(
              collateralPartitionOther,
              tokenHolder,
              supplyAmount
            )
          })
        })

        describe(`to the holder2 address and a manager collateral partition `, function () {
          it('succeeds', async function () {
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              holder2,
              supplyAmount,
              concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
              ZERO_BYTE,
              { from: tokenHolder }
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount - supplyAmount
            )

            await this.harness.assertBalanceOfByPartition(
              this.collateralPartition,
              holder2,
              supplyAmount
            )
          })
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
        PARTITION_FLAG_HOLDER_COLLATERAL,
        this.manager.address,
        ''
      )

      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        tokenHolder,
        supplyAmount,
        concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
        ZERO_BYTE,
        { from: tokenHolder }
      )
    })

    describe('when the manager transfers from the tokenHolder: collateralized partition (consuming)', function () {
      it('allows manager to consume tokens', async function () {
        // This testConsume method is a dumb version of a how a CM may
        // implement an on chain method in their contract that calls into
        // Amp to perform a transfer.

        // First check that the CM has no balance in default
        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          0
        )

        await this.manager.testConsume(
          this.collateralPartition,
          tokenHolder,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          { from: owner }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          supplyAmount
        )
      })

      it(`allows manager's operator to consume tokens`, async function () {
        // Note: This means a manager does not need to implement a bespoke
        // "consuming" type method into their contract implementation.

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          0
        )

        await this.amp.transferByPartition(
          this.collateralPartition,
          tokenHolder,
          this.manager.address,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          ZERO_BYTE,
          { from: owner }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          supplyAmount
        )
      })
    })

    describe('when the holder wants to transfer from tokenHolder: collateralized partition', async function () {
      it('reverts without appropriate data', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            this.collateralPartition,
            tokenHolder,
            tokenHolder,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
            ZERO_BYTE,
            { from: tokenHolder }
          )
        )
      })
      it('succeeds with appropriate data', async function () {
        const VALID_DATA = web3.eth.abi.encodeParameters(['bytes2'], ['0x1111'])

        await this.amp.transferByPartition(
          this.collateralPartition,
          tokenHolder,
          tokenHolder,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          VALID_DATA,
          { from: tokenHolder }
        )

        assert.equal(
          (
            await this.amp.balanceOfByPartition(DEFAULT_PARTITION, tokenHolder)
          ).toString(),
          issuanceAmount
        )
      })
    })
  })

  describe(`when transferring from an alternate collateral partition`, function () {
    beforeEach(async function () {
      this.manager = await MockCollateralPool.new(this.amp.address, true)

      assert.equal(
        await this.amp.isCollateralManager(this.manager.address),
        true
      )

      this.collateralPartition = formatCollateralPartition(
        PARTITION_FLAG_HOLDER_COLLATERAL,
        this.manager.address,
        '02baba'
      )

      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        tokenHolder,
        supplyAmount,
        concatHexData(FLAG_CHANGE_PARTITION, this.collateralPartition),
        ZERO_BYTE,
        { from: tokenHolder }
      )
    })

    describe('when the manager transfers from the tokenHolder: collateralized partition (consuming)', function () {
      it('allows manager to consume tokens', async function () {
        // This testConsume method is a dumb version of a how a CM may
        // implement an on chain method in their contract that calls into
        // Amp to perform a transfer.

        // First check that the CM has no balance in default
        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          0
        )

        await this.manager.testConsume(
          this.collateralPartition,
          tokenHolder,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          { from: owner }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          supplyAmount
        )
      })

      it(`allows manager's operator to consume tokens`, async function () {
        // Note: This means a manager does not need to implement a bespoke
        // "consuming" type method into their contract implementation.

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          0
        )

        await this.amp.transferByPartition(
          this.collateralPartition,
          tokenHolder,
          this.manager.address,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          ZERO_BYTE,
          { from: owner }
        )

        await this.harness.assertBalanceOfByPartition(
          DEFAULT_PARTITION,
          this.manager.address,
          supplyAmount
        )
      })
    })

    describe('when the holder wants to transfer from tokenHolder: collateralized partition', async function () {
      it('reverts without appropriate data', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            this.collateralPartition,
            tokenHolder,
            tokenHolder,
            supplyAmount,
            concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
            ZERO_BYTE,
            { from: tokenHolder }
          )
        )
      })
      it('succeeds with appropriate data', async function () {
        const VALID_DATA = web3.eth.abi.encodeParameters(['bytes2'], ['0x1111'])

        await this.amp.transferByPartition(
          this.collateralPartition,
          tokenHolder,
          tokenHolder,
          supplyAmount,
          concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
          VALID_DATA,
          { from: tokenHolder }
        )

        assert.equal(
          (
            await this.amp.balanceOfByPartition(DEFAULT_PARTITION, tokenHolder)
          ).toString(),
          issuanceAmount
        )
      })
    })
  })

  describe(`isOperatorForPartition`, function () {
    describe('when checking against a random address', function () {
      it('returns false', async function () {
        const partition = formatCollateralPartition(
          PARTITION_FLAG_HOLDER_COLLATERAL,
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
          PARTITION_FLAG_HOLDER_COLLATERAL,
          this.manager.address,
          ''
        )
      })

      it('returns true for the collateral manager and any address', async function () {
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            this.manager.address,
            tokenHolder
          )
        )
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            this.manager.address,
            randomAddy
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

      it(`returns true for the collateral manager's operators and any address`, async function () {
        // Note: MockCollateralManager sets owner as an operator
        assert.isTrue(await this.amp.isOperator(owner, this.manager.address))
        assert.isTrue(
          await this.amp.isOperatorForCollateralManager(
            this.collateralPartition,
            owner,
            this.manager.address
          )
        )
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            this.collateralPartition,
            owner,
            this.manager.address
          )
        )
      })

      it('returns false for any tokenHolder for manager', async function () {
        assert.isTrue(
          !(await this.amp.isOperatorForPartition(
            this.collateralPartition,
            tokenHolder,
            this.manager.address
          ))
        )
      })
    })
  })
})
