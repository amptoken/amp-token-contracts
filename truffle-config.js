require('@babel/register')

require('dotenv').config()

const HDWalletProvider = require('truffle-hdwallet-provider')

const networks = {
  rinkeby: {
    id: 4,
    https: 'https://rinkeby.infura.io/v3/1e67b2d9e02441478520280b4f3f2f66',
    wss: 'wss://rinkeby.infura.io/ws/v3/1e67b2d9e02441478520280b4f3f2f66',
  },
  mainnet: {
    id: 1,
    https: 'https://mainnet.infura.io/v3/1e67b2d9e02441478520280b4f3f2f66',
    wss: 'wss://mainnet.infura.io/ws/v3/1e67b2d9e02441478520280b4f3f2f66',
  },
}

const {
  ACCOUNT_AMP_OWNER,
  ACCOUNT_AMP_OWNER_PKEY,
  ACCOUNT_COLLATERAL_MANAGER,
  ACCOUNT_COLLATERAL_MANAGER_PKEY,
} = process.env

const accounts = [ACCOUNT_AMP_OWNER, ACCOUNT_COLLATERAL_MANAGER]

const privateKeys = [ACCOUNT_AMP_OWNER_PKEY, ACCOUNT_COLLATERAL_MANAGER_PKEY]

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // eslint-disable-line camelcase
    },
    ganache: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // eslint-disable-line camelcase
    },
    // TODO: Make local truffle commands work without env vars set
    // rinkeby: {
    //   provider: new HDWalletProvider(privateKeys, networks.rinkeby.https, 0, 2),
    //   network_id: networks.rinkeby.id,
    //   from: accounts[0],
    //   gas: 6000000,
    // },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    timeout: 100000,
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: '0.6.10',
      settings: {
        optimizer: {
          enabled: false, // Default: false
          runs: 0, // Default: 200
        },
        evmVersion: 'istanbul',
        debug: {
          revertStrings: 'strip',
        },
      },
    },
  },

  plugins: ['solidity-coverage'],
}
