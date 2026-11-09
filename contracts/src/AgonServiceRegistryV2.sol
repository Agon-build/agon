// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { AgonProfileRegistry } from "./AgonProfileRegistry.sol";

/// @notice Version-scoped service registry used by automatic Arena verification.
/// @dev This is a separate deployment from the immutable, already-deployed V1 registry.
contract AgonServiceRegistryV2 is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    enum ListingStatus {
        Listed,
        Suspended,
        Delisted
    }
    enum Verification {
        Unverified,
        Pending,
        Verified,
        Expired,
        Suspended,
        Revoked
    }
    enum PaymentRail {
        X402,
        Escrow
    }

    struct Listing {
        uint256 listingId;
        uint256 agentId;
        bytes32 serviceKey;
        bytes32 manifestHash;
        string manifestURI;
        uint256 category;
        PaymentRail paymentRail;
        uint256 version;
        address providerSnapshot;
        ListingStatus status;
        Verification verification;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Version {
        uint256 version;
        bytes32 manifestHash;
        string manifestURI;
        PaymentRail paymentRail;
        address providerSnapshot;
        uint64 createdAt;
    }
    AgonProfileRegistry public immutable profiles;
    uint256 private nextListingId = 1;
    mapping(uint256 => Listing) private listings;
    mapping(uint256 => mapping(uint256 => Version)) private versions;
    mapping(uint256 => mapping(bytes32 => bool)) private usedKeys;
    error NotIdentityOwner();
    error ServiceKeyAlreadyPublished();
    error InvalidCategory();
    error InvalidServiceKey();
    error InvalidManifest();
    error InvalidAddress();
    error ListingMissing();
    error InvalidVersion();
    error ScopedVerificationRequired();
    error VerificationScopeChanged();
    error ProfileNotActive();
    event ListingPublished(
        uint256 indexed listingId,
        uint256 indexed agentId,
        bytes32 indexed serviceKey,
        bytes32 manifestHash,
        string manifestURI,
        uint256 category,
        PaymentRail paymentRail,
        uint256 version,
        address providerSnapshot,
        ListingStatus status,
        Verification verification
    );
    event ListingVersionPublished(
        uint256 indexed listingId,
        uint256 indexed version,
        bytes32 indexed manifestHash,
        string manifestURI,
        PaymentRail paymentRail,
        address providerSnapshot
    );
    event ListingStatusChanged(uint256 indexed listingId, address indexed providerSnapshot, ListingStatus status);
    event ListingVerificationChanged(uint256 indexed listingId, address indexed verifier, Verification verification);

    constructor(address admin, address profileRegistry, address verifier) {
        if (admin == address(0) || profileRegistry == address(0) || verifier == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);
        profiles = AgonProfileRegistry(profileRegistry);
    }
    modifier ownerOfListing(uint256 id) {
        Listing storage l = listings[id];
        if (l.listingId == 0) revert ListingMissing();
        if (profiles.currentOwner(l.agentId) != msg.sender) revert NotIdentityOwner();
        _;
    }

    function publish(
        uint256 agentId,
        bytes32 serviceKey,
        bytes32 manifestHash,
        string calldata uri,
        uint256 category,
        PaymentRail rail
    ) external returns (uint256 id) {
        if (profiles.currentOwner(agentId) != msg.sender) revert NotIdentityOwner();
        if (!profileUsable(agentId)) revert ProfileNotActive();
        if (serviceKey == bytes32(0)) revert InvalidServiceKey();
        if (manifestHash == bytes32(0) || bytes(uri).length == 0) revert InvalidManifest();
        if (category == 0) revert InvalidCategory();
        if (usedKeys[agentId][serviceKey]) revert ServiceKeyAlreadyPublished();
        id = nextListingId++;
        usedKeys[agentId][serviceKey] = true;
        listings[id] = Listing(
            id,
            agentId,
            serviceKey,
            manifestHash,
            uri,
            category,
            rail,
            1,
            msg.sender,
            ListingStatus.Listed,
            Verification.Unverified,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        versions[id][1] = Version(1, manifestHash, uri, rail, msg.sender, uint64(block.timestamp));
        emit ListingPublished(
            id,
            agentId,
            serviceKey,
            manifestHash,
            uri,
            category,
            rail,
            1,
            msg.sender,
            ListingStatus.Listed,
            Verification.Unverified
        );
    }

    function publishVersion(uint256 id, bytes32 hash, string calldata uri, PaymentRail rail)
        external
        ownerOfListing(id)
    {
        if (hash == bytes32(0) || bytes(uri).length == 0) revert InvalidManifest();
        Listing storage l = listings[id];
        if (!profileUsable(l.agentId)) revert ProfileNotActive();
        uint256 v = l.version + 1;
        l.version = v;
        l.manifestHash = hash;
        l.manifestURI = uri;
        l.paymentRail = rail;
        l.providerSnapshot = msg.sender;
        l.verification = Verification.Unverified;
        l.updatedAt = uint64(block.timestamp);
        versions[id][v] = Version(v, hash, uri, rail, msg.sender, uint64(block.timestamp));
        emit ListingVerificationChanged(id, msg.sender, Verification.Unverified);
        emit ListingVersionPublished(id, v, hash, uri, rail, msg.sender);
    }

    /// @dev Delisting is always allowed. Returning to Listed needs a usable profile.
    function setStatus(uint256 id, ListingStatus status) external ownerOfListing(id) {
        if (status == ListingStatus.Listed && !profileUsable(listings[id].agentId)) revert ProfileNotActive();
        listings[id].status = status;
        listings[id].updatedAt = uint64(block.timestamp);
        emit ListingStatusChanged(id, msg.sender, status);
    }

    /// @dev Retained solely to fail closed for integrations still calling the V1 selector.
    function setVerification(uint256, Verification) external pure {
        revert ScopedVerificationRequired();
    }

    function verificationScopeSupported() external pure returns (bool) {
        return true;
    }

    function setVerificationForVersion(
        uint256 id,
        uint256 expectedVersion,
        bytes32 expectedManifestHash,
        Verification v
    ) external onlyRole(VERIFIER_ROLE) {
        Listing storage l = listings[id];
        if (l.listingId == 0) revert ListingMissing();
        if (l.version != expectedVersion || l.manifestHash != expectedManifestHash) {
            revert VerificationScopeChanged();
        }
        if ((v == Verification.Pending || v == Verification.Verified) && l.status != ListingStatus.Listed) {
            revert VerificationScopeChanged();
        }
        l.verification = v;
        l.updatedAt = uint64(block.timestamp);
        emit ListingVerificationChanged(id, msg.sender, v);
    }

    function escrowEligible(uint256 id) public view returns (bool) {
        Listing storage l = listings[id];
        return l.listingId != 0 && l.paymentRail == PaymentRail.Escrow && l.verification == Verification.Verified
            && l.status == ListingStatus.Listed && profileUsable(l.agentId);
    }

    /// @notice False when the agent has a bound profile that is Suspended or Archived.
    /// @dev An agent with no bound profile may publish (owner decision, audit C2 of 2026-11-09).
    ///      Any other failure to read the profile counts as not usable.
    function profileUsable(uint256 agentId) public view returns (bool) {
        try profiles.getProfile(agentId) returns (AgonProfileRegistry.Profile memory p) {
            return p.status == AgonProfileRegistry.Status.Active;
        } catch (bytes memory reason) {
            return reason.length == 4 && bytes4(reason) == AgonProfileRegistry.MissingIdentity.selector;
        }
    }

    function getListing(uint256 id) external view returns (Listing memory) {
        if (listings[id].listingId == 0) revert ListingMissing();
        return listings[id];
    }

    function getVersion(uint256 id, uint256 v) external view returns (Version memory) {
        if (listings[id].listingId == 0 || versions[id][v].version == 0) revert InvalidVersion();
        return versions[id][v];
    }
}
