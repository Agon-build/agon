// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import { AgonJobEscrowV2 } from "../src/AgonJobEscrowV2.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonRoleHandoff } from "./AgonRoleHandoff.sol";

/// @notice Deploys the separately versioned escrow with an initial 5% fee.
/// @dev Without --broadcast this performs only constructor preflight. It does
///      not update the canonical deployment receipt.
///      Env: AGON_ADMIN_ADDRESS (optional, defaults to the deployer; when set, the
///      deployer hands DEFAULT_ADMIN_ROLE to it and renounces every role),
///      AGON_PAUSER_ADDRESS (optional, defaults to the admin),
///      AGON_DISPUTE_RESOLVER_ADDRESS (should be its own key, not the admin).
contract DeployAgonJobEscrowV2 is Script, AgonRoleHandoff {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant DEFAULT_REVIEW_HOURS = 24;
    uint256 internal constant INITIAL_PROTOCOL_FEE_BPS = 500;
    uint256 internal constant MAX_PROTOCOL_FEE_BPS = 1000;
    uint256 internal constant PROTOCOL_FEE_CHANGE_DELAY = 2 days;

    struct Config {
        address admin;
        address pauser;
        address profileRegistry;
        address serviceRegistry;
        address usdc;
        address disputeResolver;
        address treasury;
        uint256 reviewHours;
        uint256 initialFeeBps;
    }

    function run() external returns (AgonJobEscrowV2 escrow) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", vm.addr(key));
        Config memory cfg = Config({
            admin: admin,
            pauser: vm.envOr("AGON_PAUSER_ADDRESS", admin),
            profileRegistry: vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS"),
            serviceRegistry: vm.envAddress("AGON_SERVICE_REGISTRY_ADDRESS"),
            usdc: vm.envAddress("AGON_USDC_ADDRESS"),
            disputeResolver: vm.envAddress("AGON_DISPUTE_RESOLVER_ADDRESS"),
            treasury: vm.envAddress("AGON_TREASURY_ADDRESS"),
            reviewHours: vm.envOr("AGON_DEFAULT_REVIEW_HOURS", DEFAULT_REVIEW_HOURS),
            initialFeeBps: vm.envOr("AGON_INITIAL_PROTOCOL_FEE_BPS", INITIAL_PROTOCOL_FEE_BPS)
        });
        return deploy(key, cfg);
    }

    function deploy(uint256 key, Config memory cfg) public returns (AgonJobEscrowV2 escrow) {
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");
        address deployer = vm.addr(key);

        require(cfg.admin != address(0) && cfg.pauser != address(0), "zero admin");
        require(cfg.disputeResolver != address(0) && cfg.treasury != address(0), "zero protocol address");
        require(cfg.reviewHours <= type(uint64).max, "review hours overflow");
        require(cfg.initialFeeBps <= MAX_PROTOCOL_FEE_BPS, "initial fee above cap");

        _requireCode(cfg.profileRegistry, "profile registry");
        _requireCode(cfg.serviceRegistry, "service registry");
        _requireCode(cfg.usdc, "USDC");
        require(AgonProfileRegistry(cfg.profileRegistry).hasRole(bytes32(0), cfg.admin), "admin is not foundation admin");
        require(
            address(AgonServiceRegistry(cfg.serviceRegistry).profiles()) == cfg.profileRegistry,
            "service registry is not pinned to profile registry"
        );

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon escrow V2 admin", cfg.admin);
        console2.log("Agon escrow V2 pauser", cfg.pauser);
        console2.log("Agon ProfileRegistry", cfg.profileRegistry);
        console2.log("Agon ServiceRegistry", cfg.serviceRegistry);
        console2.log("Agon USDC", cfg.usdc);
        console2.log("Agon dispute resolver", cfg.disputeResolver);
        console2.log("Agon treasury", cfg.treasury);
        console2.log("Agon default review hours", cfg.reviewHours);
        console2.log("Agon initial protocol fee bps", cfg.initialFeeBps);
        console2.log("Agon maximum protocol fee bps", MAX_PROTOCOL_FEE_BPS);
        console2.log("Agon fee change delay seconds", PROTOCOL_FEE_CHANGE_DELAY);

        vm.startBroadcast(key);
        // forge-lint: disable-next-line(unsafe-typecast) -- bounded by the max checks above.
        escrow = new AgonJobEscrowV2(
            deployer,
            cfg.usdc,
            cfg.serviceRegistry,
            cfg.disputeResolver,
            cfg.treasury,
            uint64(cfg.reviewHours),
            uint16(cfg.initialFeeBps)
        );
        _setupRoles(IAccessControl(address(escrow)), _one(escrow.PAUSER_ROLE(), cfg.pauser), deployer, cfg.admin);
        vm.stopBroadcast();

        console2.log("AgonJobEscrowV2", address(escrow));
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length != 0, string.concat(label, " has no deployed bytecode"));
    }
}
