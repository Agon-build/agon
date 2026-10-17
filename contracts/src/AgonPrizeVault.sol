// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title AgonPrizeVault
/// @notice Holds Arena and syndicate prize pools and settles immutable
///         contribution-weighted Merkle claims through pull payments.
contract AgonPrizeVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_OPERATOR_ROLE = keccak256("POOL_OPERATOR_ROLE");
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 1000;
    /// @notice Time after funding in which the operator must publish a payout root.
    /// @dev After it passes with no root, anyone can return the principal to the sponsor.
    ///      Paused time does not count toward it.
    uint64 public constant ROOT_PUBLISH_WINDOW = 30 days;

    enum PoolKind {
        Arena,
        Syndicate
    }

    enum State {
        Funded,
        RootPublished,
        Closed
    }

    struct Pool {
        bytes32 poolKey;
        PoolKind kind;
        uint256 sourceId;
        address sponsor;
        uint256 principal;
        uint256 fee;
        bytes32 payoutRoot;
        uint256 payoutTotal;
        uint256 claimedTotal;
        uint64 claimDeadline;
        State state;
    }

    IERC20 public immutable usdc;
    address public treasury;
    mapping(bytes32 => Pool) private _pools;
    mapping(bytes32 => mapping(uint256 => uint256)) private _claimedBitmap;
    /// @notice When each pool was funded. Kept outside Pool so getPool stays ABI stable.
    mapping(bytes32 => uint64) public fundedAt;
    /// @dev Paused seconds counted at funding and at root publication. A pool's
    ///      deadlines move forward by the paused time that accrued after these marks.
    mapping(bytes32 => uint256) private _pausedMarkAtFunding;
    mapping(bytes32 => uint256) private _pausedMarkAtPublish;
    uint256 private _pausedSecondsTotal;
    uint64 private _pausedSince;

    event PoolFunded(
        bytes32 indexed poolKey,
        PoolKind indexed kind,
        uint256 indexed sourceId,
        address sponsor,
        uint256 principal,
        uint256 fee
    );
    event PayoutRootPublished(
        bytes32 indexed poolKey, bytes32 indexed payoutRoot, uint256 payoutTotal, uint64 claimDeadline
    );
    event PrizeClaimed(bytes32 indexed poolKey, uint256 indexed index, address indexed beneficiary, uint256 amount);
    event PoolRefunded(bytes32 indexed poolKey, address indexed sponsor, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event UnpublishedPoolRefunded(bytes32 indexed poolKey, address indexed sponsor, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroHash();
    error InvalidFee();
    error PoolAlreadyExists();
    error PoolMissing();
    error InvalidState();
    error InvalidRoot();
    error PayoutExceedsPrincipal();
    error ClaimWindowClosed();
    error AlreadyClaimed();
    error InvalidProof();
    error RefundWindowOpen();
    error SponsorMustBeCaller();
    error RootPublishWindowOpen();
    error RootPublishWindowClosed();

    constructor(address admin, address usdcAddress, address treasuryAddress) {
        if (admin == address(0) || usdcAddress == address(0) || treasuryAddress == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POOL_OPERATOR_ROLE, admin);
        usdc = IERC20(usdcAddress);
        treasury = treasuryAddress;
    }

    /// @notice Fund a pool from the caller's own balance.
    /// @dev The sponsor must be msg.sender. A standing approval to the vault can
    ///      never be spent by anyone else, so one approval cannot be charged twice.
    ///      The caller still needs POOL_OPERATOR_ROLE.
    function createPool(
        bytes32 poolKey,
        PoolKind kind,
        uint256 sourceId,
        address sponsor,
        uint256 principal,
        uint16 feeBps
    ) external onlyRole(POOL_OPERATOR_ROLE) whenNotPaused {
        if (poolKey == bytes32(0)) revert ZeroHash();
        if (sponsor == address(0)) revert ZeroAddress();
        if (sponsor != msg.sender) revert SponsorMustBeCaller();
        if (principal == 0) revert ZeroAmount();
        if (feeBps > MAX_FEE_BPS) revert InvalidFee();
        if (_pools[poolKey].poolKey != bytes32(0)) revert PoolAlreadyExists();
        uint256 fee = (principal * uint256(feeBps)) / BPS;
        _pools[poolKey] = Pool({
            poolKey: poolKey,
            kind: kind,
            sourceId: sourceId,
            sponsor: sponsor,
            principal: principal,
            fee: fee,
            payoutRoot: bytes32(0),
            payoutTotal: 0,
            claimedTotal: 0,
            claimDeadline: 0,
            state: State.Funded
        });
        fundedAt[poolKey] = uint64(block.timestamp);
        _pausedMarkAtFunding[poolKey] = _pausedSecondsNow();
        usdc.safeTransferFrom(sponsor, address(this), principal + fee);
        if (fee != 0) usdc.safeTransfer(treasury, fee);
        emit PoolFunded(poolKey, kind, sourceId, sponsor, principal, fee);
    }

    function publishPayoutRoot(bytes32 poolKey, bytes32 payoutRoot, uint256 payoutTotal, uint64 claimDeadline)
        external
        onlyRole(POOL_OPERATOR_ROLE)
        whenNotPaused
    {
        Pool storage pool = _pool(poolKey);
        if (pool.state != State.Funded) revert InvalidState();
        if (block.timestamp > rootPublishDeadline(poolKey)) revert RootPublishWindowClosed();
        if (payoutRoot == bytes32(0) || payoutTotal == 0) revert InvalidRoot();
        if (payoutTotal > pool.principal) revert PayoutExceedsPrincipal();
        if (claimDeadline <= block.timestamp) revert ClaimWindowClosed();
        pool.payoutRoot = payoutRoot;
        pool.payoutTotal = payoutTotal;
        pool.claimDeadline = claimDeadline;
        pool.state = State.RootPublished;
        _pausedMarkAtPublish[poolKey] = _pausedSecondsNow();
        emit PayoutRootPublished(poolKey, payoutRoot, payoutTotal, claimDeadline);
    }

    function claim(bytes32 poolKey, uint256 index, address beneficiary, uint256 amount, bytes32[] calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        Pool storage pool = _pool(poolKey);
        if (pool.state != State.RootPublished) revert InvalidState();
        if (block.timestamp > effectiveClaimDeadline(poolKey)) revert ClaimWindowClosed();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_isClaimed(poolKey, index)) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, beneficiary, amount))));
        if (!MerkleProof.verify(proof, pool.payoutRoot, leaf)) revert InvalidProof();
        if (pool.claimedTotal + amount > pool.payoutTotal) revert PayoutExceedsPrincipal();
        _setClaimed(poolKey, index);
        pool.claimedTotal += amount;
        usdc.safeTransfer(beneficiary, amount);
        emit PrizeClaimed(poolKey, index, beneficiary, amount);
    }

    function refundRemaining(bytes32 poolKey) external onlyRole(POOL_OPERATOR_ROLE) nonReentrant {
        Pool storage pool = _pool(poolKey);
        if (pool.state != State.RootPublished) revert InvalidState();
        if (pool.claimedTotal != pool.payoutTotal && block.timestamp < effectiveClaimDeadline(poolKey)) {
            revert RefundWindowOpen();
        }
        uint256 remaining = pool.principal - pool.claimedTotal;
        pool.state = State.Closed;
        if (remaining != 0) usdc.safeTransfer(pool.sponsor, remaining);
        emit PoolRefunded(poolKey, pool.sponsor, remaining);
    }

    /// @notice Return the principal of a pool whose root was never published.
    /// @dev Anyone may call. Funds only go to the sponsor. The fee already went
    ///      to the treasury at funding and is not part of this refund.
    function refundUnpublished(bytes32 poolKey) external nonReentrant {
        Pool storage pool = _pool(poolKey);
        if (pool.state != State.Funded) revert InvalidState();
        if (block.timestamp <= rootPublishDeadline(poolKey)) revert RootPublishWindowOpen();
        uint256 amount = pool.principal;
        pool.state = State.Closed;
        usdc.safeTransfer(pool.sponsor, amount);
        emit UnpublishedPoolRefunded(poolKey, pool.sponsor, amount);
    }

    /// @notice Pausing stops the clock on root publication and claim windows.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        _pausedSince = uint64(block.timestamp);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        _pausedSecondsTotal += block.timestamp - _pausedSince;
        _pausedSince = 0;
    }

    /// @notice Last moment a payout root can be published, moved out by paused time.
    function rootPublishDeadline(bytes32 poolKey) public view returns (uint256) {
        _pool(poolKey);
        return uint256(fundedAt[poolKey]) + ROOT_PUBLISH_WINDOW + _pausedSecondsNow()
            - _pausedMarkAtFunding[poolKey];
    }

    /// @notice Claim deadline moved out by any pause after the root was published.
    /// @dev A pause that starts after the deadline also moves it. That only gives
    ///      claimants more time and delays the sponsor refund by the same amount.
    function effectiveClaimDeadline(bytes32 poolKey) public view returns (uint256) {
        Pool storage pool = _pool(poolKey);
        if (pool.state == State.Funded) return 0;
        return uint256(pool.claimDeadline) + _pausedSecondsNow() - _pausedMarkAtPublish[poolKey];
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function getPool(bytes32 poolKey) external view returns (Pool memory) {
        return _pool(poolKey);
    }

    function isClaimed(bytes32 poolKey, uint256 index) external view returns (bool) {
        return _isClaimed(poolKey, index);
    }

    function _pool(bytes32 poolKey) private view returns (Pool storage pool) {
        pool = _pools[poolKey];
        if (pool.poolKey == bytes32(0)) revert PoolMissing();
    }

    function _pausedSecondsNow() private view returns (uint256) {
        if (paused()) return _pausedSecondsTotal + (block.timestamp - _pausedSince);
        return _pausedSecondsTotal;
    }

    function _isClaimed(bytes32 poolKey, uint256 index) private view returns (bool) {
        return (_claimedBitmap[poolKey][index / 256] & (uint256(1) << (index % 256))) != 0;
    }

    function _setClaimed(bytes32 poolKey, uint256 index) private {
        _claimedBitmap[poolKey][index / 256] |= uint256(1) << (index % 256);
    }
}
