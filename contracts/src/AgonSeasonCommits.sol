// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Time-stamps merkle roots of Playground season forecasts.
/// @dev Holds no funds and stores nothing. The block that carries a
///      RootCommitted event proves the committed forecasts existed by then.
///      Anyone may commit roots of their own forecasts; scorers use the
///      earliest event for a given root.
contract AgonSeasonCommits {
    error ZeroRoot();
    error ZeroCount();

    event RootCommitted(
        uint256 indexed seasonId, uint64 indexed round, address indexed committer, bytes32 root, uint32 count
    );

    function commitRoot(uint256 seasonId, uint64 round, bytes32 root, uint32 count) external {
        if (root == bytes32(0)) revert ZeroRoot();
        if (count == 0) revert ZeroCount();
        emit RootCommitted(seasonId, round, msg.sender, root, count);
    }
}
