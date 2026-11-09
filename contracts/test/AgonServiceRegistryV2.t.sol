// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistryV2 } from "../src/AgonServiceRegistryV2.sol";
import { AgonArenaV2 } from "../src/AgonArenaV2.sol";

contract AgonServiceIdentityV2 is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonServiceRegistryV2Test is Test {
    AgonServiceIdentityV2 internal identity;
    AgonProfileRegistry internal profiles;
    AgonServiceRegistryV2 internal services;
    address internal admin = makeAddr("admin");
    address internal provider = makeAddr("provider");
    address internal stranger = makeAddr("stranger");
    bytes32 internal serviceKey = keccak256("secure-review");
    bytes32 internal manifestV1 = keccak256("manifest-v1");

    function setUp() public {
        identity = new AgonServiceIdentityV2();
        profiles = new AgonProfileRegistry(admin, address(identity));
        services = new AgonServiceRegistryV2(admin, address(profiles), admin);
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://profile");
    }

    function _publish() internal returns (uint256) {
        vm.prank(provider);
        return
            services.publish(
                42, serviceKey, manifestV1, "ipfs://manifest-v1", 1, AgonServiceRegistryV2.PaymentRail.X402
            );
    }

    function test_reportsVersionScopedVerificationSupport() public view {
        assertTrue(services.verificationScopeSupported());
        assertTrue(services.hasRole(services.VERIFIER_ROLE(), admin));
    }

    function test_constructorRequiresEveryAuthorityAddress() public {
        vm.expectRevert(AgonServiceRegistryV2.InvalidAddress.selector);
        new AgonServiceRegistryV2(address(0), address(profiles), admin);
        vm.expectRevert(AgonServiceRegistryV2.InvalidAddress.selector);
        new AgonServiceRegistryV2(admin, address(profiles), address(0));
    }

    function test_verifiesOnlyTheExactCurrentVersionAndHash() public {
        uint256 id = _publish();

        vm.expectEmit(true, true, false, true, address(services));
        emit AgonServiceRegistryV2.ListingVerificationChanged(id, admin, AgonServiceRegistryV2.Verification.Verified);
        vm.prank(admin);
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);

        assertEq(uint8(services.getListing(id).verification), uint8(AgonServiceRegistryV2.Verification.Verified));
    }

    function test_refusesStaleVersionOrManifestScope() public {
        uint256 id = _publish();

        vm.startPrank(admin);
        vm.expectRevert(AgonServiceRegistryV2.VerificationScopeChanged.selector);
        services.setVerificationForVersion(id, 2, manifestV1, AgonServiceRegistryV2.Verification.Verified);
        vm.expectRevert(AgonServiceRegistryV2.VerificationScopeChanged.selector);
        services.setVerificationForVersion(
            id, 1, keccak256("wrong-manifest"), AgonServiceRegistryV2.Verification.Verified
        );
        vm.stopPrank();
    }

    function test_refusesPromotionAfterProviderSuspendsListing() public {
        uint256 id = _publish();
        vm.prank(provider);
        services.setStatus(id, AgonServiceRegistryV2.ListingStatus.Suspended);

        vm.prank(admin);
        vm.expectRevert(AgonServiceRegistryV2.VerificationScopeChanged.selector);
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);
    }

    function test_newVersionAtomicallyInvalidatesPreviousVerification() public {
        uint256 id = _publish();
        vm.prank(admin);
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);

        bytes32 manifestV2 = keccak256("manifest-v2");
        vm.expectEmit(true, true, false, true, address(services));
        emit AgonServiceRegistryV2.ListingVerificationChanged(
            id, provider, AgonServiceRegistryV2.Verification.Unverified
        );
        vm.prank(provider);
        services.publishVersion(id, manifestV2, "ipfs://manifest-v2", AgonServiceRegistryV2.PaymentRail.X402);

        AgonServiceRegistryV2.Listing memory listing = services.getListing(id);
        assertEq(listing.version, 2);
        assertEq(listing.manifestHash, manifestV2);
        assertEq(uint8(listing.verification), uint8(AgonServiceRegistryV2.Verification.Unverified));

        vm.prank(admin);
        vm.expectRevert(AgonServiceRegistryV2.VerificationScopeChanged.selector);
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);
    }

    function test_unscopedSetterCannotChangeAnyVerificationState() public {
        uint256 id = _publish();
        vm.startPrank(admin);
        vm.expectRevert(AgonServiceRegistryV2.ScopedVerificationRequired.selector);
        services.setVerification(id, AgonServiceRegistryV2.Verification.Pending);
        vm.expectRevert(AgonServiceRegistryV2.ScopedVerificationRequired.selector);
        services.setVerification(id, AgonServiceRegistryV2.Verification.Verified);
        vm.expectRevert(AgonServiceRegistryV2.ScopedVerificationRequired.selector);
        services.setVerification(id, AgonServiceRegistryV2.Verification.Revoked);
        vm.stopPrank();
        assertEq(uint8(services.getListing(id).verification), uint8(AgonServiceRegistryV2.Verification.Unverified));
    }

    function test_onlyVerifierCanUseScopedSetter() public {
        uint256 id = _publish();
        vm.prank(stranger);
        vm.expectRevert();
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);
    }

    function test_newArenaReadsTheV2RegistryAndGrantsEvaluatorAtDeployment() public {
        AgonArenaV2 arena = new AgonArenaV2(admin, address(profiles), address(services), address(identity), admin);
        assertEq(address(arena.services()), address(services));
        assertTrue(arena.hasRole(arena.EVALUATOR_ROLE(), admin));

        uint256 id = _publish();
        vm.prank(provider);
        uint256 evaluationId = arena.requestEvaluation(
            keccak256("request-v2"),
            id,
            keccak256("capability-v2"),
            keccak256("evaluator-v2"),
            keccak256("task-v2"),
            uint64(block.timestamp + 1 hours)
        );
        assertEq(arena.getEvaluation(evaluationId).agentId, 42);
        assertEq(arena.getEvaluation(evaluationId).listingVersion, 1);
    }

    // Audit C2 (2026-11-09): a suspended identity kept publishing.
    function test_suspendedProfileCannotPublishOrPublishVersion() public {
        uint256 id = _publish();
        vm.prank(admin);
        profiles.suspendProfile(42, "review");

        vm.prank(provider);
        vm.expectRevert(AgonServiceRegistryV2.ProfileNotActive.selector);
        services.publish(
            42, keccak256("other"), manifestV1, "ipfs://other", 1, AgonServiceRegistryV2.PaymentRail.X402
        );
        vm.prank(provider);
        vm.expectRevert(AgonServiceRegistryV2.ProfileNotActive.selector);
        services.publishVersion(id, keccak256("manifest-v2"), "ipfs://manifest-v2", AgonServiceRegistryV2.PaymentRail.X402);
    }

    function test_archivedProfileCannotPublish() public {
        vm.prank(provider);
        profiles.archiveProfile(42);
        vm.prank(provider);
        vm.expectRevert(AgonServiceRegistryV2.ProfileNotActive.selector);
        services.publish(42, serviceKey, manifestV1, "ipfs://manifest-v1", 1, AgonServiceRegistryV2.PaymentRail.X402);
    }

    function test_unboundIdentityMayStillPublish() public {
        identity.mint(provider, 43);
        vm.prank(provider);
        uint256 id =
            services.publish(43, serviceKey, manifestV1, "ipfs://manifest-v1", 1, AgonServiceRegistryV2.PaymentRail.X402);
        assertEq(services.getListing(id).agentId, 43);
        assertTrue(services.profileUsable(43));
    }

    function test_reinstatedProfilePublishesAgain() public {
        vm.prank(admin);
        profiles.suspendProfile(42, "review");
        vm.prank(admin);
        profiles.reinstateProfile(42);
        assertEq(_publish(), 1);
    }

    function test_suspensionStopsEscrowAndRelistingButNotDelisting() public {
        vm.prank(provider);
        uint256 id = services.publish(
            42, serviceKey, manifestV1, "ipfs://manifest-v1", 1, AgonServiceRegistryV2.PaymentRail.Escrow
        );
        vm.prank(admin);
        services.setVerificationForVersion(id, 1, manifestV1, AgonServiceRegistryV2.Verification.Verified);
        assertTrue(services.escrowEligible(id));

        vm.prank(admin);
        profiles.suspendProfile(42, "review");
        assertFalse(services.escrowEligible(id));

        vm.prank(provider);
        services.setStatus(id, AgonServiceRegistryV2.ListingStatus.Delisted);
        vm.prank(provider);
        vm.expectRevert(AgonServiceRegistryV2.ProfileNotActive.selector);
        services.setStatus(id, AgonServiceRegistryV2.ListingStatus.Listed);

        vm.prank(admin);
        profiles.reinstateProfile(42);
        vm.prank(provider);
        services.setStatus(id, AgonServiceRegistryV2.ListingStatus.Listed);
        assertTrue(services.escrowEligible(id));
    }
}
