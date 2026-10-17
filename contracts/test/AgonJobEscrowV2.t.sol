// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonJobEscrowV2 } from "../src/AgonJobEscrowV2.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

contract AgonJobV2Identity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonJobEscrowV2Test is Test {
    AgonJobV2Identity internal identity;
    AgonProfileRegistry internal profiles;
    AgonServiceRegistry internal services;
    AgonJobEscrowV2 internal escrow;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal buyer = makeAddr("buyer");
    address internal provider = makeAddr("provider");
    address internal resolver = makeAddr("resolver");
    address internal treasury = makeAddr("treasury");
    uint256 internal constant AMOUNT = 100e6;
    bytes32 internal constant TERMS_HASH = keccak256("terms-v1");
    bytes32 internal constant DELIVERABLE_HASH = keccak256("deliverable-v1");

    function setUp() public {
        identity = new AgonJobV2Identity();
        profiles = new AgonProfileRegistry(admin, address(identity));
        services = new AgonServiceRegistry(admin, address(profiles));
        usdc = new MockUSDC();
        escrow = new AgonJobEscrowV2(admin, address(usdc), address(services), resolver, treasury, 35, 500);

        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://profile");
        vm.prank(provider);
        services.publish(
            42,
            keccak256("secure-review"),
            keccak256("manifest-v1"),
            "ipfs://manifest-v1",
            1,
            AgonServiceRegistry.PaymentRail.Escrow
        );
        vm.startPrank(admin);
        services.grantRole(services.VERIFIER_ROLE(), admin);
        services.setVerification(1, AgonServiceRegistry.Verification.Verified);
        vm.stopPrank();

        usdc.mint(buyer, 1000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _create(bytes32 clientRef) internal returns (uint256 jobId) {
        vm.prank(buyer);
        return escrow.createJob(clientRef, 1, TERMS_HASH, AMOUNT, 0);
    }

    function test_constructorPinsFivePercentAndRejectsFeeAboveCap() public {
        assertEq(escrow.protocolFeeBps(), 500);
        assertEq(escrow.MAX_PROTOCOL_FEE_BPS(), 1000);

        vm.expectRevert(AgonJobEscrowV2.FeeAboveMaximum.selector);
        new AgonJobEscrowV2(admin, address(usdc), address(services), resolver, treasury, 35, 1001);
    }

    function test_feeChangeRequiresAdminAndTimelock() public {
        vm.prank(buyer);
        vm.expectRevert();
        escrow.scheduleProtocolFeeChange(250);

        vm.prank(admin);
        escrow.scheduleProtocolFeeChange(250);
        assertEq(escrow.protocolFeeBps(), 500);
        assertEq(escrow.pendingProtocolFeeBps(), 250);

        vm.expectRevert(AgonJobEscrowV2.FeeChangeTimelocked.selector);
        escrow.applyProtocolFeeChange();

        vm.warp(block.timestamp + escrow.PROTOCOL_FEE_CHANGE_DELAY());
        vm.expectEmit(false, false, false, true, address(escrow));
        emit AgonJobEscrowV2.ProtocolFeeChanged(500, 250);
        escrow.applyProtocolFeeChange();
        assertEq(escrow.protocolFeeBps(), 250);
        assertEq(escrow.pendingProtocolFeeEffectiveAt(), 0);
    }

    function test_feeChangeCanBeCancelledAndCannotExceedCap() public {
        vm.prank(admin);
        vm.expectRevert(AgonJobEscrowV2.FeeAboveMaximum.selector);
        escrow.scheduleProtocolFeeChange(1001);

        vm.prank(admin);
        escrow.scheduleProtocolFeeChange(250);
        vm.prank(admin);
        escrow.cancelProtocolFeeChange();

        vm.expectRevert(AgonJobEscrowV2.NoPendingFeeChange.selector);
        escrow.applyProtocolFeeChange();
        assertEq(escrow.protocolFeeBps(), 500);
    }

    function test_jobsSnapshotFeeRateAcrossGovernanceChanges() public {
        uint256 firstJobId = _create(keccak256("client-reference-1"));
        AgonJobEscrowV2.Job memory firstJob = escrow.getJob(firstJobId);
        assertEq(firstJob.feeBps, 500);
        assertEq(firstJob.fee, 5e6);

        vm.prank(admin);
        escrow.scheduleProtocolFeeChange(250);
        vm.warp(block.timestamp + escrow.PROTOCOL_FEE_CHANGE_DELAY());
        escrow.applyProtocolFeeChange();

        uint256 secondJobId = _create(keccak256("client-reference-2"));
        AgonJobEscrowV2.Job memory secondJob = escrow.getJob(secondJobId);
        firstJob = escrow.getJob(firstJobId);

        assertEq(firstJob.feeBps, 500);
        assertEq(firstJob.fee, 5e6);
        assertEq(secondJob.feeBps, 250);
        assertEq(secondJob.fee, 2.5e6);
        assertEq(escrow.escrowedAmount(firstJobId), 105e6);
        assertEq(escrow.escrowedAmount(secondJobId), 102.5e6);
    }

    function test_existingLifecycleStillPaysProviderAndTreasury() public {
        uint256 jobId = _create(keccak256("lifecycle-reference"));
        vm.prank(provider);
        escrow.acceptJob(jobId);
        vm.prank(provider);
        escrow.submitJob(jobId, DELIVERABLE_HASH);
        vm.prank(buyer);
        escrow.acceptSubmission(jobId);

        AgonJobEscrowV2.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgonJobEscrowV2.Status.Complete));
        assertEq(uint8(job.settlement), uint8(AgonJobEscrowV2.Settlement.ProviderPaid));
        assertEq(usdc.balanceOf(provider), AMOUNT);
        assertEq(usdc.balanceOf(treasury), 5e6);
        assertEq(escrow.escrowedAmount(jobId), 0);
    }

    bytes32 internal constant REASON_HASH = keccak256("reason-v1");

    function _submitted(bytes32 clientRef) internal returns (uint256 jobId) {
        jobId = _create(clientRef);
        vm.prank(provider);
        escrow.acceptJob(jobId);
        vm.prank(provider);
        escrow.submitJob(jobId, DELIVERABLE_HASH);
    }

    function _rejected(bytes32 clientRef) internal returns (uint256 jobId) {
        jobId = _submitted(clientRef);
        vm.prank(buyer);
        escrow.rejectSubmission(jobId, REASON_HASH);
    }

    function _disputed(bytes32 clientRef) internal returns (uint256 jobId) {
        jobId = _rejected(clientRef);
        vm.prank(provider);
        escrow.openDispute(jobId, REASON_HASH);
    }

    function test_buyerRefundAfterRejectionWindowReturnsAmountAndFee() public {
        uint256 jobId = _rejected(keccak256("reject-refund"));
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + escrow.REJECTION_WINDOW() + 1);
        vm.prank(provider);
        vm.expectRevert(AgonJobEscrowV2.NotBuyer.selector);
        escrow.claimRefundAfterRejection(jobId);

        vm.prank(buyer);
        escrow.claimRefundAfterRejection(jobId);

        AgonJobEscrowV2.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgonJobEscrowV2.Status.Failed));
        assertEq(uint8(job.settlement), uint8(AgonJobEscrowV2.Settlement.BuyerRefunded));
        assertEq(usdc.balanceOf(buyer), before + AMOUNT + 5e6);
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.escrowedAmount(jobId), 0);

        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.InvalidStatus.selector);
        escrow.claimRefundAfterRejection(jobId);
    }

    function test_refundBeforeRejectionWindowReverts() public {
        uint256 jobId = _rejected(keccak256("reject-early"));
        vm.warp(block.timestamp + escrow.REJECTION_WINDOW());
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.RejectionWindowOpen.selector);
        escrow.claimRefundAfterRejection(jobId);
    }

    function test_disputeMustOpenInsideRejectionWindow() public {
        uint256 jobId = _rejected(keccak256("reject-late-dispute"));
        vm.warp(block.timestamp + escrow.REJECTION_WINDOW() + 1);
        vm.prank(provider);
        vm.expectRevert(AgonJobEscrowV2.RejectionWindowClosed.selector);
        escrow.openDispute(jobId, REASON_HASH);
    }

    function test_refundAfterRejectionNotAvailableOnceDisputed() public {
        uint256 jobId = _disputed(keccak256("disputed-no-reject-refund"));
        vm.warp(block.timestamp + escrow.REJECTION_WINDOW() + 1);
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.InvalidStatus.selector);
        escrow.claimRefundAfterRejection(jobId);
    }

    function test_staleDisputeExitRefundsBuyerForEitherParty() public {
        uint256 jobA = _disputed(keccak256("stale-a"));
        uint256 jobB = _disputed(keccak256("stale-b"));
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + escrow.RESOLVER_WINDOW());
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.ResolverWindowOpen.selector);
        escrow.exitStaleDispute(jobA);

        vm.warp(block.timestamp + 1);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(AgonJobEscrowV2.NotParty.selector);
        escrow.exitStaleDispute(jobA);

        vm.prank(buyer);
        escrow.exitStaleDispute(jobA);
        vm.prank(provider);
        escrow.exitStaleDispute(jobB);

        assertEq(usdc.balanceOf(buyer), before + 2 * (AMOUNT + 5e6));
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getJob(jobA).settlement), uint8(AgonJobEscrowV2.Settlement.BuyerRefunded));

        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.InvalidStatus.selector);
        escrow.exitStaleDispute(jobA);
        vm.prank(resolver);
        vm.expectRevert(AgonJobEscrowV2.InvalidStatus.selector);
        escrow.resolveDispute(jobB, true);
    }

    function test_resolverStillSettlesInsideWindowAndNotAfter() public {
        uint256 jobA = _disputed(keccak256("resolve-inside"));
        uint256 jobB = _disputed(keccak256("resolve-late"));

        vm.warp(block.timestamp + escrow.RESOLVER_WINDOW());
        vm.prank(resolver);
        escrow.resolveDispute(jobA, true);
        assertEq(usdc.balanceOf(provider), AMOUNT);
        assertEq(usdc.balanceOf(treasury), 5e6);

        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrowV2.InvalidStatus.selector);
        escrow.exitStaleDispute(jobA);

        vm.warp(block.timestamp + 1);
        vm.prank(resolver);
        vm.expectRevert(AgonJobEscrowV2.ResolverWindowClosed.selector);
        escrow.resolveDispute(jobB, true);
    }
}
