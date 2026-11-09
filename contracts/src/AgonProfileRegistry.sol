// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC8004Identity } from "./interfaces/IERC8004Identity.sol";

contract AgonProfileRegistry is AccessControl {
    enum Status {
        Active,
        Suspended,
        Archived
    }

    struct Profile {
        uint256 agentId;
        string metadataURI;
        Status status;
        address ownerSnapshot;
        uint64 createdAt;
        uint64 updatedAt;
        bytes32 suspensionReason;
    }
    mapping(uint256 => Profile) private profiles;
    IERC8004Identity public immutable identityRegistry;
    error NotIdentityOwner();
    error IdentityDoesNotExist();
    error ZeroAgentId();
    error ProfileAlreadyBound();
    error InvalidMetadataURI();
    error MissingIdentity();
    error ProfileNotSuspended();
    event ProfileBound(uint256 indexed agentId, address indexed owner, string metadataURI);
    event ProfileMetadataUpdated(uint256 indexed agentId, address indexed owner, string metadataURI);
    event ProfileStatusChanged(uint256 indexed agentId, address indexed actor, Status status, bytes32 reason);
    event OwnershipSynced(uint256 indexed agentId, address indexed previousOwner, address indexed newOwner);

    constructor(address admin, address identity) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        identityRegistry = IERC8004Identity(identity);
    }

    function currentOwner(uint256 id) public view returns (address) {
        if (id == 0) return address(0);
        try identityRegistry.ownerOf(id) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }
    modifier onlyOwner(uint256 id) {
        address o = currentOwner(id);
        if (o == address(0)) revert IdentityDoesNotExist();
        if (o != msg.sender) revert NotIdentityOwner();
        _;
    }

    function bindProfile(uint256 id, string calldata uri) external {
        if (id == 0) revert ZeroAgentId();
        address o = currentOwner(id);
        if (o == address(0)) revert IdentityDoesNotExist();
        if (o != msg.sender) revert NotIdentityOwner();
        if (bytes(uri).length == 0 || bytes(uri).length > 2048) revert InvalidMetadataURI();
        if (profiles[id].agentId != 0) revert ProfileAlreadyBound();
        profiles[id] =
            Profile(id, uri, Status.Active, msg.sender, uint64(block.timestamp), uint64(block.timestamp), bytes32(0));
        emit ProfileBound(id, msg.sender, uri);
    }

    function updateProfile(uint256 id, string calldata uri) external onlyOwner(id) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        if (bytes(uri).length == 0 || bytes(uri).length > 2048) revert InvalidMetadataURI();
        profiles[id].metadataURI = uri;
        profiles[id].ownerSnapshot = msg.sender;
        profiles[id].updatedAt = uint64(block.timestamp);
        emit ProfileMetadataUpdated(id, msg.sender, uri);
    }

    function syncOwnership(uint256 id) external onlyOwner(id) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        address old = profiles[id].ownerSnapshot;
        address n = currentOwner(id);
        profiles[id].ownerSnapshot = n;
        profiles[id].updatedAt = uint64(block.timestamp);
        emit OwnershipSynced(id, old, n);
    }

    function suspendProfile(uint256 id, bytes32 reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        profiles[id].status = Status.Suspended;
        profiles[id].suspensionReason = reason;
        profiles[id].updatedAt = uint64(block.timestamp);
        emit ProfileStatusChanged(id, msg.sender, Status.Suspended, reason);
    }

    /// @notice Lift a suspension. Only a Suspended profile can return to Active; Archived stays archived.
    function reinstateProfile(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        if (profiles[id].status != Status.Suspended) revert ProfileNotSuspended();
        profiles[id].status = Status.Active;
        profiles[id].suspensionReason = bytes32(0);
        profiles[id].updatedAt = uint64(block.timestamp);
        emit ProfileStatusChanged(id, msg.sender, Status.Active, bytes32(0));
    }

    function archiveProfile(uint256 id) external onlyOwner(id) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        profiles[id].status = Status.Archived;
        profiles[id].updatedAt = uint64(block.timestamp);
        emit ProfileStatusChanged(id, msg.sender, Status.Archived, bytes32(0));
    }

    function getProfile(uint256 id) external view returns (Profile memory) {
        if (profiles[id].agentId == 0) revert MissingIdentity();
        return profiles[id];
    }
}
