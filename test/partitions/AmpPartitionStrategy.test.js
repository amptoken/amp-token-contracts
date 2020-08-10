import { shouldFail } from 'openzeppelin-test-helpers'

import { TestHarness, Constants } from '../utils'

const MockPartitionBase = artifacts.require('MockPartitionBase')
const CollateralPoolPartitionValidator = artifacts.require(
  'CollateralPoolPartitionValidator'
)

contract('AmpPartitions', function ([
  owner,
  tokenHolder,
  recipient,
  strategyValidator,
  randomAddy,
  unknown,
]) {
  describe('Strategy Admininstration', function () {
    beforeEach(async function () {
      this.harness = new TestHarness({ owner })
      this.amp = await this.harness.init()
      this.partitionsBase = await MockPartitionBase.new()
    })

    describe('setPartitionStrategy', function () {
      beforeEach(async function () {
        this.strategyValidator = await CollateralPoolPartitionValidator.new(
          this.amp.address
        )
        this.partitionPrefix = await this.strategyValidator.partitionPrefix.call()
      })
      describe('when the caller is the contract owner', function () {
        it('sets the partition strategy validators', async function () {
          let hookImplementer = await this.partitionsBase.getAmpPartitionStrategyImplementer(
            this.partitionPrefix,
            this.amp.address
          )
          assert.equal(hookImplementer, Constants.ZERO_ADDRESS)

          await this.amp.setPartitionStrategy(
            this.partitionPrefix,
            this.strategyValidator.address,
            { from: owner }
          )

          assert.isTrue(
            await this.amp.isPartitionStrategy(this.partitionPrefix)
          )

          hookImplementer = await this.partitionsBase.getAmpPartitionStrategyImplementer(
            this.partitionPrefix,
            this.amp.address
          )
          assert.equal(hookImplementer, this.strategyValidator.address)
        })

        describe('when the same prefix is tried to be set again', function () {
          it('reverts as strategies are append only', async function () {
            await this.amp.setPartitionStrategy(
              this.partitionPrefix,
              this.strategyValidator.address,
              { from: owner }
            )

            assert.isTrue(
              await this.amp.isPartitionStrategy(this.partitionPrefix)
            )

            shouldFail.reverting(
              this.amp.setPartitionStrategy(this.partitionPrefix, randomAddy, {
                from: owner,
              })
            )
          })
        })
      })
      describe('when the caller is not the contract owner', function () {
        it('reverts', async function () {
          await shouldFail.reverting(
            this.amp.setPartitionStrategy(
              this.partitionPrefix,
              this.strategyValidator.address,
              { from: unknown }
            )
          )
        })
      })
      describe('when the partition has the zero prefix', function () {
        it('reverts', async function () {
          await shouldFail.reverting(
            this.amp.setPartitionStrategy(
              Constants.ZERO_PREFIX,
              this.strategyValidator.address,
              { from: owner }
            )
          )
        })
      })
    })

    describe('isPartitionStrategy', function () {
      beforeEach(async function () {
        this.strategyValidator = await CollateralPoolPartitionValidator.new(
          this.amp.address
        )
        this.partitionPrefix = await this.strategyValidator.partitionPrefix.call()
      })
      it('returns false when not set', async function () {
        assert.isTrue(
          !(await this.amp.isPartitionStrategy(this.partitionPrefix))
        )
      })
      it('returns true when set', async function () {
        await this.amp.setPartitionStrategy(
          this.partitionPrefix,
          this.strategyValidator.address,
          {
            from: owner,
          }
        )
        assert.isTrue(await this.amp.isPartitionStrategy(this.partitionPrefix))
      })
    })
  })
})
