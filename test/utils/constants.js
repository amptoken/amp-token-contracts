import { toHex } from 'web3-utils'
import { toPartition } from './helpers'

// Flag to indicate a partition change
export const FLAG_CHANGE_PARTITION =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
export const partitionSwitchFlag =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
// Other flag
export const FLAG_OTHER_UKNOWNN =
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000'
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_BYTE = '0x'
export const EMPTY_BYTE32 = ZERO_BYTES32

export const FXC_GRAVEYARD = '0x000000000000000000000000000000000000dEaD'

export const DEFAULT_PARTITION =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

export const ALT_PARTITION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001'
export const ALT_PARTITION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002'
export const RESERVED_PARTITION = '0xFF00000000000000000000000000000000000000000000000000000000000000'
export const ZERO_PREFIX = '0x00000000'

export const NAME = 'Amp'
export const SYMBOL = 'AMP'
export const GRANULARITY = 1
