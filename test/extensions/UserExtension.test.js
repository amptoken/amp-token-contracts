import { shouldFail } from 'openzeppelin-test-helpers'
import { soliditySha3 } from 'web3-utils'

import { TestHarness, Constants, INames } from '../utils'
import { DEFAULT_PARTITION, ZERO_BYTE } from '../utils/constants'

const { ZERO_ADDRESS } = Constants
const { AMP_TOKENS_SENDER, AMP_TOKENS_RECIPIENT } = INames

const MockAmpTokensSender = artifacts.require('MockAmpTokensSender')
const MockAmpTokensRecipient = artifacts.require('MockAmpTokensRecipient')

const VALID_DATA =
  '0x1000000000000000000000000000000000000000000000000000000000000000'
const INVALID_DATA_SENDER =
  '0x1100000000000000000000000000000000000000000000000000000000000000'
const INVALID_DATA_RECIPIENT =
  '0x2200000000000000000000000000000000000000000000000000000000000000'

const issuanceAmount = 1000

contract('Amp with sender and recipient hooks', function ([
  owner,
  operator,
  controller,
  tokenHolder,
  recipient,
  unknown,
]) {
  before(async function () {
    this.harness = new TestHarness({ owner })
    await this.harness.init()
    this.registry = this.harness.registry
  })

  const amount = issuanceAmount
  const to = recipient

  beforeEach(async function () {
    this.amp = await this.harness.init()
    await this.harness.mockSwap(tokenHolder, issuanceAmount)

    this.senderContract = await MockAmpTokensSender.new({
      from: tokenHolder,
    })
    await this.registry.setInterfaceImplementer(
      tokenHolder,
      soliditySha3(AMP_TOKENS_SENDER),
      this.senderContract.address,
      { from: tokenHolder }
    )

    this.recipientContract = await MockAmpTokensRecipient.new({
      from: recipient,
    })
    await this.registry.setInterfaceImplementer(
      recipient,
      soliditySha3(AMP_TOKENS_RECIPIENT),
      this.recipientContract.address,
      { from: recipient }
    )
  })
  afterEach(async function () {
    await this.registry.setInterfaceImplementer(
      tokenHolder,
      soliditySha3(AMP_TOKENS_SENDER),
      ZERO_ADDRESS,
      { from: tokenHolder }
    )
    await this.registry.setInterfaceImplementer(
      recipient,
      soliditySha3(AMP_TOKENS_RECIPIENT),
      ZERO_ADDRESS,
      { from: recipient }
    )
  })
  describe('when the transfer is successful', function () {
    it('transfers the requested amount', async function () {
      await this.amp.transferByPartition(
        DEFAULT_PARTITION,
        tokenHolder,
        to,
        amount,
        VALID_DATA,
        ZERO_BYTE,
        {
          from: tokenHolder,
        }
      )
      const senderBalance = await this.amp.balanceOf(tokenHolder)
      assert.equal(senderBalance, issuanceAmount - amount)

      const recipientBalance = await this.amp.balanceOf(to)
      assert.equal(recipientBalance, amount)
    })
  })
  describe('when the transfer fails', function () {
    it('sender hook reverts', async function () {
      // Default sender hook failure data for the mock only:
      // 0x1100000000000000000000000000000000000000000000000000000000000000
      await shouldFail.reverting(
        this.amp.transferByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          to,
          amount,
          INVALID_DATA_SENDER,
          ZERO_BYTE,
          {
            from: tokenHolder,
          }
        )
      )
    })
    it('recipient hook reverts', async function () {
      // Default recipient hook failure data for the mock only:
      // 0x2200000000000000000000000000000000000000000000000000000000000000
      await shouldFail.reverting(
        this.amp.transferByPartition(
          DEFAULT_PARTITION,
          tokenHolder,
          to,
          amount,
          INVALID_DATA_RECIPIENT,
          ZERO_BYTE,
          {
            from: tokenHolder,
          }
        )
      )
    })
  })
})
