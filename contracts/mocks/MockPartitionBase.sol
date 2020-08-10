// SPDX-License-Identifier: MIT

pragma solidity 0.6.10;

import "../erc1820/ERC1820Client.sol";
import "../partitions/lib/PartitionUtils.sol";

contract MockPartitionBase is ERC1820Client {
    function getAmpPartitionStrategyImplementer(bytes4 _prefix, address _amp)
        external
        view
        returns (address)
    {
        string memory iname = PartitionUtils._getPartitionStrategyValidatorIName(_prefix);
        return ERC1820Client.interfaceAddr(_amp, iname);
    }
}
