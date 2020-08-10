import { shouldFail, should } from 'openzeppelin-test-helpers'
import { soliditySha3 } from 'web3-utils'

import {
  Constants,
  Helpers,
  TestHarness,
  INames,
  assertEqualEvents,
  assertEqualEvent,
  assertLogsContainEvent,
} from './utils'
import {
  Transfer,
  TransferByPartition,
  Approval,
  ApprovalByPartition,
  AuthorizedOperator,
  RevokedOperator,
  AuthorizedOperatorByPartition,
  RevokedOperatorByPartition,
} from './utils/events'

const Amp = artifacts.require('Amp')
const MockFXC = artifacts.require('MockFXC')
const ERC1820Registry = artifacts.require('ERC1820Registry')

const MockCollateralPool = artifacts.require('MockCollateralPool')

const {
  ZERO_BYTES32,
  ZERO_ADDRESS,
  ZERO_BYTE,
  DEFAULT_PARTITION,
  ALT_PARTITION_1,
  ALT_PARTITION_2,
  RESERVED_PARTITION,
  FLAG_OTHER_UKNOWNN,
  FLAG_CHANGE_PARTITION,
} = Constants

const {
  ERC1820_ACCEPT_MAGIC,
  ERC20_INTERFACE_NAME,
  AMP_INTERFACE_NAME,
} = INames

const {
  assertTransferEvent,
  assertBalance,
  assertChangePartitionEvent,

  concatHexData,
} = Helpers

const issuanceAmount = 1000

