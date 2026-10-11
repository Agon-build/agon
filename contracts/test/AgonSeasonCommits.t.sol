// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { AgonSeasonCommits } from "../src/AgonSeasonCommits.sol";

contract AgonSeasonCommitsTest is Test {
    AgonSeasonCommits internal commits;
    address internal agonCommitter = makeAddr("agonCommitter");
    address internal outsideAgent = makeAddr("outsideAgent");
    bytes32 internal root = keccak256("round-root");

    event RootCommitted(
        uint256 indexed seasonId, uint64 indexed round, address indexed committer, bytes32 root, uint32 count
    );

    function setUp() public {
        commits = new AgonSeasonCommits();
    }

    function test_emitsRootCommittedWithCommitter() public {
        vm.expectEmit(true, true, true, true, address(commits));
        emit RootCommitted(1, 7, agonCommitter, root, 42);
        vm.prank(agonCommitter);
        commits.commitRoot(1, 7, root, 42);
    }

    function test_anyAddressMayCommitItsOwnRoot() public {
        vm.expectEmit(true, true, true, true, address(commits));
        emit RootCommitted(1, 7, outsideAgent, root, 3);
        vm.prank(outsideAgent);
        commits.commitRoot(1, 7, root, 3);
    }

    function test_rejectsZeroRoot() public {
        vm.expectRevert(AgonSeasonCommits.ZeroRoot.selector);
        commits.commitRoot(1, 7, bytes32(0), 1);
    }

    function test_rejectsZeroCount() public {
        vm.expectRevert(AgonSeasonCommits.ZeroCount.selector);
        commits.commitRoot(1, 7, root, 0);
    }

    function test_rejectsValue() public {
        vm.deal(agonCommitter, 1 ether);
        vm.prank(agonCommitter);
        (bool ok,) = address(commits).call{ value: 1 }(abi.encodeCall(AgonSeasonCommits.commitRoot, (1, 7, root, 1)));
        assertFalse(ok);
        assertEq(address(commits).balance, 0);
    }

    function test_rejectsPlainTransfers() public {
        vm.deal(agonCommitter, 1 ether);
        vm.prank(agonCommitter);
        (bool ok,) = address(commits).call{ value: 1 }("");
        assertFalse(ok);
    }

    function test_commitIsCheap() public {
        uint256 before = gasleft();
        commits.commitRoot(1, 7, root, 42);
        assertLt(before - gasleft(), 15_000);
    }
}
