// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistryV2 } from "../src/AgonServiceRegistryV2.sol";
import { AgonArenaV2 } from "../src/AgonArenaV2.sol";
import { AgonRoleHandoff } from "./AgonRoleHandoff.sol";

/// @notice Deploys the version-scoped registry and its linked Arena.
/// @dev Without --broadcast this performs constructor preflight only. Providers
///      must republish current service manifests because V1 listing state is immutable.
///      Env: AGON_ADMIN_ADDRESS (optional, defaults to the deployer; when set, the
///      deployer hands DEFAULT_ADMIN_ROLE to it and renounces every role),
///      AGON_VERIFIER_ADDRESS, AGON_EVALUATOR_ADDRESS (optional, defaults to the verifier).
contract DeployAgonServiceRegistryV2 is Script, AgonRoleHandoff {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    struct Config {
        address admin;
        address verifier;
        address evaluator;
        address profileRegistry;
        address validationRegistry;
    }

    function run() external returns (AgonServiceRegistryV2 registry, AgonArenaV2 arena) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        address deployer = vm.addr(key);
        address verifier = vm.envAddress("AGON_VERIFIER_ADDRESS");
        Config memory cfg = Config({
            admin: vm.envOr("AGON_ADMIN_ADDRESS", deployer),
            verifier: verifier,
            evaluator: vm.envOr("AGON_EVALUATOR_ADDRESS", verifier),
            profileRegistry: vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS"),
            validationRegistry: vm.envAddress("AGON_VALIDATION_REGISTRY_ADDRESS")
        });
        return deploy(key, cfg);
    }

    function deploy(uint256 key, Config memory cfg) public returns (AgonServiceRegistryV2 registry, AgonArenaV2 arena) {
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");
        address deployer = vm.addr(key);
        require(cfg.admin != address(0), "zero admin");
        require(cfg.verifier != address(0), "zero verifier");
        require(cfg.evaluator != address(0), "zero evaluator");
        require(cfg.profileRegistry.code.length != 0, "profile registry has no code");
        require(cfg.validationRegistry.code.length != 0, "validation registry has no code");
        require(AgonProfileRegistry(cfg.profileRegistry).hasRole(bytes32(0), cfg.admin), "admin is not foundation admin");

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon registry V2 admin", cfg.admin);
        console2.log("Agon registry V2 verifier", cfg.verifier);
        console2.log("Agon arena V2 evaluator", cfg.evaluator);
        console2.log("Agon ProfileRegistry", cfg.profileRegistry);
        console2.log("Agon ValidationRegistry", cfg.validationRegistry);

        vm.startBroadcast(key);
        registry = new AgonServiceRegistryV2(deployer, cfg.profileRegistry, cfg.verifier);
        arena = new AgonArenaV2(deployer, cfg.profileRegistry, address(registry), cfg.validationRegistry, cfg.evaluator);
        _setupRoles(IAccessControl(address(registry)), _one(registry.VERIFIER_ROLE(), cfg.verifier), deployer, cfg.admin);
        _setupRoles(
            IAccessControl(address(arena)),
            _two(arena.EVALUATOR_ROLE(), cfg.evaluator, arena.VERIFIER_ROLE(), cfg.verifier),
            deployer,
            cfg.admin
        );
        vm.stopBroadcast();

        console2.log("AgonServiceRegistryV2", address(registry));
        console2.log("AgonArenaV2", address(arena));
    }
}
