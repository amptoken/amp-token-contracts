// SPDX-License-Identifier: MIT

pragma solidity 0.6.10;

/**
 * @title PartitionUtils
 * @notice Partition related helper functions.
 */

library PartitionUtils {
    bytes32 public constant CHANGE_PARTITION_FLAG = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    /**
     * @notice Retrieve the destination partition from the 'data' field.
     * A partition change is requested ONLY when 'data' starts with the flag:
     *
     *   0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
     *
     * When the flag is detected, the destination partition is extracted from the
     * 32 bytes following the flag.
     * @param _data Information attached to the transfer. Will contain the
     * destination partition if a change is requested.
     * @param _fallbackPartition Partition value to return if a partition change
     * is not requested in the `_data`.
     * @return toPartition Destination partition. If the `_data` does not contain
     * the prefix and bytes32 partition in the first 64 bytes, the method will
     * return the provided `_fromPartition`.
     */
    function _getDestinationPartition(bytes memory _data, bytes32 _fallbackPartition)
        internal
        pure
        returns (bytes32)
    {
        if (_data.length < 64) {
            return _fallbackPartition;
        }

        (bytes32 flag, bytes32 toPartition) = abi.decode(_data, (bytes32, bytes32));
        if (flag == CHANGE_PARTITION_FLAG) {
            return toPartition;
        }

        return _fallbackPartition;
    }

    /**
     * @notice Helper to get the strategy identifying prefix from the `_partition`.
     * @param _partition Partition to get the prefix for.
     * @return 4 byte partition strategy prefix.
     */
    function _getPartitionPrefix(bytes32 _partition) internal pure returns (bytes4) {
        return bytes4(_partition);
    }

    /**
     * @notice Helper method to split the partition into the prefix, sub partition
     * and partition owner components.
     * @param _partition The partition to split into parts.
     * @return The 4 byte partition prefix, 8 byte sub partition, and final 20
     * bytes representing an address.
     */
    function _splitPartition(bytes32 _partition)
        internal
        pure
        returns (
            bytes4,
            bytes8,
            address
        )
    {
        bytes4 prefix = bytes4(_partition);
        bytes8 subPartition = bytes8(_partition << 32);
        address addressPart = address(uint160(uint256(_partition)));
        return (prefix, subPartition, addressPart);
    }

    /**
     * @notice Helper method to get a partition strategy ERC1820 interface name
     * based on partition prefix.
     * @param _prefix 4 byte partition prefix.
     * @dev Each 4 byte prefix has a unique interface name so that an individual
     * hook implementation can be set for each prefix.
     */
    function _getPartitionStrategyValidatorIName(bytes4 _prefix)
        internal
        pure
        returns (string memory)
    {
        return string(abi.encodePacked("AmpPartitionStrategyValidator", _prefix));
    }
}
