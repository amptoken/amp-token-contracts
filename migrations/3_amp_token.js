const AmpToken = artifacts.require('Amp.sol')
const MockFXC = artifacts.require('MockFXC.sol')
const CollateralPoolPartitionValidator = artifacts.require('CollateralPoolPartitionValidator.sol')
const HolderCollateralPartitionValidator = artifacts.require('HolderCollateralPartitionValidator.sol')

const name = 'Amp'
const symbol = 'AMP'

module.exports = async function (deployer, network, accounts) {
  let swapTokenAddress
  if (network === 'development' || network === 'test') {
    await deployer.deploy(MockFXC)
    swapTokenAddress = MockFXC.address
  } else {
    // TODO: Need to use existing FXC address on main or test nets
    swapTokenAddress = '0x4a57e687b9126435a9b19e4a802113e266adebde'
  }

  await deployer.deploy(AmpToken, swapTokenAddress, name, symbol)
  console.log('\n   > Amp token deployment: Success -->', AmpToken.address)

  let amp = await AmpToken.deployed()

  await deployer.deploy(HolderCollateralPartitionValidator, AmpToken.address)
  console.log('\n   > HolderCollateralPartitionValidator deployment: Success -->', HolderCollateralPartitionValidator.address)

  await amp.setPartitionStrategy(
    '0xAAAAAAAA',
    HolderCollateralPartitionValidator.address,
  )

  await deployer.deploy(CollateralPoolPartitionValidator, AmpToken.address)
  console.log('\n   > CollateralPoolPartitionValidator deployment: Success -->', CollateralPoolPartitionValidator.address)

  await amp.setPartitionStrategy(
    '0xCCCCCCCC',
    CollateralPoolPartitionValidator.address,
  )
}
