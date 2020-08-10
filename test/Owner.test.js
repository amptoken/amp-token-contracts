import { shouldFail } from 'openzeppelin-test-helpers'
import { Constants } from './utils'
import {
    OwnershipTransferAuthorization,
    OwnerUpdate,
} from './utils/events'

const Amp = artifacts.require('Amp')
const MockFXC = artifacts.require('MockFXC')
const { ZERO_ADDRESS } = Constants

contract('Amp', function ([
    owner,
    newOwner,
    unknown
]) {
    describe('Owner', () => {
        beforeEach(async function () {
            const fxc = await MockFXC.new()
            this.amp = await Amp.new(fxc.address, 'Amp', 'AMP')
        })

        it('sets the initial owner to creator', async function () {
            const currentOwner = await this.amp.owner()

            assert.equal(currentOwner, owner)
        })

        it('sets the initial authorized new owner to the zero address', async function () {
            const currentAuthorizedNewOwner = await this.amp.authorizedNewOwner()

            assert.equal(currentAuthorizedNewOwner, ZERO_ADDRESS)
        })

        describe('when owner authorizes ownership transfer', () => {
            beforeEach(async function () {
                await this.amp.authorizeOwnershipTransfer(
                    newOwner,
                    { from: owner }
                )
            })

            it('sets authorized new owner', async function () {
                const authorizedNewOwner = await this.amp.authorizedNewOwner()

                assert.equal(authorizedNewOwner, newOwner)
            })

            it('emits an event', async function () {
                const logs = await this.amp.getPastEvents()
                const event = logs[0];

                assert.equal(event.event, OwnershipTransferAuthorization)
                assert.equal(event.args.authorizedAddress, newOwner)
            })

            describe('when new owner assumes ownership', () => {
                beforeEach(async function () {
                    await this.amp.assumeOwnership(
                        { from: newOwner }
                    )
                })

                it('sets the new owner', async function () {
                    const currentOwner = await this.amp.owner()

                    assert.equal(currentOwner, newOwner)
                })

                it('resets the authorized new owner', async function () {
                    const currentAuthorizedNewOwner = await this.amp.authorizedNewOwner()

                    assert.equal(currentAuthorizedNewOwner, ZERO_ADDRESS)
                })

                it('emits an event', async function () {
                    const logs = await this.amp.getPastEvents()
                    const event = logs[0];

                    assert.equal(event.event, OwnerUpdate)
                    assert.equal(event.args.oldValue, owner)
                    assert.equal(event.args.newValue, newOwner)
                })
            })

            describe('when unauthorized caller assumes ownership', () => {
                it('reverts', async function () {
                    await shouldFail.reverting(
                        this.amp.assumeOwnership(
                            { from: unknown }
                        )
                    )
                })
            })
        })

        describe('when non-owner authorizes ownership transfer', () => {
            it('reverts', async function () {
                await shouldFail.reverting(
                    this.amp.authorizeOwnershipTransfer(
                        newOwner,
                        { from: unknown }
                    )
                )
            })
        })
    })
})
