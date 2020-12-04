// SPDX-License-Identifier: MIT

pragma solidity 0.6.10;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Ownable.sol";

import "./erc1820/ERC1820Client.sol";
import "./erc1820/ERC1820Implementer.sol";

import "./extensions/IAmpTokensSender.sol";
import "./extensions/IAmpTokensRecipient.sol";

import "./partitions/IAmpPartitionStrategyValidator.sol";
import "./partitions/lib/PartitionUtils.sol";

import "./codes/ErrorCodes.sol";

interface ISwapToken {
    function allowance(address owner, address spender)
        external
        view
        returns (uint256 remaining);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool success);
}

/**
 * @title Amp
 * @notice Amp is an ERC20 compatible collateral token designed to support
 * multiple classes of collateralization systems.
 * @dev The Amp token contract includes the following features:
 *
 * Partitions
 *   Tokens can be segmented within a given address by "partition", which in
 *   practice is a 32 byte identifier. These partitions can have unique
 *   permissions globally, through the using of partition strategies, and
 *   locally, on a per address basis. The ability to create the sub-segments
 *   of tokens and assign special behavior gives collateral managers
 *   flexibility in how they are implemented.
 *
 * Operators
 *   Inspired by ERC777, Amp allows token holders to assign "operators" on
 *   all (or any number of partitions) of their tokens. Operators are allowed
 *   to execute transfers on behalf of token owners without the need to use the
 *   ERC20 "allowance" semantics.
 *
 * Transfers with Data
 *   Inspired by ERC777, Amp transfers can include arbitrary data, as well as
 *   operator data. This data can be used to change the partition of tokens,
 *   be used by collateral manager hooks to validate a transfer, be propagated
 *   via event to an off chain system, etc.
 *
 * Token Transfer Hooks on Send and Receive
 *   Inspired by ERC777, Amp uses the ERC1820 Registry to allow collateral
 *   manager implementations to register hooks to be called upon sending to
 *   or transferring from the collateral manager's address or, using partition
 *   strategies, owned partition space. The hook implementations can be used
 *   to validate transfer properties, gate transfers, emit custom events,
 *   update local state, etc.
 *
 * Collateral Management Partition Strategies
 *   Amp is able to define certain sets of partitions, identified by a 4 byte
 *   prefix, that will allow special, custom logic to be executed when transfers
 *   are made to or from those partitions. This opens up the possibility of
 *   entire classes of collateral management systems that would not be possible
 *   without it.
 *
 * These features give collateral manager implementers flexibility while
 * providing a consistent, "collateral-in-place", interface for interacting
 * with collateral systems directly through the Amp contract.
 */
