// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";

contract MockExternalIdentity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonProfileRegistryTest is Test {
    MockExternalIdentity internal identity;
    AgonProfileRegistry internal profiles;
    address internal admin = makeAddr("admin");
    address internal provider = makeAddr("provider");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        identity = new MockExternalIdentity();
        profiles = new AgonProfileRegistry(admin, address(identity));
    }

    function test_bindProfile_requiresCurrentErc8004Owner() public {
        identity.mint(provider, 42);
        vm.prank(stranger);
        vm.expectRevert(AgonProfileRegistry.NotIdentityOwner.selector);
        profiles.bindProfile(42, "ipfs://profile");
    }

    function test_transferredIdentity_givesControlToNewOwner() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.prank(provider);
        identity.transferFrom(provider, buyer, 42);
        vm.prank(provider);
        vm.expectRevert(AgonProfileRegistry.NotIdentityOwner.selector);
        profiles.updateProfile(42, "ipfs://old-owner");
        vm.prank(buyer);
        profiles.updateProfile(42, "ipfs://new-owner");
        assertEq(profiles.getProfile(42).metadataURI, "ipfs://new-owner");
    }

    function test_bindProfile_rejectsNonexistentIdentity() public {
        vm.prank(provider);
        vm.expectRevert(AgonProfileRegistry.IdentityDoesNotExist.selector);
        profiles.bindProfile(42, "ipfs://profile");
    }

    function test_bindProfile_rejectsZeroAgentId() public {
        vm.prank(provider);
        vm.expectRevert(AgonProfileRegistry.ZeroAgentId.selector);
        profiles.bindProfile(0, "ipfs://profile");
    }

    function test_bindProfile_rejectsDuplicateBinding() public {
        identity.mint(provider, 42);
        vm.startPrank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.expectRevert(AgonProfileRegistry.ProfileAlreadyBound.selector);
        profiles.bindProfile(42, "ipfs://v2");
        vm.stopPrank();
    }

    function test_profileLifecycle_emitsProjectableEvents() public {
        identity.mint(provider, 42);

        vm.expectEmit(true, true, false, true, address(profiles));
        emit AgonProfileRegistry.ProfileBound(42, provider, "ipfs://v1");
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");

        vm.expectEmit(true, true, false, true, address(profiles));
        emit AgonProfileRegistry.ProfileMetadataUpdated(42, provider, "ipfs://v2");
        vm.prank(provider);
        profiles.updateProfile(42, "ipfs://v2");

        bytes32 reason = keccak256("policy violation");
        vm.expectEmit(true, true, false, true, address(profiles));
        emit AgonProfileRegistry.ProfileStatusChanged(42, admin, AgonProfileRegistry.Status.Suspended, reason);
        vm.prank(admin);
        profiles.suspendProfile(42, reason);

        vm.expectEmit(true, true, false, true, address(profiles));
        emit AgonProfileRegistry.ProfileStatusChanged(42, provider, AgonProfileRegistry.Status.Archived, bytes32(0));
        vm.prank(provider);
        profiles.archiveProfile(42);
    }

    function test_metadataUri_hasBoundedLength() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        vm.expectRevert(AgonProfileRegistry.InvalidMetadataURI.selector);
        profiles.bindProfile(42, "");
        string memory oversized = new string(2049);
        vm.prank(provider);
        vm.expectRevert(AgonProfileRegistry.InvalidMetadataURI.selector);
        profiles.bindProfile(42, oversized);
    }

    function test_admin_canSuspendWithReasonHash() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        bytes32 reason = keccak256("policy violation");
        vm.prank(admin);
        profiles.suspendProfile(42, reason);
        AgonProfileRegistry.Profile memory p = profiles.getProfile(42);
        assertEq(uint8(p.status), uint8(AgonProfileRegistry.Status.Suspended));
        assertEq(p.suspensionReason, reason);
    }

    function test_owner_canArchiveProfile() public {
        identity.mint(provider, 42);
        vm.startPrank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        profiles.archiveProfile(42);
        vm.stopPrank();
        assertEq(uint8(profiles.getProfile(42).status), uint8(AgonProfileRegistry.Status.Archived));
    }

    function test_syncOwnership_updatesSnapshotAndEmits() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.prank(provider);
        identity.transferFrom(provider, buyer, 42);
        vm.expectEmit(true, true, true, true);
        emit AgonProfileRegistry.OwnershipSynced(42, provider, buyer);
        vm.prank(buyer);
        profiles.syncOwnership(42);
        assertEq(profiles.getProfile(42).ownerSnapshot, buyer);
    }

    // Audit C1 (2026-11-09): a suspension had no way back.
    function test_reinstateProfile_returnsSuspendedProfileToActive() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.prank(admin);
        profiles.suspendProfile(42, "review");

        vm.expectEmit(true, true, false, true, address(profiles));
        emit AgonProfileRegistry.ProfileStatusChanged(42, admin, AgonProfileRegistry.Status.Active, bytes32(0));
        vm.prank(admin);
        profiles.reinstateProfile(42);

        AgonProfileRegistry.Profile memory p = profiles.getProfile(42);
        assertEq(uint8(p.status), uint8(AgonProfileRegistry.Status.Active));
        assertEq(p.suspensionReason, bytes32(0));
    }

    function test_reinstateProfile_onlyAdmin() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.prank(admin);
        profiles.suspendProfile(42, "review");
        vm.prank(provider);
        vm.expectRevert();
        profiles.reinstateProfile(42);
    }

    function test_reinstateProfile_rejectsActiveArchivedAndMissing() public {
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://v1");
        vm.prank(admin);
        vm.expectRevert(AgonProfileRegistry.ProfileNotSuspended.selector);
        profiles.reinstateProfile(42);

        vm.prank(provider);
        profiles.archiveProfile(42);
        vm.prank(admin);
        vm.expectRevert(AgonProfileRegistry.ProfileNotSuspended.selector);
        profiles.reinstateProfile(42);

        vm.prank(admin);
        vm.expectRevert(AgonProfileRegistry.MissingIdentity.selector);
        profiles.reinstateProfile(7);
    }
}
