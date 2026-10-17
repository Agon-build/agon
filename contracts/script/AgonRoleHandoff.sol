// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Shared role setup for Agon deploy scripts.
/// @dev Contracts are constructed with the deployer as admin. The script then
///      grants each operational role to its own key. When a separate admin
///      (for example a Safe) is given, it gets DEFAULT_ADMIN_ROLE and the
///      deployer renounces every role it holds. Call inside the broadcast.
abstract contract AgonRoleHandoff {
    bytes32 internal constant DEFAULT_ADMIN = 0x00;

    struct RoleGrant {
        bytes32 role;
        address holder;
    }

    function _setupRoles(IAccessControl target, RoleGrant[] memory grants, address deployer, address admin)
        internal
    {
        for (uint256 i = 0; i < grants.length; i++) {
            require(grants[i].holder != address(0), "zero role holder");
            if (!target.hasRole(grants[i].role, grants[i].holder)) target.grantRole(grants[i].role, grants[i].holder);
        }
        if (admin == deployer) return;

        if (!target.hasRole(DEFAULT_ADMIN, admin)) target.grantRole(DEFAULT_ADMIN, admin);
        for (uint256 i = 0; i < grants.length; i++) {
            if (grants[i].holder != deployer && target.hasRole(grants[i].role, deployer)) {
                target.renounceRole(grants[i].role, deployer);
            }
        }
        target.renounceRole(DEFAULT_ADMIN, deployer);
        require(target.hasRole(DEFAULT_ADMIN, admin), "admin handoff failed");
        require(!target.hasRole(DEFAULT_ADMIN, deployer), "deployer still admin");
    }

    function _one(bytes32 role, address holder) internal pure returns (RoleGrant[] memory grants) {
        grants = new RoleGrant[](1);
        grants[0] = RoleGrant(role, holder);
    }

    function _two(bytes32 roleA, address holderA, bytes32 roleB, address holderB)
        internal
        pure
        returns (RoleGrant[] memory grants)
    {
        grants = new RoleGrant[](2);
        grants[0] = RoleGrant(roleA, holderA);
        grants[1] = RoleGrant(roleB, holderB);
    }
}