contract('Amp', function ([
  owner,
  operator,
  tokenHolder,
  recipient,
  randomAddy,
  controller,
  unknown,
]) {
  before(async function () {
    this.harness = new TestHarness({ owner })

    this.registry = await ERC1820Registry.at(
      '0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24'
    )
  })

  describe('contract creation', function () {
    describe('when a valid swap token address is used', function () {
      it('succeeds', async function () {
        const fxc = await MockFXC.new()
        const amp = await Amp.new(fxc.address, 'Amp', 'AMP')
        await should.exist(amp.address)
      })
    })
    describe('when the swap token address of 0 is used', function () {
      it('reverts', async function () {
        await shouldFail.reverting(Amp.new(ZERO_ADDRESS, 'Amp', 'AMP'))
      })
    })
  })

  describe('canImplementInterfaceForAddress', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when interface hash is correct', function () {
      describe(`for ${INames.AMP_INTERFACE_NAME}`, function () {
        it('returns ERC1820_ACCEPT_MAGIC', async function () {
          const canImplementAmp = await this.amp.canImplementInterfaceForAddress(
            soliditySha3(INames.AMP_INTERFACE_NAME),
            ZERO_ADDRESS
          )
          assert.equal(soliditySha3(ERC1820_ACCEPT_MAGIC), canImplementAmp)
        })
      })
      describe(`for ${INames.ERC20_INTERFACE_NAME}`, function () {
        it('returns ERC1820_ACCEPT_MAGIC', async function () {
          const canImplement20 = await this.amp.canImplementInterfaceForAddress(
            soliditySha3(INames.ERC20_INTERFACE_NAME),
            ZERO_ADDRESS
          )
          assert.equal(
            soliditySha3(INames.ERC1820_ACCEPT_MAGIC),
            canImplement20
          )
        })
      })
    })
    describe('when interface hash is not correct', function () {
      it('returns ERC1820_ACCEPT_MAGIC', async function () {
        const canImplement = await this.amp.canImplementInterfaceForAddress(
          soliditySha3('FakeToken'),
          ZERO_ADDRESS
        )
        assert.equal(ZERO_BYTES32, canImplement)
      })
    })
  })

  describe('transfer', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
    })

    describe('when the recipient is not the zero address', function () {
      describe('when the sender has enough balance', function () {
        const amount = issuanceAmount

        it('transfers the requested amount', async function () {
          await this.amp.transfer(recipient, amount, { from: tokenHolder })
          await assertBalance(this.amp, tokenHolder, issuanceAmount - amount)
          await assertBalance(this.amp, recipient, amount)
        })

        it('emits a Transfer event', async function () {
          const { logs } = await this.amp.transfer(recipient, amount, {
            from: tokenHolder,
          })

          assertEqualEvents(logs, [
            {
              name: Transfer,
              values: {
                from: tokenHolder,
                to: recipient,
                value: amount,
              },
            },
            {
              name: TransferByPartition,
              value: {
                operator: tokenHolder,
                from: tokenHolder,
                to: recipient,
                value: amount,
                data: null,
                operatorData: null,
              },
            },
          ])
        })
      })
      describe('when the sender does not have enough balance', function () {
        const amount = issuanceAmount + 1

        it('reverts', async function () {
          await shouldFail.reverting(
            this.amp.transfer(recipient, amount, { from: tokenHolder })
          )
        })
      })

      describe('when the sender has enough across all partitions, but not in the default', function () {
        beforeEach(async function () {
          await this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            tokenHolder,
            issuanceAmount,
            concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
            ZERO_BYTE,
            { from: tokenHolder }
          )
          await this.harness.assertBalanceOfByPartition(
            ALT_PARTITION_1,
            tokenHolder,
            issuanceAmount
          )
        })
        it('reverts', async function () {
          const amount = 1
          await shouldFail.reverting(
            this.amp.transfer(recipient, amount, { from: tokenHolder })
          )
        })
      })
    })

    describe('when the recipient is the zero address', function () {
      const amount = issuanceAmount

      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.transfer(ZERO_ADDRESS, amount, { from: tokenHolder })
        )
      })
    })
  })

  describe('transferFrom', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
    })

    describe('when the operator is approved', function () {
      describe('as a global operator', function () {
        beforeEach(async function () {
          await this.amp.authorizeOperator(operator, {
            from: tokenHolder,
          })
          assert.isTrue(await this.amp.isOperator(operator, tokenHolder))
        })

        describe('when the recipient is not the zero address', function () {
          describe('when the sender has enough balance', function () {
            const amount = 500

            beforeEach(async function () {
              await this.amp.transferFrom(tokenHolder, recipient, amount, {
                from: operator,
              })
            })

            it('transfers the requested amount', async function () {
              await assertBalance(
                this.amp,
                tokenHolder,
                issuanceAmount - amount
              )
              await assertBalance(this.amp, recipient, amount)

              assert.equal(await this.amp.allowance(tokenHolder, operator), 0)
            })

            it('emits a sent + a transfer event', async function () {
              const { logs } = await this.amp.transferFrom(
                tokenHolder,
                recipient,
                amount,
                { from: operator }
              )

              assertEqualEvents(logs, [
                {
                  name: Transfer,
                  values: {
                    from: tokenHolder,
                    to: recipient,
                    value: amount,
                  },
                },
                {
                  name: TransferByPartition,
                  value: {
                    operator: operator,
                    from: tokenHolder,
                    to: recipient,
                    value: amount,
                    data: null,
                    operatorData: null,
                  },
                },
              ])
            })
          })
          describe('when the sender does not have enough balance', function () {
            const amount = issuanceAmount + 1

            it('reverts', async function () {
              await shouldFail.reverting(
                this.amp.transferFrom(tokenHolder, recipient, amount, {
                  from: operator,
                })
              )
            })
          })

          describe('when the sender has enough across all partitions, but not in the default', function () {
            const amount = 1
            beforeEach(async function () {
              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                tokenHolder,
                issuanceAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )
              await this.harness.assertBalanceOfByPartition(
                ALT_PARTITION_1,
                tokenHolder,
                issuanceAmount
              )
            })
            it('reverts', async function () {
              await shouldFail.reverting(
                this.amp.transferFrom(tokenHolder, recipient, amount, {
                  from: operator,
                })
              )
            })
          })
        })

        describe('when the recipient is the zero address', function () {
          const amount = issuanceAmount

          it('reverts', async function () {
            await shouldFail.reverting(
              this.amp.transferFrom(tokenHolder, ZERO_ADDRESS, amount, {
                from: operator,
              })
            )
          })
        })
      })

      describe('when authorized for an approved amount', function () {
        const approvedAmount = 10000
        beforeEach(async function () {
          await this.amp.approve(operator, approvedAmount, {
            from: tokenHolder,
          })
        })

        describe('when the recipient is not the zero address', function () {
          describe('when the sender has enough balance', function () {
            const amount = 500

            beforeEach(async function () {
              await this.amp.transferFrom(tokenHolder, recipient, amount, {
                from: operator,
              })
            })

            it('transfers the requested amount', async function () {
              await assertBalance(
                this.amp,
                tokenHolder,
                issuanceAmount - amount
              )
              await assertBalance(this.amp, recipient, amount)

              assert.equal(
                await this.amp.allowance(tokenHolder, operator),
                approvedAmount - amount
              )
            })

            it('emits a sent + a transfer event', async function () {
              const { logs } = await this.amp.transferFrom(
                tokenHolder,
                recipient,
                amount,
                { from: operator }
              )

              assertEqualEvents(logs, [
                {
                  name: Transfer,
                  values: {
                    from: tokenHolder,
                    to: recipient,
                    value: amount,
                  },
                },
                {
                  name: TransferByPartition,
                  value: {
                    operator: operator,
                    from: tokenHolder,
                    to: recipient,
                    value: amount,
                    data: null,
                    operatorData: null,
                  },
                },
              ])
            })
          })
          describe('when the sender has not approved enough balance', function () {
            const amount = approvedAmount + 1

            it('reverts', async function () {
              await shouldFail.reverting(
                this.amp.transferFrom(tokenHolder, recipient, amount, {
                  from: operator,
                })
              )
            })
          })

          describe('when the sender has enough across all partitions, but not in the default', function () {
            const amount = 1
            beforeEach(async function () {
              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                tokenHolder,
                issuanceAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )
              await this.harness.assertBalanceOfByPartition(
                ALT_PARTITION_1,
                tokenHolder,
                issuanceAmount
              )
            })
            it('reverts', async function () {
              await shouldFail.reverting(
                this.amp.transferFrom(tokenHolder, recipient, amount, {
                  from: operator,
                })
              )
            })
          })
        })

        describe('when the recipient is the zero address', function () {
          const amount = issuanceAmount

          it('reverts', async function () {
            await shouldFail.reverting(
              this.amp.transferFrom(tokenHolder, ZERO_ADDRESS, amount, {
                from: operator,
              })
            )
          })
        })
      })
    })

    describe('when the operator is not approved', function () {
      const amount = 100
      describe('when the operator is not approved but authorized', function () {
        it('transfers the requested amount', async function () {
          await this.amp.authorizeOperator(operator, { from: tokenHolder })
          assert.equal(await this.amp.allowance(tokenHolder, operator), 0)

          await this.amp.transferFrom(tokenHolder, recipient, amount, {
            from: operator,
          })

          await assertBalance(this.amp, tokenHolder, issuanceAmount - amount)
          await assertBalance(this.amp, recipient, amount)
        })
      })
      describe('when the operator is not approved and not authorized', function () {
        it('reverts', async function () {
          await shouldFail.reverting(
            this.amp.transferFrom(tokenHolder, recipient, amount, {
              from: operator,
            })
          )
        })
      })
    })
  })

  describe('approve', function () {
    const amount = 100
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when sender approves an operator', function () {
      it('approves the operator', async function () {
        assert.equal(await this.amp.allowance(tokenHolder, operator), 0)

        await this.amp.approve(operator, amount, { from: tokenHolder })

        assert.equal(await this.amp.allowance(tokenHolder, operator), amount)
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.approve(operator, amount, {
          from: tokenHolder,
        })

        assert.equal(logs.length, 2)
        assertLogsContainEvent(logs, {
          name: Approval,
          values: {
            owner: tokenHolder,
            spender: operator,
            value: amount,
          },
        })
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approve(ZERO_ADDRESS, amount, { from: tokenHolder })
        )
      })
    })
  })

  describe('increaseAllowance', function () {
    const amount = 100
    const increaseAmount = 200
    const totalAmount = 300
    beforeEach(async function () {
      this.amp = await this.harness.init()

      assert.equal(await this.amp.allowance(tokenHolder, operator), 0)
      await this.amp.approve(operator, amount, { from: tokenHolder })
    })
    describe('when sender increases the allowance of an operator', function () {
      it('increases the allowance of the operator', async function () {
        assert.equal(await this.amp.allowance(tokenHolder, operator), amount)

        await this.amp.increaseAllowance(operator, increaseAmount, {
          from: tokenHolder,
        })

        assert.equal(
          await this.amp.allowance(tokenHolder, operator),
          totalAmount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.increaseAllowance(
          operator,
          increaseAmount,
          {
            from: tokenHolder,
          }
        )

        assert.equal(logs.length, 2)
        assertLogsContainEvent(logs, {
          name: Approval,
          values: {
            owner: tokenHolder,
            spender: operator,
            value: totalAmount,
          },
        })
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approve(ZERO_ADDRESS, amount, { from: tokenHolder })
        )
      })
    })
  })

  describe('decreaseAllowance', function () {
    const amount = 100
    const decreaseAmount = 20
    const totalAmount = 80
    beforeEach(async function () {
      this.amp = await this.harness.init()

      assert.equal(await this.amp.allowance(tokenHolder, operator), 0)
      await this.amp.approve(operator, amount, { from: tokenHolder })
    })
    describe('when sender decreases the allowance of an operator', function () {
      it('increases the allowance of the operator', async function () {
        assert.equal(await this.amp.allowance(tokenHolder, operator), amount)

        await this.amp.decreaseAllowance(operator, decreaseAmount, {
          from: tokenHolder,
        })

        assert.equal(
          await this.amp.allowance(tokenHolder, operator),
          totalAmount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.decreaseAllowance(
          operator,
          decreaseAmount,
          {
            from: tokenHolder,
          }
        )

        assert.equal(logs.length, 2)
        assertLogsContainEvent(logs, {
          name: Approval,
          values: {
            owner: tokenHolder,
            spender: operator,
            value: totalAmount,
          },
        })
      })
    })
    describe('when sender decreases the allowance of an operator to be less than 0', function () {
      it('reverts', async function () {
        assert.equal(await this.amp.allowance(tokenHolder, operator), amount)

        await shouldFail.reverting(
          this.amp.decreaseAllowance(operator, amount + 1, {
            from: tokenHolder,
          })
        )
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approve(ZERO_ADDRESS, amount, { from: tokenHolder })
        )
      })
    })
  })

  describe('partitionsOf', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when tokenHolder has no tokens', function () {
      it('returns empty list', async function () {
        const partitionsOf = await this.amp.partitionsOf(tokenHolder)
        assert.equal(partitionsOf.length, 0)
      })
    })
    describe('when tokenHolder has tokens in 1 partition', function () {
      it('returns partition', async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount)

        const partitionsOf = await this.amp.partitionsOf(tokenHolder)
        assert.equal(partitionsOf.length, 1)

        assert.equal(partitionsOf[0], DEFAULT_PARTITION)
      })
    })
    describe('when tokenHolder has tokens in 3 partitions', function () {
      it('returns list of 3 partitions', async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount, [
          ALT_PARTITION_1,
          ALT_PARTITION_2,
        ])

        const partitionsOf = await this.amp.partitionsOf(tokenHolder)

        assert.equal(partitionsOf.length, 3)
        assert.isTrue(partitionsOf.indexOf(DEFAULT_PARTITION) > -1)
        assert.isTrue(partitionsOf.indexOf(ALT_PARTITION_1) > -1)
        assert.isTrue(partitionsOf.indexOf(ALT_PARTITION_2) > -1)
      })
    })
  })

  describe('transferByPartition', function () {
    const transferAmount = 300

    beforeEach(async function () {
      this.amp = await this.harness.init()
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
    })

    describe('when the sender is transferring from itself', function () {
      describe('when the sender has enough balance for this partition', function () {
        describe('when the transfer amount is not equal to 0', function () {
          describe('when the sender does not change the partition', function () {
            it('transfers the requested amount', async function () {
              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                issuanceAmount
              )

              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                recipient,
                0
              )

              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                ZERO_BYTES32,
                ZERO_BYTES32,
                { from: tokenHolder }
              )
              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                0,
                ZERO_BYTES32,
                ZERO_BYTES32,
                { from: tokenHolder }
              )

              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                issuanceAmount - transferAmount
              )
              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                recipient,
                transferAmount
              )
            })

            it('emits a TransferByPartition event', async function () {
              const {
                logs,
              } = await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                ZERO_BYTES32,
                ZERO_BYTE,
                { from: tokenHolder }
              )

              assert.equal(logs.length, 2)

              assertTransferEvent(
                logs,

                DEFAULT_PARTITION,
                tokenHolder,
                tokenHolder,
                recipient,
                transferAmount,
                ZERO_BYTES32,
                null
              )
            })
          })

          describe('when the sender changes the partition', function () {
            it('transfers the requested amount', async function () {
              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                issuanceAmount
              )

              await this.harness.assertBalanceOfByPartition(
                ALT_PARTITION_1,
                recipient,
                0
              )

              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )
              await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                0,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )

              await this.harness.assertBalanceOfByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                issuanceAmount - transferAmount
              )
              await this.harness.assertBalanceOfByPartition(
                ALT_PARTITION_1,
                recipient,
                transferAmount
              )
            })
            it('emits a TransferByPartition event', async function () {
              const {
                logs,
              } = await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )

              assert.equal(logs.length, 3)

              assertTransferEvent(
                logs,

                DEFAULT_PARTITION,
                tokenHolder,
                tokenHolder,
                recipient,
                transferAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                null
              )
            })
            it('emits a ChangedPartition event', async function () {
              const {
                logs,
              } = await this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
                ZERO_BYTE,
                { from: tokenHolder }
              )

              assert.equal(logs.length, 3)

              assertChangePartitionEvent(
                logs,
                DEFAULT_PARTITION,
                ALT_PARTITION_1,
                transferAmount
              )
            })
          })
        })
        describe('when the transfer amount is equal to 0', function () {
          it('succeeds (with no tokens being transferred), as the params and data can be used by hooks', async function () {
            const holderBalance = await this.amp.balanceOfByPartition(
              ALT_PARTITION_1,
              tokenHolder
            )
            const recipientBalance = await this.amp.balanceOfByPartition(
              ALT_PARTITION_1,
              recipient
            )

            await this.amp.transferByPartition(
              ALT_PARTITION_1,
              tokenHolder,
              recipient,
              0,
              ZERO_BYTES32,
              ZERO_BYTE,
              { from: tokenHolder }
            )

            assert.equal(
              await this.amp.balanceOfByPartition(ALT_PARTITION_1, tokenHolder),
              Number(holderBalance)
            )
            assert.equal(
              await this.amp.balanceOfByPartition(ALT_PARTITION_1, recipient),
              Number(recipientBalance)
            )
          })
        })
      })
      describe('when the sender does not have enough balance for this partition', function () {
        it('reverts', async function () {
          await shouldFail.reverting(
            this.amp.transferByPartition(
              ALT_PARTITION_1,
              tokenHolder,
              recipient,
              transferAmount,
              ZERO_BYTES32,
              ZERO_BYTE,
              { from: tokenHolder }
            )
          )
        })
      })
    })

    describe('when the sender is approved for this partition', function () {
      describe('when approved amount is sufficient', function () {
        it('transfers the requested amount', async function () {
          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            issuanceAmount
          )

          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            recipient,
            0
          )
          assert.equal(
            await this.amp.allowanceByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              operator
            ),
            0
          )

          const approvedAmount = 400
          await this.amp.approveByPartition(
            DEFAULT_PARTITION,
            operator,
            approvedAmount,
            { from: tokenHolder }
          )
          assert.equal(
            await this.amp.allowanceByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              operator
            ),
            approvedAmount
          )
          await this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            recipient,
            transferAmount,
            ZERO_BYTE,
            ZERO_BYTES32,
            { from: operator }
          )

          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            issuanceAmount - transferAmount
          )
          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            recipient,
            transferAmount
          )
          assert.equal(
            await this.amp.allowanceByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              operator
            ),
            approvedAmount - transferAmount
          )
        })
      })
      describe('when approved amount is not sufficient', function () {
        it('reverts', async function () {
          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            issuanceAmount
          )

          await this.harness.assertBalanceOfByPartition(
            DEFAULT_PARTITION,
            recipient,
            0
          )
          assert.equal(
            await this.amp.allowanceByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              operator
            ),
            0
          )

          const approvedAmount = 200
          await this.amp.approveByPartition(
            DEFAULT_PARTITION,
            operator,
            approvedAmount,
            { from: tokenHolder }
          )

          assert.equal(
            await this.amp.allowanceByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              operator
            ),
            approvedAmount
          )
          await shouldFail.reverting(
            this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              ZERO_BYTE,
              ZERO_BYTES32,
              { from: operator }
            )
          )
        })
      })
    })
    describe('when the sender is an operator for this partition', function () {
      describe('when the sender has enough balance for this partition', function () {
        describe('when partition does not change', function () {
          it('transfers the requested amount', async function () {
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              recipient,
              0
            )

            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              ZERO_BYTE,
              ZERO_BYTES32,
              { from: operator }
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount - transferAmount
            )
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              recipient,
              transferAmount
            )
          })
          it('transfers the requested amount with attached data (without changePartition flag)', async function () {
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              recipient,
              0
            )

            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              concatHexData(FLAG_OTHER_UKNOWNN, ALT_PARTITION_1),
              ZERO_BYTES32,
              { from: operator }
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount - transferAmount
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              recipient,
              transferAmount
            )
          })
          it('emits a TransferByPartition event', async function () {
            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            const {
              logs,
            } = await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              ZERO_BYTE,
              ZERO_BYTES32,
              { from: operator }
            )

            assert.equal(logs.length, 2)

            assertTransferEvent(
              logs,

              DEFAULT_PARTITION,
              operator,
              tokenHolder,
              recipient,
              transferAmount,
              null,
              ZERO_BYTES32
            )
          })
        })
        describe('when partition changes', function () {
          it('transfers the requested amount', async function () {
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount
            )
            await this.harness.assertBalanceOfByPartition(
              ALT_PARTITION_1,
              recipient,
              0
            )

            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
              ZERO_BYTES32,
              { from: operator }
            )

            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount - transferAmount
            )
            await this.harness.assertBalanceOfByPartition(
              ALT_PARTITION_1,
              recipient,
              transferAmount
            )
          })
          it('converts the requested amount', async function () {
            await this.harness.assertBalanceOf(tokenHolder, issuanceAmount)
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount
            )
            await this.harness.assertBalanceOfByPartition(
              ALT_PARTITION_1,
              tokenHolder,
              0
            )

            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              tokenHolder,
              transferAmount,
              concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
              ZERO_BYTES32,
              { from: operator }
            )

            await this.harness.assertBalanceOf(tokenHolder, issuanceAmount)
            await this.harness.assertBalanceOfByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              issuanceAmount - transferAmount
            )
            await this.harness.assertBalanceOfByPartition(
              ALT_PARTITION_1,
              tokenHolder,
              transferAmount
            )
          })
          it('emits TransferByPartition and ChangedPartition event', async function () {
            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )
            const {
              logs,
            } = await this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              transferAmount,
              concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
              ZERO_BYTES32,
              { from: operator }
            )

            assert.equal(logs.length, 3)

            assertTransferEvent(
              [logs[0], logs[1]],

              DEFAULT_PARTITION,
              operator,
              tokenHolder,
              recipient,
              transferAmount,
              concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
              ZERO_BYTES32
            )

            assertChangePartitionEvent(
              logs,
              DEFAULT_PARTITION,
              ALT_PARTITION_1,
              transferAmount
            )
          })
        })

        describe('when the partition is in the reserved space', function () {
          it('reverts', async function () {
            await this.amp.authorizeOperatorByPartition(
              DEFAULT_PARTITION,
              operator,
              { from: tokenHolder }
            )

            await shouldFail.reverting(
              this.amp.transferByPartition(
                DEFAULT_PARTITION,
                tokenHolder,
                recipient,
                transferAmount,
                concatHexData(FLAG_CHANGE_PARTITION, RESERVED_PARTITION),
                ZERO_BYTES32,
                { from: operator }
              )
            )
          })
        })
      })
      describe('when the sender does not have enough balance for this partition', function () {
        it('reverts', async function () {
          await this.amp.authorizeOperatorByPartition(
            DEFAULT_PARTITION,
            operator,
            {
              from: tokenHolder,
            }
          )
          await shouldFail.reverting(
            this.amp.transferByPartition(
              DEFAULT_PARTITION,
              tokenHolder,
              recipient,
              issuanceAmount + 1,
              ZERO_BYTE,
              ZERO_BYTES32,
              { from: operator }
            )
          )
        })
      })
    })
    describe('when the sender is an operator for the address', function () {
      it('redeems the requested amount', async function () {
        await this.harness.assertBalanceOf(tokenHolder, issuanceAmount)
        await this.harness.assertBalanceOf(recipient, 0)

        await this.amp.authorizeOperator(operator, { from: tokenHolder })
        await this.amp.transferByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          recipient,
          transferAmount,
          ZERO_BYTE,
          ZERO_BYTES32,
          { from: operator }
        )

        await this.harness.assertBalanceOf(
          tokenHolder,
          issuanceAmount - transferAmount
        )
        await this.harness.assertBalanceOf(recipient, transferAmount)
      })
    })
    describe('when the sender is neither an operator, nor approved', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.transferByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            recipient,
            transferAmount,
            ZERO_BYTE,
            ZERO_BYTES32,
            { from: operator }
          )
        )
      })
    })
  })

  describe('authorizeOperator', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when sender authorizes an operator', function () {
      it('authorizes the operator', async function () {
        assert.isTrue(!(await this.amp.isOperator(operator, tokenHolder)))
        await this.amp.authorizeOperator(operator, { from: tokenHolder })
        assert.isTrue(await this.amp.isOperator(operator, tokenHolder))
      })
      it('emits a authorized event', async function () {
        const { logs } = await this.amp.authorizeOperator(operator, {
          from: tokenHolder,
        })

        assert.equal(logs.length, 1)
        assertEqualEvent(logs[0], AuthorizedOperator, {
          operator: operator,
          tokenHolder: tokenHolder,
        })
      })
    })
    describe('when sender authorizes himself', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.authorizeOperator(tokenHolder, { from: tokenHolder })
        )
      })
    })
  })

  describe('revokeOperator', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when sender revokes an operator', function () {
      it('revokes the operator (when operator is not the controller)', async function () {
        assert.isTrue(!(await this.amp.isOperator(operator, tokenHolder)))
        await this.amp.authorizeOperator(operator, { from: tokenHolder })
        assert.isTrue(await this.amp.isOperator(operator, tokenHolder))

        await this.amp.revokeOperator(operator, { from: tokenHolder })

        assert.isTrue(!(await this.amp.isOperator(operator, tokenHolder)))
      })
      it('emits a revoked event', async function () {
        const { logs } = await this.amp.revokeOperator(controller, {
          from: tokenHolder,
        })

        assert.equal(logs.length, 1)
        assertEqualEvent(logs[0], RevokedOperator, {
          operator: controller,
          tokenHolder: tokenHolder,
        })
      })
    })
    describe('when sender revokes himself', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.revokeOperator(tokenHolder, { from: tokenHolder })
        )
      })
    })
  })

  describe('authorizeOperatorByPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    it('authorizes the operator', async function () {
      assert.isTrue(
        !(await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          operator,
          tokenHolder
        ))
      )
      await this.amp.authorizeOperatorByPartition(DEFAULT_PARTITION, operator, {
        from: tokenHolder,
      })
      assert.isTrue(
        await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          operator,
          tokenHolder
        )
      )
    })
    it('emits an authorized event', async function () {
      const {
        logs,
      } = await this.amp.authorizeOperatorByPartition(
        DEFAULT_PARTITION,
        operator,
        { from: tokenHolder }
      )

      assert.equal(logs.length, 1)
      assert.equal(logs.length, 1)
      assertEqualEvent(logs[0], AuthorizedOperatorByPartition, {
        partition: DEFAULT_PARTITION,
        operator: operator,
        tokenHolder: tokenHolder,
      })
    })
  })

  describe('revokeOperatorByPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when operator is not controller', function () {
      it('revokes the operator', async function () {
        await this.amp.authorizeOperatorByPartition(
          DEFAULT_PARTITION,
          operator,
          {
            from: tokenHolder,
          }
        )
        assert.isTrue(
          await this.amp.isOperatorForPartition(
            DEFAULT_PARTITION,
            operator,
            tokenHolder
          )
        )
        await this.amp.revokeOperatorByPartition(DEFAULT_PARTITION, operator, {
          from: tokenHolder,
        })
        assert.isTrue(
          !(await this.amp.isOperatorForPartition(
            DEFAULT_PARTITION,
            operator,
            tokenHolder
          ))
        )
      })
      it('emits a revoked event', async function () {
        await this.amp.authorizeOperatorByPartition(
          DEFAULT_PARTITION,
          operator,
          {
            from: tokenHolder,
          }
        )
        const {
          logs,
        } = await this.amp.revokeOperatorByPartition(
          DEFAULT_PARTITION,
          operator,
          { from: tokenHolder }
        )

        assert.equal(logs.length, 1)
        assert.equal(logs[0].event, RevokedOperatorByPartition, {
          partition: DEFAULT_PARTITION,
          operator: operator,
          tokenHolder: tokenHolder,
        })
      })
    })
  })

  describe('isOperator', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    it('when operator is tokenHolder', async function () {
      assert.isTrue(await this.amp.isOperator(tokenHolder, tokenHolder))
    })
    it('when operator is authorized by tokenHolder', async function () {
      await this.amp.authorizeOperator(operator, { from: tokenHolder })
      assert.isTrue(await this.amp.isOperator(operator, tokenHolder))
    })
    it('when is a revoked operator', async function () {
      await this.amp.authorizeOperator(operator, { from: tokenHolder })
      await this.amp.revokeOperator(operator, { from: tokenHolder })
      assert.isTrue(!(await this.amp.isOperator(operator, tokenHolder)))
    })
  })

  describe('isOperatorForPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    it('when operator is tokenHolder', async function () {
      assert.isTrue(
        await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          tokenHolder
        )
      )
    })
    it('when operator is authorized by tokenHolder', async function () {
      await this.amp.authorizeOperatorByPartition(DEFAULT_PARTITION, operator, {
        from: tokenHolder,
      })
      assert.isTrue(
        await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          operator,
          tokenHolder
        )
      )
    })
    it('when is a revoked operator', async function () {
      await this.amp.authorizeOperatorByPartition(DEFAULT_PARTITION, operator, {
        from: tokenHolder,
      })

      await this.amp.revokeOperatorByPartition(DEFAULT_PARTITION, operator, {
        from: tokenHolder,
      })
      assert.isTrue(
        !(await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          operator,
          tokenHolder
        ))
      )
    })
    it('when is a controller and token is controllable', async function () {
      assert.isTrue(
        !(await this.amp.isOperatorForPartition(
          DEFAULT_PARTITION,
          controller,
          tokenHolder
        ))
      )
    })
  })

  describe('totalPartitions', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    it('returns the 1 partition when initially deployed', async function () {
      const totalPartitions = await this.amp.totalPartitions()
      // Total partitions should be set to 1, as the default is set on deplyoment
      assert.equal(totalPartitions.length, 1)
      assert.equal(totalPartitions[0], DEFAULT_PARTITION)
    })

    it('returns 1 partition when a transfer has occurred to the default partition', async function () {
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        recipient,
        issuanceAmount,
        ZERO_BYTE,
        ZERO_BYTE,
        { from: tokenHolder }
      )

      const totalPartitions = await this.amp.totalPartitions()
      assert.equal(totalPartitions.length, 1)

      assert.equal(totalPartitions[0], DEFAULT_PARTITION)
    })

    it('returns 2 partitions when a transfer has occurred to another partition', async function () {
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        recipient,
        issuanceAmount,
        concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
        ZERO_BYTE,
        { from: tokenHolder }
      )

      const totalPartitions = await this.amp.totalPartitions()
      assert.equal(totalPartitions.length, 2)

      assert.isTrue(totalPartitions.indexOf(DEFAULT_PARTITION) > -1)
      assert.isTrue(totalPartitions.indexOf(ALT_PARTITION_1) > -1)
    })

    it('returns 1 partitions when a transfer to and from another partition', async function () {
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        recipient,
        issuanceAmount,
        concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
        ZERO_BYTE,
        { from: tokenHolder }
      )

      let totalPartitions = await this.amp.totalPartitions()
      assert.equal(totalPartitions.length, 2)

      assert.isTrue(totalPartitions.indexOf(DEFAULT_PARTITION) > -1)
      assert.isTrue(totalPartitions.indexOf(ALT_PARTITION_1) > -1)

      await this.amp.transferByPartition(
        ALT_PARTITION_1,
        recipient,
        tokenHolder,
        issuanceAmount,
        concatHexData(FLAG_CHANGE_PARTITION, DEFAULT_PARTITION),
        ZERO_BYTE,
        { from: recipient }
      )

      totalPartitions = await this.amp.totalPartitions()
      assert.equal(totalPartitions.length, 1)

      assert.equal(totalPartitions[0], DEFAULT_PARTITION)
      assert.isTrue(totalPartitions.indexOf(DEFAULT_PARTITION) > -1)
    })
  })

  describe('totalSupplyByPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    it('returns the issuance value for the default partition when a swap has occurred', async function () {
      await this.harness.mockSwap(tokenHolder, issuanceAmount)

      const supply = await this.amp.totalSupplyByPartition(DEFAULT_PARTITION)

      assert.equal(issuanceAmount, supply)
    })

    it('returns the supply for all partitions when transfers are made to different partition', async function () {
      await this.harness.mockSwap(tokenHolder, issuanceAmount)
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        tokenHolder,
        issuanceAmount,
        concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_1),
        ZERO_BYTE,
        { from: tokenHolder }
      )
      await this.amp.transferByPartition(
        ALT_PARTITION_1,
        tokenHolder,
        recipient,
        issuanceAmount / 2,
        concatHexData(FLAG_CHANGE_PARTITION, ALT_PARTITION_2),
        ZERO_BYTE,
        { from: tokenHolder }
      )

      const defaultSupply = await this.amp.totalSupplyByPartition(
        DEFAULT_PARTITION
      )
      const alt1Supply = await this.amp.totalSupplyByPartition(ALT_PARTITION_1)
      const alt2Supply = await this.amp.totalSupplyByPartition(ALT_PARTITION_2)

      assert.equal(defaultSupply, 0)
      assert.equal(alt1Supply, issuanceAmount / 2)
      assert.equal(alt2Supply, issuanceAmount / 2)
    })
  })

  describe('balanceOf', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    describe('when the requested account has no tokens', function () {
      it('returns zero', async function () {
        const balance = await this.amp.balanceOf(unknown)

        assert.equal(balance, 0)
      })
    })

    describe('when the requested account has some tokens in the default partition', function () {
      it('returns the total amount of tokens', async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount)
        const balance = await this.amp.balanceOf(tokenHolder)

        assert.equal(balance, issuanceAmount)
      })
    })

    describe('when the requested account has some tokens in multiple partitions', function () {
      beforeEach(async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount, [
          ALT_PARTITION_1,
        ])
      })
      it('returns the total amount of tokens in both partitions', async function () {
        const balance = await this.amp.balanceOf(tokenHolder)
        assert.equal(balance, 2 * issuanceAmount)
      })
    })
  })

  describe('balanceOfByPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    describe('when the requested account has no tokens', function () {
      it('returns 0 for the default partition', async function () {
        const balance = await this.amp.balanceOfByPartition(
          DEFAULT_PARTITION,
          unknown
        )
        assert.equal(balance, 0)
      })

      it('returns 0 for other partitions', async function () {
        const balance = await this.amp.balanceOfByPartition(
          ALT_PARTITION_1,
          unknown
        )
        assert.equal(balance, 0)
      })
    })

    describe('when the requested account has some tokens in the default partition', function () {
      beforeEach(async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount)
      })
      it('returns the issued amount of tokens for the default partition', async function () {
        const balance = await this.amp.balanceOfByPartition(
          DEFAULT_PARTITION,
          tokenHolder
        )
        assert.equal(balance, issuanceAmount)
      })
      it('returns 0 tokens for the alternate partition', async function () {
        const balance = await this.amp.balanceOfByPartition(
          ALT_PARTITION_1,
          tokenHolder
        )
        assert.equal(balance, 0)
      })
    })

    describe('when the requested account has some tokens in multiple partitions', function () {
      beforeEach(async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount, [
          ALT_PARTITION_1,
        ])
      })
      it('returns the issued amount of tokens for the default partition', async function () {
        const balance = await this.amp.balanceOfByPartition(
          DEFAULT_PARTITION,
          tokenHolder
        )
        assert.equal(balance, issuanceAmount)
      })
      it('returns 0 tokens for the alternate partition', async function () {
        const balance = await this.amp.balanceOfByPartition(
          ALT_PARTITION_1,
          tokenHolder
        )
        assert.equal(balance, issuanceAmount)
      })
    })
  })

  describe('parameters', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    describe('name', function () {
      it('returns the name of the token', async function () {
        const name = await this.amp.name()

        assert.equal(name, 'Amp')
      })
    })

    describe('symbol', function () {
      it('returns the symbol of the token', async function () {
        const symbol = await this.amp.symbol()

        assert.equal(symbol, 'AMP')
      })
    })

    describe('decimals', function () {
      it('returns the decimals the token', async function () {
        const decimals = await this.amp.decimals()

        assert.equal(decimals, 18)
      })
    })

    describe('granularity', function () {
      it('returns the granularity of tokens', async function () {
        const granularity = await this.amp.granularity()

        assert.equal(granularity, 1)
      })
    })

    describe('total supply', function () {
      it('returns the total amount of tokens', async function () {
        await this.harness.mockSwap(tokenHolder, issuanceAmount)

        const totalSupply = await this.amp.totalSupply()

        assert.equal(totalSupply, issuanceAmount)
      })
    })

    describe('implementerAmp', function () {
      it('returns the contract address', async function () {
        const interfaceAmpImplementer = await this.registry.getInterfaceImplementer(
          this.amp.address,
          soliditySha3(AMP_INTERFACE_NAME)
        )
        assert.equal(interfaceAmpImplementer, this.amp.address)
      })
    })

    describe('implementer20', function () {
      it('returns the zero address', async function () {
        const interface20Implementer = await this.registry.getInterfaceImplementer(
          this.amp.address,
          soliditySha3(ERC20_INTERFACE_NAME)
        )
        assert.equal(interface20Implementer, this.amp.address)
      })
    })
  })

  describe('defaultPartition', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    it('returns the default partition', async function () {
      const defaultPartition = await this.amp.defaultPartition()
      assert.equal(defaultPartition, DEFAULT_PARTITION)
    })
  })

  describe('approveByPartition', function () {
    const amount = 100
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })
    describe('when sender approves an operator for the default partition', function () {
      it('approves the operator', async function () {
        assert.equal(
          await this.amp.allowanceByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            operator
          ),
          0
        )

        await this.amp.approveByPartition(DEFAULT_PARTITION, operator, amount, {
          from: tokenHolder,
        })

        assert.equal(
          await this.amp.allowanceByPartition(
            DEFAULT_PARTITION,
            tokenHolder,
            operator
          ),
          amount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.approveByPartition(
          DEFAULT_PARTITION,
          operator,
          amount,
          { from: tokenHolder }
        )

        assert.equal(logs.length, 2)
        assertEqualEvent(logs[0], ApprovalByPartition, {
          partition: DEFAULT_PARTITION,
          owner: tokenHolder,
          spender: operator,
          value: amount,
        })
        assertEqualEvent(logs[1], Approval, {
          owner: tokenHolder,
          spender: operator,
          value: amount,
        })
      })
    })
    describe('when sender approves an operator for a non default partition', function () {
      it('approves the operator', async function () {
        assert.equal(
          await this.amp.allowanceByPartition(
            ALT_PARTITION_1,
            tokenHolder,
            operator
          ),
          0
        )

        await this.amp.approveByPartition(ALT_PARTITION_1, operator, amount, {
          from: tokenHolder,
        })

        assert.equal(
          await this.amp.allowanceByPartition(
            ALT_PARTITION_1,
            tokenHolder,
            operator
          ),
          amount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.approveByPartition(
          ALT_PARTITION_1,
          operator,
          amount,
          { from: tokenHolder }
        )

        assert.equal(logs.length, 1)
        assertEqualEvent(logs[0], ApprovalByPartition, {
          partition: ALT_PARTITION_1,
          owner: tokenHolder,
          spender: operator,
          value: amount,
        })
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approveByPartition(DEFAULT_PARTITION, ZERO_ADDRESS, amount, {
            from: tokenHolder,
          })
        )
      })
    })
  })

  describe('increaseAllowanceByPartition', function () {
    const amount = 100
    const increaseAmount = 200
    const totalAmount = 300
    beforeEach(async function () {
      this.amp = await this.harness.init()

      assert.equal(
        await this.amp.allowanceByPartition(
          ALT_PARTITION_1,
          tokenHolder,
          operator
        ),
        0
      )

      await this.amp.approveByPartition(ALT_PARTITION_1, operator, amount, {
        from: tokenHolder,
      })
    })
    describe('when sender increases allowance for an operator for a given partition', function () {
      it('increases allowance for the operator', async function () {
        await this.amp.increaseAllowanceByPartition(
          ALT_PARTITION_1,
          operator,
          increaseAmount,
          {
            from: tokenHolder,
          }
        )
        assert.equal(
          await this.amp.allowanceByPartition(
            ALT_PARTITION_1,
            tokenHolder,
            operator
          ),
          totalAmount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.increaseAllowanceByPartition(
          ALT_PARTITION_1,
          operator,
          increaseAmount,
          {
            from: tokenHolder,
          }
        )

        assert.equal(logs.length, 1)
        assertEqualEvent(logs[0], ApprovalByPartition, {
          partition: ALT_PARTITION_1,
          owner: tokenHolder,
          spender: operator,
          value: totalAmount,
        })
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approveByPartition(ALT_PARTITION_1, ZERO_ADDRESS, amount, {
            from: tokenHolder,
          })
        )
      })
    })
  })

  describe('decreaseAllowanceByPartition', function () {
    const amount = 100
    const decreaseAmount = 20
    const totalAmount = 80
    beforeEach(async function () {
      this.amp = await this.harness.init()

      assert.equal(
        await this.amp.allowanceByPartition(
          ALT_PARTITION_1,
          tokenHolder,
          operator
        ),
        0
      )

      await this.amp.approveByPartition(ALT_PARTITION_1, operator, amount, {
        from: tokenHolder,
      })
    })
    describe('when sender decreases allowance for an operator for a given partition', function () {
      it('decreases the allowance for the operator', async function () {
        await this.amp.decreaseAllowanceByPartition(
          ALT_PARTITION_1,
          operator,
          decreaseAmount,
          {
            from: tokenHolder,
          }
        )
        assert.equal(
          await this.amp.allowanceByPartition(
            ALT_PARTITION_1,
            tokenHolder,
            operator
          ),
          totalAmount
        )
      })
      it('emits an approval event', async function () {
        const { logs } = await this.amp.decreaseAllowanceByPartition(
          ALT_PARTITION_1,
          operator,
          decreaseAmount,
          {
            from: tokenHolder,
          }
        )

        assert.equal(logs.length, 1)
        assertEqualEvent(logs[0], ApprovalByPartition, {
          partition: ALT_PARTITION_1,
          owner: tokenHolder,
          spender: operator,
          value: totalAmount,
        })
      })
    })
    describe('when sender decreases allowance for an operator for a given partition to less than 0', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.decreaseAllowanceByPartition(
            ALT_PARTITION_1,
            operator,
            amount + 1,
            {
              from: tokenHolder,
            }
          )
        )
      })
    })
    describe('when the operator to approve is the zero address', function () {
      it('reverts', async function () {
        await shouldFail.reverting(
          this.amp.approveByPartition(ALT_PARTITION_1, ZERO_ADDRESS, amount, {
            from: tokenHolder,
          })
        )
      })
    })
  })

  describe('Collateral Manager functionality', function () {
    beforeEach(async function () {
      this.amp = await this.harness.init()
    })

    describe('registerCollateralManager', function () {
      describe('when self registering', function () {
        it('works and emits a log', async function () {
          const { logs } = await this.amp.registerCollateralManager({
            from: operator,
          })
          assert.equal(logs[0].event, 'CollateralManagerRegistered')
          assert.equal(logs[0].args.collateralManager, operator)
        })

        it('reverts when trying to register again', async function () {
          await this.amp.registerCollateralManager({ from: operator })
          await shouldFail.reverting(
            this.amp.registerCollateralManager({ from: operator })
          )
        })
      })
    })

    describe('isCollateralManager', function () {
      beforeEach(async function () {
        await this.amp.registerCollateralManager({
          from: operator,
        })
      })
      it('returns true when the collateral manager is registered', async function () {
        assert.isTrue(await this.amp.isCollateralManager(operator))
      })

      it('returns false when the collateral manager is registered', async function () {
        assert.isTrue(!(await this.amp.isCollateralManager(randomAddy)))
      })
    })

    // Collateral Manager
    describe('isOperatorForCollateralManager', function () {
      describe('when collateral manager is registered', function () {
        beforeEach(async function () {
          this.manager = await MockCollateralPool.new(this.amp.address, true, {
            from: operator,
          })
        })
        describe('when called by authorized operator for collateral manager', function () {
          it('returns true', async function () {
            assert.isTrue(
              await this.amp.isOperatorForCollateralManager(
                DEFAULT_PARTITION,
                operator,
                this.manager.address
              )
            )
          })
        })
        describe('when collateral manager has not authorized the operator', function () {
          it('returns false', async function () {
            assert.isTrue(
              !(await this.amp.isOperatorForCollateralManager(
                DEFAULT_PARTITION,
                randomAddy,
                this.manager.address
              ))
            )
          })
        })
      })
      describe('when collateral manager is not registered', function () {
        it('reverts when called', async function () {
          const manager = await MockCollateralPool.new(this.amp.address, false)
          assert.isTrue(
            !(await this.amp.isOperatorForCollateralManager(
              DEFAULT_PARTITION,
              randomAddy,
              manager.address
            ))
          )
        })
      })
    })
  })
})