contract Amp is IERC20, ERC1820Client, ERC1820Implementer, ErrorCodes, Ownable {
    using SafeMath for uint256;

    /**************************************************************************/
    /********************** ERC1820 Interface Constants ***********************/

    /**
     * @dev AmpToken interface label.
     */
    string internal constant AMP_INTERFACE_NAME = "AmpToken";

    /**
     * @dev ERC20Token interface label.
     */
    string internal constant ERC20_INTERFACE_NAME = "ERC20Token";

    /**
     * @dev AmpTokensSender interface label.
     */
    string internal constant AMP_TOKENS_SENDER = "AmpTokensSender";

    /**
     * @dev AmpTokensRecipient interface label.
     */
    string internal constant AMP_TOKENS_RECIPIENT = "AmpTokensRecipient";

    /**
     * @dev AmpTokensChecker interface label.
     */
    string internal constant AMP_TOKENS_CHECKER = "AmpTokensChecker";

    /**************************************************************************/
    /*************************** Token properties *****************************/

    /**
     * @dev Token name (Amp).
     */
    string internal _name;

    /**
     * @dev Token symbol (Amp).
     */
    string internal _symbol;

    /**
     * @dev Total minted supply of token. This will increase comensurately with
     * successful swaps of the swap token.
     */
    uint256 internal _totalSupply;

    /**
     * @dev The granularity of the token. Hard coded to 1.
     */
    uint256 internal constant _granularity = 1;

    /**************************************************************************/
    /***************************** Token mappings *****************************/

    /**
     * @dev Mapping from tokenHolder to balance. This reflects the balance
     * across all partitions of an address.
     */
    mapping(address => uint256) internal _balances;

    /**************************************************************************/
    /************************** Partition mappings ****************************/

    /**
     * @dev List of active partitions. This list reflects all partitions that
     * have tokens assigned to them.
     */
    bytes32[] internal _totalPartitions;

    /**
     * @dev Mapping from partition to their index.
     */
    mapping(bytes32 => uint256) internal _indexOfTotalPartitions;

    /**
     * @dev Mapping from partition to global balance of corresponding partition.
     */
    mapping(bytes32 => uint256) public totalSupplyByPartition;

    /**
     * @dev Mapping from tokenHolder to their partitions.
     */
    mapping(address => bytes32[]) internal _partitionsOf;

    /**
     * @dev Mapping from (tokenHolder, partition) to their index.
     */
    mapping(address => mapping(bytes32 => uint256)) internal _indexOfPartitionsOf;

    /**
     * @dev Mapping from (tokenHolder, partition) to balance of corresponding
     * partition.
     */
    mapping(address => mapping(bytes32 => uint256)) internal _balanceOfByPartition;

    /**
     * @notice Default partition of the token.
     * @dev All ERC20 operations operate solely on this partition.
     */
    bytes32
        public constant defaultPartition = 0x0000000000000000000000000000000000000000000000000000000000000000;

    /**
     * @dev Zero partition prefix. Partitions with this prefix can not have
     * a strategy assigned, and partitions with a different prefix must have one.
     */
    bytes4 internal constant ZERO_PREFIX = 0x00000000;

    /**************************************************************************/
    /***************************** Operator mappings **************************/

    /**
     * @dev Mapping from (tokenHolder, operator) to authorized status. This is
     * specific to the token holder.
     */
    mapping(address => mapping(address => bool)) internal _authorizedOperator;

    /**************************************************************************/
    /********************** Partition operator mappings ***********************/

    /**
     * @dev Mapping from (partition, tokenHolder, spender) to allowed value.
     * This is specific to the token holder.
     */
    mapping(bytes32 => mapping(address => mapping(address => uint256)))
        internal _allowedByPartition;

    /**
     * @dev Mapping from (tokenHolder, partition, operator) to 'approved for
     * partition' status. This is specific to the token holder.
     */
    mapping(address => mapping(bytes32 => mapping(address => bool)))
        internal _authorizedOperatorByPartition;

    /**************************************************************************/
    /********************** Collateral Manager mappings ***********************/
    /**
     * @notice Collection of registered collateral managers.
     */
    address[] public collateralManagers;
    /**
     * @dev Mapping of collateral manager addresses to registration status.
     */
    mapping(address => bool) internal _isCollateralManager;

    /**************************************************************************/
    /********************* Partition Strategy mappings ************************/

    /**
     * @notice Collection of reserved partition strategies.
     */
    bytes4[] public partitionStrategies;

    /**
     * @dev Mapping of partition strategy flag to registration status.
     */
    mapping(bytes4 => bool) internal _isPartitionStrategy;

    /**************************************************************************/
    /***************************** Swap storage *******************************/

    /**
     * @notice Swap token address. Immutable.
     */
    ISwapToken public swapToken;

    /**
     * @notice Swap token graveyard address.
     * @dev This is the address that the incoming swapped tokens will be
     * forwarded to upon successfully minting Amp.
     */
    address
        public constant swapTokenGraveyard = 0x000000000000000000000000000000000000dEaD;

    /**************************************************************************/
    /** EVENTS ****************************************************************/
    /**************************************************************************/

    /**************************************************************************/
    /**************************** Transfer Events *****************************/

    /**
     * @notice Emitted when a transfer has been successfully completed.
     * @param fromPartition The partition from which tokens were transferred.
     * @param operator The address that initiated the transfer.
     * @param from The address from which the tokens were transferred.
     * @param to The address to which the tokens were transferred.
     * @param value The amount of tokens transferred.
     * @param data Additional metadata included with the transfer. Can include
     * the partition to which the tokens were transferred, if different than
     * `fromPartition`.
     * @param operatorData Additional metadata included with the transfer. Typically used by
     * partition strategies and collateral managers to authorize transfers.
     */
    event TransferByPartition(
        bytes32 indexed fromPartition,
        address operator,
        address indexed from,
        address indexed to,
        uint256 value,
        bytes data,
        bytes operatorData
    );

    /**
     * @notice Emitted when a transfer has been successfully completed and the
     * tokens that were transferred have changed partitions.
     * @param fromPartition The partition from which the tokens were transferred.
     * @param toPartition The partition to which the tokens were transferred.
     * @param value The amount of tokens transferred.
     */
    event ChangedPartition(
        bytes32 indexed fromPartition,
        bytes32 indexed toPartition,
        uint256 value
    );

    /**************************************************************************/
    /**************************** Operator Events *****************************/

    /**
     * @notice Emitted when a token holder authorizes an address to transfer tokens on its behalf
     * from a particular partition.
     * @param partition The partition of the tokens from which the holder has authorized the
     * `spender` to transfer.
     * @param owner The token holder.
     * @param spender The operator for which the `owner` has authorized the allowance.
     * @param value The amount of tokens authorized for transfer.
     */
    event ApprovalByPartition(
        bytes32 indexed partition,
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    /**
     * @notice Emitted when a token holder has authorized an operator to transfer tokens on the
     * behalf of the holder across all partitions.
     * @param operator The address that was authorized to transfer tokens on
     * behalf of the `tokenHolder`.
     * @param tokenHolder The address that authorized the `operator` to transfer
     * their tokens.
     */
    event AuthorizedOperator(address indexed operator, address indexed tokenHolder);

    /**
     * @notice Emitted when a token holder has deauthorized an operator from
     * transferring tokens on behalf of the holder.
     * @dev Note that this applies an account-wide authorization change, and does not reflect any
     * change in the authorization for a particular partition.
     * @param operator The address that was deauthorized from transferring tokens
     * on behalf of the `tokenHolder`.
     * @param tokenHolder The address that revoked the `operator`'s authorization
     * to transfer their tokens.
     */
    event RevokedOperator(address indexed operator, address indexed tokenHolder);

    /**
     * @notice Emitted when a token holder has authorized an operator to transfer
     * tokens on behalf of the holder from a particular partition.
     * @param partition The partition from which the `operator` is authorized to transfer.
     * @param operator The address authorized to transfer tokens on
     * behalf of the `tokenHolder`.
     * @param tokenHolder The address that authorized the `operator` to transfer
     * tokens held in partition `partition`.
     */
    event AuthorizedOperatorByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed tokenHolder
    );

    /**
     * @notice Emitted when a token holder has deauthorized an operator from
     * transferring held tokens from a specific partition.
     * @param partition The partition for which the `operator` was deauthorized for token transfer
     * on behalf of the `tokenHolder`.
     * @param operator The address that was deauthorized from transferring
     * tokens on behalf of the `tokenHolder`.
     * @param tokenHolder The address that revoked the `operator`'s permission
     * to transfer held tokens from `partition`.
     */
    event RevokedOperatorByPartition(
        bytes32 indexed partition,
        address indexed operator,
        address indexed tokenHolder
    );

    /**************************************************************************/
    /********************** Collateral Manager Events *************************/

    /**
     * @notice Emitted when a collateral manager has been registered.
     * @param collateralManager The address of the collateral manager.
     */
    event CollateralManagerRegistered(address collateralManager);

    /**************************************************************************/
    /*********************** Partition Strategy Events ************************/

    /**
     * @notice Emitted when a new partition strategy validator is set.
     * @param flag The 4 byte prefix of the partitions that the strategy affects.
     * @param name The name of the interface implemented by the partition strategy.
     * @param implementation The address of the partition strategy hook
     * implementation.
     */
    event PartitionStrategySet(bytes4 flag, string name, address indexed implementation);

    // ************** Mint & Swap **************

    /**
     * @notice Emitted when tokens are minted, which only occurs as the result of token swap.
     * @param operator Address that executed the swap, resulting in tokens being minted
     * @param to Address that received the newly minted tokens.
     * @param value Amount of tokens minted.
     * @param data Additional metadata. Unused; required for interface compatibility.
     */
    event Minted(address indexed operator, address indexed to, uint256 value, bytes data);

    /**
     * @notice Emitted when tokens are swapped as part of the minting process.
     * @param operator Address that executed the swap.
     * @param from Address whose source swap tokens were burned, and for which Amp tokens were
     * minted.
     * @param value Amount of tokens swapped into Amp.
     */
    event Swap(address indexed operator, address indexed from, uint256 value);

    /**************************************************************************/
    /** CONSTRUCTOR ***********************************************************/
    /**************************************************************************/

    /**
     * @notice Initialize Amp, initialize the default partition, and register the
     * contract implementation in the global ERC1820Registry.
     * @param _swapTokenAddress_ The address of the ERC-20 token that is set to be
     * swappable for Amp.
     * @param _name_ Name of the token to be initialized.
     * @param _symbol_ Symbol of the token to be initialized.
     */
    constructor(
        address _swapTokenAddress_,
        string memory _name_,
        string memory _symbol_
    ) public {
        // "Swap token cannot be 0 address"
        require(_swapTokenAddress_ != address(0), EC_5A_INVALID_SWAP_TOKEN_ADDRESS);
        swapToken = ISwapToken(_swapTokenAddress_);

        _name = _name_;
        _symbol = _symbol_;
        _totalSupply = 0;

        // Add the default partition to the total partitions on deploy
        _addPartitionToTotalPartitions(defaultPartition);

        // Register contract in ERC1820 registry
        ERC1820Client.setInterfaceImplementation(AMP_INTERFACE_NAME, address(this));
        ERC1820Client.setInterfaceImplementation(ERC20_INTERFACE_NAME, address(this));

        // Indicate token verifies Amp and ERC20 interfaces
        ERC1820Implementer._setInterface(AMP_INTERFACE_NAME);
        ERC1820Implementer._setInterface(ERC20_INTERFACE_NAME);
    }

    /**************************************************************************/
    /** EXTERNAL FUNCTIONS (ERC20) ********************************************/
    /**************************************************************************/

    /**
     * @notice Retrieves the total number of minted tokens.
     * @return uint256 containing the total number of minted tokens.
     */
    function totalSupply() external override view returns (uint256) {
        return _totalSupply;
    }

    /**
     * @notice Retrieves the balance of the account with address `_tokenHolder` across all partitions.
     * @dev Note that this figure should not be used as the arbiter of the amount a token holder
     * will successfully be able to send via the ERC-20 compatible `Amp.transfer` method. In order
     * to get that figure, use `Amp.balanceOfByPartition` to get the balance of the default
     * partition.
     * @param _tokenHolder Address for which the balance is returned.
     * @return uint256 containing the amount of tokens held by `_tokenHolder`
     * across all partitions.
     */
    function balanceOf(address _tokenHolder) external override view returns (uint256) {
        return _balances[_tokenHolder];
    }

    /**
     * @notice Transfers an amount of tokens to the specified address.
     * @dev Note that this only transfers from the `msg.sender` address's default partition.
     * To transfer from other partitions, use function `Amp.transferByPartition`.
     * @param _to The address to which the tokens should be transferred.
     * @param _value The amount of tokens to be transferred.
     * @return bool indicating whether the operation was successful.
     */
    function transfer(address _to, uint256 _value) external override returns (bool) {
        _transferByDefaultPartition(msg.sender, msg.sender, _to, _value, "");
        return true;
    }

    /**
     * @notice Transfers an amount of tokens between two accounts.
     * @dev Note that this only transfers from the `_from` address's default partition.
     * To transfer from other partitions, use function `Amp.transferByPartition`.
     * @param _from The address from which the tokens are to be transferred.
     * @param _to The address to which the tokens are to be transferred.
     * @param _value The amount of tokens to be transferred.
     * @return bool indicating whether the operation was successful.
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) external override returns (bool) {
        _transferByDefaultPartition(msg.sender, _from, _to, _value, "");
        return true;
    }

    /**
     * @notice Retrieves the allowance of tokens that has been granted by `_owner` to
     * `_spender` for the default partition.
     * @dev Note that this only returns the allowance of the `_owner` address's default partition.
     * To retrieve the allowance for a different partition, use function `Amp.allowanceByPartition`.
     * @param _owner The address holding the authorized tokens.
     * @param _spender The address authorized to transfer the tokens from `_owner`.
     * @return uint256 specifying the amount of tokens available for the `_spender` to transfer
     * from the `_owner`'s default partition.
     */
    function allowance(address _owner, address _spender)
        external
        override
        view
        returns (uint256)
    {
        return _allowedByPartition[defaultPartition][_owner][_spender];
    }

    /**
     * @notice Sets an allowance for an address to transfer an amount of tokens on behalf of the
     * caller.
     * @dev Note that this only affects the `msg.sender` address's default partition.
     * To approve transfers from other partitions, use function `Amp.approveByPartition`.
     * 
     * This method is required for ERC-20 compatibility, but is subject to the race condition
     * described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729.
     * 
     * Functions `Amp.increaseAllowance` and `Amp.decreaseAllowance` should be used instead.
     * @param _spender The address which is authorized to transfer tokens from default partition
     * of `msg.sender`.
     * @param _value The amount of tokens to be authorized.
     * @return bool indicating if the operation was successful.
     */
    function approve(address _spender, uint256 _value) external override returns (bool) {
        _approveByPartition(defaultPartition, msg.sender, _spender, _value);
        return true;
    }

    /**
     * @notice Increases the allowance granted to `_spender` by the caller.
     * @dev This is an alternative to `Amp.approve` that can be used as a mitigation for
     * the race condition described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729.
     * 
     * Note that this only affects the `msg.sender` address's default partition.
     * To increase the allowance for other partitions, use function
     * `Amp.increaseAllowanceByPartition`.
     * 
     * #### Requirements:
     * - `_spender` cannot be the zero address.
     * @param _spender The account authorized to transfer the tokens.
     * @param _addedValue Additional amount of the `msg.sender`'s tokens `_spender`
     * is allowed to transfer.
     * @return bool indicating if the operation was successful.
     */
    function increaseAllowance(address _spender, uint256 _addedValue)
        external
        returns (bool)
    {
        _approveByPartition(
            defaultPartition,
            msg.sender,
            _spender,
            _allowedByPartition[defaultPartition][msg.sender][_spender].add(_addedValue)
        );
        return true;
    }

    /**
     * @notice Decreases the allowance granted to `_spender` by the caller.
     * @dev This is an alternative to `Amp.approve` that can be used as a mitigation for
     * the race condition described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729.
     * 
     * Note that this only affects the `msg.sender` address's default partition.
     * To decrease the allowance for other partitions, use function
     * `decreaseAllowanceByPartition`.
     * 
     * #### Requirements:
     * - `_spender` cannot be the zero address.
     * - `_spender` must have an allowance for the caller of at least `_subtractedValue`.
     * @param _spender Account whose authorization to transfer tokens is to be decreased.
     * @param _subtractedValue Amount by which the authorization for `_spender` to transfer tokens
     * held by `msg.sender`'s account is to be decreased.
     * @return bool indicating if the operation was successful.
     */
    function decreaseAllowance(address _spender, uint256 _subtractedValue)
        external
        returns (bool)
    {
        _approveByPartition(
            defaultPartition,
            msg.sender,
            _spender,
            _allowedByPartition[defaultPartition][msg.sender][_spender].sub(
                _subtractedValue
            )
        );
        return true;
    }

    /**************************************************************************/
    /** EXTERNAL FUNCTIONS (AMP) **********************************************/
    /**************************************************************************/

    /******************************** Swap  ***********************************/

    /**
     * @notice Exchanges an amount of source swap tokens from the contract defined at deployment
     * for the equivalent amount of Amp tokens.
     * @dev Requires the `_from` account to have granted the Amp contract an allowance of swap
     * tokens no greater than their balance.
     * @param _from Token holder whose swap tokens will be exchanged for Amp tokens.
     */
    function swap(address _from) public {
        uint256 amount = swapToken.allowance(_from, address(this));
        require(amount > 0, EC_53_INSUFFICIENT_ALLOWANCE);

        require(
            swapToken.transferFrom(_from, swapTokenGraveyard, amount),
            EC_60_SWAP_TRANSFER_FAILURE
        );

        _mint(msg.sender, _from, amount);

        emit Swap(msg.sender, _from, amount);
    }

    /**************************************************************************/
    /************************** Holder information ****************************/

    /**
     * @notice Retrieves the balance of a token holder for a specific partition.
     * @param _partition The partition for which the balance is returned.
     * @param _tokenHolder Address for which the balance is returned.
     * @return uint256 containing the amount of tokens held by `_tokenHolder` in `_partition`.
     */
    function balanceOfByPartition(bytes32 _partition, address _tokenHolder)
        external
        view
        returns (uint256)
    {
        return _balanceOfByPartition[_tokenHolder][_partition];
    }

    /**
     * @notice Retrieves the set of partitions for a particular token holder.
     * @param _tokenHolder Address for which the partitions are returned.
     * @return array containing the partitions of `_tokenHolder`.
     */
    function partitionsOf(address _tokenHolder) external view returns (bytes32[] memory) {
        return _partitionsOf[_tokenHolder];
    }

    /**************************************************************************/
    /************************** Advanced Transfers ****************************/

    /**
     * @notice Transfers tokens from a specific partition on behalf of a token
     * holder, optionally changing the partition and including
     * arbitrary data used by the partition strategies and collateral managers to authorize the
     * transfer.
     * @dev This can be used to transfer an address's own tokens, or transfer
     * a different address's tokens by specifying the `_from` param. If
     * attempting to transfer from a different address than `msg.sender`, the
     * `msg.sender` will need to be an operator or have enough allowance for the
     * `_partition` of the `_from` address.
     * @param _partition The partition from which the tokens are to be transferred.
     * @param _from Address from which the tokens are to be transferred.
     * @param _to Address to which the tokens are to be transferred.
     * @param _value Amount of tokens to be transferred.
     * @param _data Information attached to the transfer. Will contain the
     * destination partition if changing partitions.
     * @param _operatorData Additional data attached to the transfer. Used by partition strategies
     * and collateral managers to authorize the transfer.
     * @return bytes32 containing the destination partition.
     */
    function transferByPartition(
        bytes32 _partition,
        address _from,
        address _to,
        uint256 _value,
        bytes calldata _data,
        bytes calldata _operatorData
    ) external returns (bytes32) {
        return
            _transferByPartition(
                _partition,
                msg.sender,
                _from,
                _to,
                _value,
                _data,
                _operatorData
            );
    }

    /**************************************************************************/
    /************************** Operator Management ***************************/

    /**
     * @notice Authorizes an address as an operator of `msg.sender` to transfer tokens on its
     * behalf.
     * @dev Note that this applies to all partitions.
     * 
     * `msg.sender` is always an operator for itself, and does not need to
     * be explicitly added.
     * @param _operator Address to set as an operator for `msg.sender`.
     */
    function authorizeOperator(address _operator) external {
        require(_operator != msg.sender, EC_58_INVALID_OPERATOR);

        _authorizedOperator[msg.sender][_operator] = true;
        emit AuthorizedOperator(_operator, msg.sender);
    }

    /**
     * @notice Remove the right of the `_operator` address to be an operator for
     * `msg.sender` and to transfer tokens on its behalf.
     * @dev Note that this affects the account-wide authorization granted via function
     * `Amp.authorizeOperator`, and does not affect authorizations granted via function
     * `Amp.authorizeOperatorByPartition`.
     * 
     * `msg.sender` is always an operator for itself, and cannot be
     * removed.
     * @param _operator Address to be deauthorized an operator for `msg.sender`.
     */
    function revokeOperator(address _operator) external {
        require(_operator != msg.sender, EC_58_INVALID_OPERATOR);

        _authorizedOperator[msg.sender][_operator] = false;
        emit RevokedOperator(_operator, msg.sender);
    }

    /**
     * @notice Authorizes an account as an operator of a particular partition.
     * @dev The `msg.sender` is always an operator for itself, and does not need to
     * be explicitly added to a partition.
     * @param _partition The partition for which the `_operator` is to be authorized.
     * @param _operator Address to be authorized as an operator for `msg.sender`.
     */
    function authorizeOperatorByPartition(bytes32 _partition, address _operator)
        external
    {
        require(_operator != msg.sender, EC_58_INVALID_OPERATOR);

        _authorizedOperatorByPartition[msg.sender][_partition][_operator] = true;
        emit AuthorizedOperatorByPartition(_partition, _operator, msg.sender);
    }

    /**
     * @notice Deauthorizes an address as an operator for a particular partition.
     * @dev Note that this does not override an account-wide authorization granted via function
     * `Amp.authorizeOperator`.
     * 
     * `msg.sender` is always an operator for itself, and cannot be
     * removed from a partition.
     * @param _partition The partition for which the `_operator` is deauthorized.
     * @param _operator Address to deauthorize as an operator for `msg.sender`.
     */
    function revokeOperatorByPartition(bytes32 _partition, address _operator) external {
        require(_operator != msg.sender, EC_58_INVALID_OPERATOR);

        _authorizedOperatorByPartition[msg.sender][_partition][_operator] = false;
        emit RevokedOperatorByPartition(_partition, _operator, msg.sender);
    }

    /**************************************************************************/
    /************************** Operator Information **************************/
    /**
     * @notice Indicates whether the `_operator` address is an operator of the
     * `_tokenHolder` address.
     * @dev Note that this applies to all of the partitions of the `msg.sender` address.
     * @param _operator Address which may be an operator of `_tokenHolder`.
     * @param _tokenHolder Address of a token holder which may have the
     * `_operator` address as an operator.
     * @return bool indicating whether `_operator` is an operator of `_tokenHolder`.
     */
    function isOperator(address _operator, address _tokenHolder)
        external
        view
        returns (bool)
    {
        return _isOperator(_operator, _tokenHolder);
    }

    /**
     * @notice Indicate whether the `_operator` address is an operator of the
     * `_tokenHolder` address for the `_partition`.
     * @param _partition Partition for which `_operator` may be authorized.
     * @param _operator Address which may be an operator of `_tokenHolder` for the `_partition`.
     * @param _tokenHolder Address of a token holder which may have the
     * `_operator` address as an operator for the `_partition`.
     * @return bool indicating whether `_operator` is an operator of `_tokenHolder` for the
     * `_partition`.
     */
    function isOperatorForPartition(
        bytes32 _partition,
        address _operator,
        address _tokenHolder
    ) external view returns (bool) {
        return _isOperatorForPartition(_partition, _operator, _tokenHolder);
    }

    /**
     * @notice Indicates whether the `_operator` address is an operator of the
     * `_collateralManager` address for the `_partition`.
     * @dev This method is functionally identical to `Amp.isOperatorForPartition`, except that it
     * also requires the address that `_operator` is being checked for must be
     * a registered collateral manager.
     * @param _partition Partition for which the operator may be authorized.
     * @param _operator Address which may be an operator of `_collateralManager`
     * for the `_partition`.
     * @param _collateralManager Address of a collateral manager which may have
     * the `_operator` address as an operator for the `_partition`.
     * @return bool indicating whether the `_operator` address is an operator of the
     * `_collateralManager` address for the `_partition`.
     */
    function isOperatorForCollateralManager(
        bytes32 _partition,
        address _operator,
        address _collateralManager
    ) external view returns (bool) {
        return
            _isCollateralManager[_collateralManager] &&
            (_isOperator(_operator, _collateralManager) ||
                _authorizedOperatorByPartition[_collateralManager][_partition][_operator]);
    }

    /**************************************************************************/
    /***************************** Token metadata *****************************/
    /**
     * @notice Retrieves the name of the token.
     * @return string containing the name of the token. Always "Amp".
     */
    function name() external view returns (string memory) {
        return _name;
    }

    /**
     * @notice Retrieves the symbol of the token.
     * @return string containing the symbol of the token. Always "AMP".
     */
    function symbol() external view returns (string memory) {
        return _symbol;
    }

    /**
     * @notice Retrieves the number of decimals of the token.
     * @return uint8 containing the number of decimals of the token. Always 18.
     */
    function decimals() external pure returns (uint8) {
        return uint8(18);
    }

    /**
     * @notice Retrieves the smallest part of the token that is not divisible.
     * @return uint256 containing the smallest non-divisible part of the token. Always 1.
     */
    function granularity() external pure returns (uint256) {
        return _granularity;
    }

    /**
     * @notice Retrieves the set of existing partitions.
     * @return array containing all partitions.
     */
    function totalPartitions() external view returns (bytes32[] memory) {
        return _totalPartitions;
    }

    /************************************************************************************************/
    /******************************** Partition Token Allowances ************************************/
    /**
     * @notice Retrieves the allowance of tokens that has been granted by a token holder to another
     * account.
     * @param _partition Partition for which the spender may be authorized.
     * @param _owner The address which owns the tokens.
     * @param _spender The address which is authorized transfer tokens on behalf of the token
     * holder.
     * @return uint256 containing the amount of tokens available for `_spender` to transfer.
     */
    function allowanceByPartition(
        bytes32 _partition,
        address _owner,
        address _spender
    ) external view returns (uint256) {
        return _allowedByPartition[_partition][_owner][_spender];
    }

    /**
     * @notice Approves the `_spender` address to transfer the specified amount of
     * tokens in `_partition` on behalf of `msg.sender`.
     * 
     * Note that this method is subject to the race condition described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729. Functions
     * `Amp.increaseAllowanceByPartition` and `Amp.decreaseAllowanceByPartition` should be used
     * instead.
     * @param _partition Partition for which the `_spender` is to be authorized to transfer tokens.
     * @param _spender The address of the account to be authorized to transfer tokens.
     * @param _value The amount of tokens to be authorized.
     * @return bool indicating if the operation was successful.
     */
    function approveByPartition(
        bytes32 _partition,
        address _spender,
        uint256 _value
    ) external returns (bool) {
        _approveByPartition(_partition, msg.sender, _spender, _value);
        return true;
    }

    /**
     * @notice Increases the allowance granted to an account by the caller for a partition.
     * @dev This is an alternative to function `Amp.approveByPartition` that can be used as
     * a mitigation for the race condition described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     * 
     * #### Requirements:
     * - `_spender` cannot be the zero address.
     * @param _partition Partition for which the `_spender` is to be authorized to transfer tokens.
     * @param _spender The address of the account to be authorized to transfer tokens.
     * @param _addedValue Additional amount of the `msg.sender`'s tokens `_spender`
     * is allowed to transfer.
     * @return bool indicating if the operation was successful.
     */
    function increaseAllowanceByPartition(
        bytes32 _partition,
        address _spender,
        uint256 _addedValue
    ) external returns (bool) {
        _approveByPartition(
            _partition,
            msg.sender,
            _spender,
            _allowedByPartition[_partition][msg.sender][_spender].add(_addedValue)
        );
        return true;
    }

    /**
     * @notice Decreases the allowance granted to `_spender` by the
     * caller.
     * @dev This is an alternative to function `Amp.approveByPartition` that can be used as
     * a mitigation for the race condition described in
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     * 
     * #### Requirements:
     * - `_spender` cannot be the zero address.
     * - `_spender` must have allowance for the caller of at least
     * `_subtractedValue`.
     * @param _partition Partition for which `_spender`'s allowance is to be decreased.
     * @param _spender Amount by which the authorization for `_spender` to transfer tokens
     * held by `msg.sender`'s account is to be decreased.
     * @param _subtractedValue Amount of the `msg.sender`'s tokens `_spender` is
     * no longer allowed to transfer.
     * @return bool indicating if the operation was successful.
     */
    function decreaseAllowanceByPartition(
        bytes32 _partition,
        address _spender,
        uint256 _subtractedValue
    ) external returns (bool) {
        _approveByPartition(
            _partition,
            msg.sender,
            _spender,
            _allowedByPartition[_partition][msg.sender][_spender].sub(_subtractedValue)
        );
        return true;
    }

    /**************************************************************************/
    /************************ Collateral Manager Admin ************************/

    /**
     * @notice Registers `msg.sender` as a collateral manager.
     */
    function registerCollateralManager() external {
        // Short circuit a double registry
        require(!_isCollateralManager[msg.sender], EC_5C_ADDRESS_CONFLICT);

        collateralManagers.push(msg.sender);
        _isCollateralManager[msg.sender] = true;

        emit CollateralManagerRegistered(msg.sender);
    }

    /**
     * @notice Retrieves whether the supplied address is a collateral manager.
     * @param _collateralManager The address of the collateral manager.
     * @return bool indicating whether `_collateralManager` is registered as a collateral manager.
     */
    function isCollateralManager(address _collateralManager)
        external
        view
        returns (bool)
    {
        return _isCollateralManager[_collateralManager];
    }

    /**************************************************************************/
    /************************ Partition Strategy Admin ************************/
    /**
     * @notice Sets an implementation for a partition strategy identified by `_prefix`.
     * @dev Note: this function can only be called by the contract owner.
     * @param _prefix The 4 byte partition prefix the strategy applies to.
     * @param _implementation The address of the implementation of the strategy hooks.
     */
    function setPartitionStrategy(bytes4 _prefix, address _implementation) external {
        require(msg.sender == owner(), EC_56_INVALID_SENDER);
        require(!_isPartitionStrategy[_prefix], EC_5E_PARTITION_PREFIX_CONFLICT);
        require(_prefix != ZERO_PREFIX, EC_5F_INVALID_PARTITION_PREFIX_0);

        string memory iname = PartitionUtils._getPartitionStrategyValidatorIName(_prefix);

        ERC1820Client.setInterfaceImplementation(iname, _implementation);
        partitionStrategies.push(_prefix);
        _isPartitionStrategy[_prefix] = true;

        emit PartitionStrategySet(_prefix, iname, _implementation);
    }

    /**
     * @notice Return whether the `_prefix` has had a partition strategy registered.
     * @param _prefix The partition strategy identifier.
     * @return bool indicating if the strategy has been registered.
     */
    function isPartitionStrategy(bytes4 _prefix) external view returns (bool) {
        return _isPartitionStrategy[_prefix];
    }

    /**************************************************************************/
    /*************************** INTERNAL FUNCTIONS ***************************/
    /**************************************************************************/

    /**************************************************************************/
    /**************************** Token Transfers *****************************/

    /**
     * @dev Transfer tokens from a specific partition.
     * @param _fromPartition Partition of the tokens to transfer.
     * @param _operator The address performing the transfer.
     * @param _from Token holder.
     * @param _to Token recipient.
     * @param _value Number of tokens to transfer.
     * @param _data Information attached to the transfer. Contains the destination
     * partition if a partition change is requested.
     * @param _operatorData Information attached to the transfer, by the operator
     * (if any).
     * @return bytes32 containing the destination partition.
     */
    function _transferByPartition(
        bytes32 _fromPartition,
        address _operator,
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data,
        bytes memory _operatorData
    ) internal returns (bytes32) {
        require(_to != address(0), EC_57_INVALID_RECEIVER);

        // If the `_operator` is attempting to transfer from a different `_from`
        // address, first check that they have the requisite operator or
        // allowance permissions.
        if (_from != _operator) {
            require(
                _isOperatorForPartition(_fromPartition, _operator, _from) ||
                    (_value <= _allowedByPartition[_fromPartition][_from][_operator]),
                EC_53_INSUFFICIENT_ALLOWANCE
            );

            // If the sender has an allowance for the partition, that should
            // be decremented
            if (_allowedByPartition[_fromPartition][_from][_operator] >= _value) {
                _allowedByPartition[_fromPartition][_from][msg
                    .sender] = _allowedByPartition[_fromPartition][_from][_operator].sub(
                    _value
                );
            } else {
                _allowedByPartition[_fromPartition][_from][_operator] = 0;
            }
        }

        _callPreTransferHooks(
            _fromPartition,
            _operator,
            _from,
            _to,
            _value,
            _data,
            _operatorData
        );

        require(
            _balanceOfByPartition[_from][_fromPartition] >= _value,
            EC_52_INSUFFICIENT_BALANCE
        );

        bytes32 toPartition = PartitionUtils._getDestinationPartition(
            _data,
            _fromPartition
        );

        _removeTokenFromPartition(_from, _fromPartition, _value);
        _addTokenToPartition(_to, toPartition, _value);
        _callPostTransferHooks(
            toPartition,
            _operator,
            _from,
            _to,
            _value,
            _data,
            _operatorData
        );

        emit Transfer(_from, _to, _value);
        emit TransferByPartition(
            _fromPartition,
            _operator,
            _from,
            _to,
            _value,
            _data,
            _operatorData
        );

        if (toPartition != _fromPartition) {
            emit ChangedPartition(_fromPartition, toPartition, _value);
        }

        return toPartition;
    }

    /**
     * @notice Transfer tokens from default partitions.
     * @dev Used as a helper method for ERC-20 compatibility.
     * @param _operator The address performing the transfer.
     * @param _from Token holder.
     * @param _to Token recipient.
     * @param _value Number of tokens to transfer.
     * @param _data Information attached to the transfer, and intended for the
     * token holder (`_from`). Should contain the destination partition if
     * changing partitions.
     */
    function _transferByDefaultPartition(
        address _operator,
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data
    ) internal {
        _transferByPartition(defaultPartition, _operator, _from, _to, _value, _data, "");
    }

    /**
     * @dev Remove a token from a specific partition.
     * @param _from Token holder.
     * @param _partition Name of the partition.
     * @param _value Number of tokens to transfer.
     */
    function _removeTokenFromPartition(
        address _from,
        bytes32 _partition,
        uint256 _value
    ) internal {
        if (_value == 0) {
            return;
        }

        _balances[_from] = _balances[_from].sub(_value);

        _balanceOfByPartition[_from][_partition] = _balanceOfByPartition[_from][_partition]
            .sub(_value);
        totalSupplyByPartition[_partition] = totalSupplyByPartition[_partition].sub(
            _value
        );

        // If the total supply is zero, finds and deletes the partition.
        // Do not delete the _defaultPartition from totalPartitions.
        if (totalSupplyByPartition[_partition] == 0 && _partition != defaultPartition) {
            _removePartitionFromTotalPartitions(_partition);
        }

        // If the balance of the TokenHolder's partition is zero, finds and
        // deletes the partition.
        if (_balanceOfByPartition[_from][_partition] == 0) {
            uint256 index = _indexOfPartitionsOf[_from][_partition];

            if (index == 0) {
                return;
            }

            // move the last item into the index being vacated
            bytes32 lastValue = _partitionsOf[_from][_partitionsOf[_from].length - 1];
            _partitionsOf[_from][index - 1] = lastValue; // adjust for 1-based indexing
            _indexOfPartitionsOf[_from][lastValue] = index;

            _partitionsOf[_from].pop();
            _indexOfPartitionsOf[_from][_partition] = 0;
        }
    }

    /**
     * @dev Add a token to a specific partition.
     * @param _to Token recipient.
     * @param _partition Name of the partition.
     * @param _value Number of tokens to transfer.
     */
    function _addTokenToPartition(
        address _to,
        bytes32 _partition,
        uint256 _value
    ) internal {
        if (_value == 0) {
            return;
        }

        _balances[_to] = _balances[_to].add(_value);

        if (_indexOfPartitionsOf[_to][_partition] == 0) {
            _partitionsOf[_to].push(_partition);
            _indexOfPartitionsOf[_to][_partition] = _partitionsOf[_to].length;
        }
        _balanceOfByPartition[_to][_partition] = _balanceOfByPartition[_to][_partition]
            .add(_value);

        if (_indexOfTotalPartitions[_partition] == 0) {
            _addPartitionToTotalPartitions(_partition);
        }
        totalSupplyByPartition[_partition] = totalSupplyByPartition[_partition].add(
            _value
        );
    }

    /**
     * @dev Add a partition to the total partitions collection.
     * @param _partition Name of the partition.
     */
    function _addPartitionToTotalPartitions(bytes32 _partition) internal {
        _totalPartitions.push(_partition);
        _indexOfTotalPartitions[_partition] = _totalPartitions.length;
    }

    /**
     * @dev Remove a partition to the total partitions collection.
     * @param _partition Name of the partition.
     */
    function _removePartitionFromTotalPartitions(bytes32 _partition) internal {
        uint256 index = _indexOfTotalPartitions[_partition];

        if (index == 0) {
            return;
        }

        // move the last item into the index being vacated
        bytes32 lastValue = _totalPartitions[_totalPartitions.length - 1];
        _totalPartitions[index - 1] = lastValue; // adjust for 1-based indexing
        _indexOfTotalPartitions[lastValue] = index;

        _totalPartitions.pop();
        _indexOfTotalPartitions[_partition] = 0;
    }

    /**************************************************************************/
    /********************************* Hooks **********************************/
    /**
     * @notice Check for and call the `AmpTokensSender` hook on the sender address
     * (`_from`), and, if `_fromPartition` is within the scope of a strategy,
     * check for and call the `AmpPartitionStrategy.tokensFromPartitionToTransfer`
     * hook for the strategy.
     * @param _fromPartition Name of the partition to transfer tokens from.
     * @param _operator Address which triggered the balance decrease (through
     * transfer).
     * @param _from Token holder.
     * @param _to Token recipient for a transfer.
     * @param _value Number of tokens the token holder balance is decreased by.
     * @param _data Extra information, pertaining to the `_from` address.
     * @param _operatorData Extra information, attached by the operator (if any).
     */
    function _callPreTransferHooks(
        bytes32 _fromPartition,
        address _operator,
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data,
        bytes memory _operatorData
    ) internal {
        address senderImplementation;
        senderImplementation = interfaceAddr(_from, AMP_TOKENS_SENDER);
        if (senderImplementation != address(0)) {
            IAmpTokensSender(senderImplementation).tokensToTransfer(
                msg.sig,
                _fromPartition,
                _operator,
                _from,
                _to,
                _value,
                _data,
                _operatorData
            );
        }

        // Used to ensure that hooks implemented by a collateral manager to validate
        // transfers from it's owned partitions are called
        bytes4 fromPartitionPrefix = PartitionUtils._getPartitionPrefix(_fromPartition);
        if (_isPartitionStrategy[fromPartitionPrefix]) {
            address fromPartitionValidatorImplementation;
            fromPartitionValidatorImplementation = interfaceAddr(
                address(this),
                PartitionUtils._getPartitionStrategyValidatorIName(fromPartitionPrefix)
            );
            if (fromPartitionValidatorImplementation != address(0)) {
                IAmpPartitionStrategyValidator(fromPartitionValidatorImplementation)
                    .tokensFromPartitionToValidate(
                    msg.sig,
                    _fromPartition,
                    _operator,
                    _from,
                    _to,
                    _value,
                    _data,
                    _operatorData
                );
            }
        }
    }

    /**
     * @dev Check for `AmpTokensRecipient` hook on the recipient and call it.
     * @param _toPartition Name of the partition the tokens were transferred to.
     * @param _operator Address which triggered the balance increase (through
     * transfer or mint).
     * @param _from Token holder for a transfer (0x when mint).
     * @param _to Token recipient.
     * @param _value Number of tokens the recipient balance is increased by.
     * @param _data Extra information related to the token holder (`_from`).
     * @param _operatorData Extra information attached by the operator (if any).
     */
    function _callPostTransferHooks(
        bytes32 _toPartition,
        address _operator,
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data,
        bytes memory _operatorData
    ) internal {
        bytes4 toPartitionPrefix = PartitionUtils._getPartitionPrefix(_toPartition);
        if (_isPartitionStrategy[toPartitionPrefix]) {
            address partitionManagerImplementation;
            partitionManagerImplementation = interfaceAddr(
                address(this),
                PartitionUtils._getPartitionStrategyValidatorIName(toPartitionPrefix)
            );
            if (partitionManagerImplementation != address(0)) {
                IAmpPartitionStrategyValidator(partitionManagerImplementation)
                    .tokensToPartitionToValidate(
                    msg.sig,
                    _toPartition,
                    _operator,
                    _from,
                    _to,
                    _value,
                    _data,
                    _operatorData
                );
            }
        } else {
            require(toPartitionPrefix == ZERO_PREFIX, EC_5D_PARTITION_RESERVED);
        }

        address recipientImplementation;
        recipientImplementation = interfaceAddr(_to, AMP_TOKENS_RECIPIENT);

        if (recipientImplementation != address(0)) {
            IAmpTokensRecipient(recipientImplementation).tokensReceived(
                msg.sig,
                _toPartition,
                _operator,
                _from,
                _to,
                _value,
                _data,
                _operatorData
            );
        }
    }

    /**************************************************************************/
    /******************************* Allowance ********************************/
    /**
     * @notice Approve the `_spender` address to spend the specified amount of
     * tokens in `_partition` on behalf of `msg.sender`.
     * @param _partition Name of the partition.
     * @param _tokenHolder Owner of the tokens.
     * @param _spender The address which may spend the tokens.
     * @param _amount The amount of tokens available to be spent.
     */
    function _approveByPartition(
        bytes32 _partition,
        address _tokenHolder,
        address _spender,
        uint256 _amount
    ) internal {
        require(_tokenHolder != address(0), EC_56_INVALID_SENDER);
        require(_spender != address(0), EC_58_INVALID_OPERATOR);

        _allowedByPartition[_partition][_tokenHolder][_spender] = _amount;
        emit ApprovalByPartition(_partition, _tokenHolder, _spender, _amount);

        if (_partition == defaultPartition) {
            emit Approval(_tokenHolder, _spender, _amount);
        }
    }

    /**************************************************************************/
    /************************** Operator Information **************************/
    /**
     * @dev Indicate whether the operator address is an operator of the
     * tokenHolder address. An operator in this case is an operator across all
     * partitions of the `msg.sender` address.
     * @param _operator Address which may be an operator of `_tokenHolder`.
     * @param _tokenHolder Address of a token holder which may have the `_operator`
     * address as an operator.
     * @return bool indicating whether `_operator` is an operator of `_tokenHolder`
     */
    function _isOperator(address _operator, address _tokenHolder)
        internal
        view
        returns (bool)
    {
        return (_operator == _tokenHolder ||
            _authorizedOperator[_tokenHolder][_operator]);
    }

    /**
     * @dev Indicate whether the operator address is an operator of the
     * tokenHolder address for the given partition.
     * @param _partition Name of the partition.
     * @param _operator Address which may be an operator of tokenHolder for the
     * `_partition`.
     * @param _tokenHolder Address of a token holder which may have the operator
     * address as an operator for the `_partition`.
     * @return bool indicating whether `_operator` is an operator of `_tokenHolder` for the
     * `_partition`.
     */
    function _isOperatorForPartition(
        bytes32 _partition,
        address _operator,
        address _tokenHolder
    ) internal view returns (bool) {
        return (_isOperator(_operator, _tokenHolder) ||
            _authorizedOperatorByPartition[_tokenHolder][_partition][_operator] ||
            _callPartitionStrategyOperatorHook(_partition, _operator, _tokenHolder));
    }

    /**
     * @notice Check if the `_partition` is within the scope of a strategy, and
     * call it's isOperatorForPartitionScope hook if so.
     * @dev This allows implicit granting of operatorByPartition permissions
     * based on the partition being used being of a strategy.
     * @param _partition The partition to check.
     * @param _operator The address to check if is an operator for `_tokenHolder`.
     * @param _tokenHolder The address to validate that `_operator` is an
     * operator for.
     */
    function _callPartitionStrategyOperatorHook(
        bytes32 _partition,
        address _operator,
        address _tokenHolder
    ) internal view returns (bool) {
        bytes4 prefix = PartitionUtils._getPartitionPrefix(_partition);

        if (!_isPartitionStrategy[prefix]) {
            return false;
        }

        address strategyValidatorImplementation;
        strategyValidatorImplementation = interfaceAddr(
            address(this),
            PartitionUtils._getPartitionStrategyValidatorIName(prefix)
        );
        if (strategyValidatorImplementation != address(0)) {
            return
                IAmpPartitionStrategyValidator(strategyValidatorImplementation)
                    .isOperatorForPartitionScope(_partition, _operator, _tokenHolder);
        }

        // Not a partition format that imbues special operator rules
        return false;
    }

    /**************************************************************************/
    /******************************** Minting *********************************/
    /**
     * @notice Perform the minting of tokens.
     * @dev The tokens will be minted on behalf of the `_to` address, and will be
     * minted to the address's default partition.
     * @param _operator Address which triggered the issuance.
     * @param _to Token recipient.
     * @param _value Number of tokens issued.
     */
    function _mint(
        address _operator,
        address _to,
        uint256 _value
    ) internal {
        require(_to != address(0), EC_57_INVALID_RECEIVER);

        _totalSupply = _totalSupply.add(_value);
        _addTokenToPartition(_to, defaultPartition, _value);
        _callPostTransferHooks(
            defaultPartition,
            _operator,
            address(0),
            _to,
            _value,
            "",
            ""
        );

        emit Minted(_operator, _to, _value, "");
        emit Transfer(address(0), _to, _value);
        emit TransferByPartition(bytes32(0), _operator, address(0), _to, _value, "", "");
    }
}
