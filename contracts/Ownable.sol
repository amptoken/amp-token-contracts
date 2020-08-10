// SPDX-License-Identifier: MIT

pragma solidity 0.6.10;

/**
 * @title Ownable is a contract the provides contract ownership functionality, including a two-
 * phase transfer.
 */
contract Ownable {
    address private _owner;
    address private _authorizedNewOwner;

    /**
     * @notice Emitted when the owner authorizes ownership transfer to a new address
     * @param authorizedAddress New owner address
     */
    event OwnershipTransferAuthorization(address indexed authorizedAddress);

    /**
     * @notice Emitted when the authorized address assumed ownership
     * @param oldValue Old owner
     * @param newValue New owner
     */
    event OwnerUpdate(address indexed oldValue, address indexed newValue);

    /**
     * @notice Sets the owner to the sender / contract creator
     */
    constructor() internal {
        _owner = msg.sender;
    }

    /**
     * @notice Retrieves the owner of the contract
     * @return The contract owner
     */
    function owner() public view returns (address) {
        return _owner;
    }

    /**
     * @notice Retrieves the authorized new owner of the contract
     * @return The authorized new contract owner
     */
    function authorizedNewOwner() public view returns (address) {
        return _authorizedNewOwner;
    }

    /**
     * @notice Authorizes the transfer of ownership from owner to the provided address.
     * NOTE: No transfer will occur unless authorizedAddress calls assumeOwnership().
     * This authorization may be removed by another call to this function authorizing the zero
     * address.
     * @param _authorizedAddress The address authorized to become the new owner
     */
    function authorizeOwnershipTransfer(address _authorizedAddress) external {
        require(msg.sender == _owner, "Invalid sender");

        _authorizedNewOwner = _authorizedAddress;

        emit OwnershipTransferAuthorization(_authorizedNewOwner);
    }

    /**
     * @notice Transfers ownership of this contract to the _authorizedNewOwner
     * @dev Error invalid sender.
     */
    function assumeOwnership() external {
        require(msg.sender == _authorizedNewOwner, "Invalid sender");

        address oldValue = _owner;
        _owner = _authorizedNewOwner;
        _authorizedNewOwner = address(0);

        emit OwnerUpdate(oldValue, _owner);
    }
}
