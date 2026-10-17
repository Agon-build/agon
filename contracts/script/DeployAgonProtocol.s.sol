// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { AgonArena } from "../src/AgonArena.sol";
import { AgonJobEscrow } from "../src/AgonJobEscrow.sol";
import { AgonPrizeVault } from "../src/AgonPrizeVault.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonSyndicateRegistry } from "../src/AgonSyndicateRegistry.sol";
import { AgonRoleHandoff } from "./AgonRoleHandoff.sol";

/// @notice Deploys the post-foundation Agon contracts against an existing
///         receipt-verified ProfileRegistry and ServiceRegistry.
/// @dev    Without --broadcast, this is a read-only constructor and address
///         preflight. It never writes the canonical deployment receipt.
///         Env: AGON_ADMIN_ADDRESS (optional, defaults to the deployer; when set,
///         the deployer hands DEFAULT_ADMIN_ROLE to it and renounces every role).
///         Optional operational keys, each defaulting to the admin:
///         AGON_VERIFIER_ADDRESS, AGON_EVALUATOR_ADDRESS, AGON_COORDINATOR_ADDRESS,
///         AGON_POOL_OPERATOR_ADDRESS, AGON_PAUSER_ADDRESS.
contract DeployAgonProtocol is Script, AgonRoleHandoff {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant DEFAULT_REVIEW_HOURS = 24;

    struct Deployed {
        AgonJobEscrow jobEscrow;
        AgonArena arena;
        AgonSyndicateRegistry syndicateRegistry;
        AgonPrizeVault prizeVault;
    }

    struct Config {
        address admin;
        address verifier;
        address evaluator;
        address coordinator;
        address poolOperator;
        address pauser;
        address profileRegistry;
        address serviceRegistry;
        address usdc;
        address validationRegistry;
        address disputeResolver;
        address treasury;
        uint256 reviewHours;
    }

    function run() external returns (Deployed memory d) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", vm.addr(key));
        Config memory cfg = Config({
            admin: admin,
            verifier: vm.envOr("AGON_VERIFIER_ADDRESS", admin),
            evaluator: vm.envOr("AGON_EVALUATOR_ADDRESS", admin),
            coordinator: vm.envOr("AGON_COORDINATOR_ADDRESS", admin),
            poolOperator: vm.envOr("AGON_POOL_OPERATOR_ADDRESS", admin),
            pauser: vm.envOr("AGON_PAUSER_ADDRESS", admin),
            profileRegistry: vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS"),
            serviceRegistry: vm.envAddress("AGON_SERVICE_REGISTRY_ADDRESS"),
            usdc: vm.envAddress("AGON_USDC_ADDRESS"),
            validationRegistry: vm.envAddress("AGON_VALIDATION_REGISTRY_ADDRESS"),
            disputeResolver: vm.envAddress("AGON_DISPUTE_RESOLVER_ADDRESS"),
            treasury: vm.envAddress("AGON_TREASURY_ADDRESS"),
            reviewHours: vm.envOr("AGON_DEFAULT_REVIEW_HOURS", DEFAULT_REVIEW_HOURS)
        });
        return deploy(key, cfg);
    }

    function deploy(uint256 key, Config memory cfg) public returns (Deployed memory d) {
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");
        address deployer = vm.addr(key);

        require(cfg.admin != address(0), "zero admin");
        require(cfg.disputeResolver != address(0) && cfg.treasury != address(0), "zero protocol address");
        require(cfg.reviewHours <= type(uint64).max, "review hours overflow");

        _requireCode(cfg.profileRegistry, "profile registry");
        _requireCode(cfg.serviceRegistry, "service registry");
        _requireCode(cfg.usdc, "USDC");
        _requireCode(cfg.validationRegistry, "validation registry");
        require(AgonProfileRegistry(cfg.profileRegistry).hasRole(bytes32(0), cfg.admin), "admin is not foundation admin");
        require(
            address(AgonServiceRegistry(cfg.serviceRegistry).profiles()) == cfg.profileRegistry,
            "service registry is not pinned to profile registry"
        );

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon admin", cfg.admin);
        console2.log("Agon verifier", cfg.verifier);
        console2.log("Agon evaluator", cfg.evaluator);
        console2.log("Agon coordinator", cfg.coordinator);
        console2.log("Agon pool operator", cfg.poolOperator);
        console2.log("Agon pauser", cfg.pauser);
        console2.log("Agon ProfileRegistry", cfg.profileRegistry);
        console2.log("Agon ServiceRegistry", cfg.serviceRegistry);
        console2.log("Agon USDC", cfg.usdc);
        console2.log("Agon ValidationRegistry", cfg.validationRegistry);
        console2.log("Agon dispute resolver", cfg.disputeResolver);
        console2.log("Agon treasury", cfg.treasury);
        console2.log("Agon default review hours", cfg.reviewHours);

        vm.startBroadcast(key);
        // forge-lint: disable-next-line(unsafe-typecast) -- bounded by the max check above.
        d.jobEscrow = new AgonJobEscrow(
            deployer, cfg.usdc, cfg.serviceRegistry, cfg.disputeResolver, cfg.treasury, uint64(cfg.reviewHours)
        );
        d.arena = new AgonArena(deployer, cfg.profileRegistry, cfg.serviceRegistry, cfg.validationRegistry);
        d.syndicateRegistry = new AgonSyndicateRegistry(deployer, cfg.profileRegistry);
        d.prizeVault = new AgonPrizeVault(deployer, cfg.usdc, cfg.treasury);
        _handoff(d, cfg, deployer);
        vm.stopBroadcast();

        console2.log("AgonJobEscrow", address(d.jobEscrow));
        console2.log("AgonArena", address(d.arena));
        console2.log("AgonSyndicateRegistry", address(d.syndicateRegistry));
        console2.log("AgonPrizeVault", address(d.prizeVault));
    }

    function _handoff(Deployed memory d, Config memory cfg, address deployer) internal {
        _setupRoles(
            IAccessControl(address(d.jobEscrow)), _one(d.jobEscrow.PAUSER_ROLE(), cfg.pauser), deployer, cfg.admin
        );
        _setupRoles(
            IAccessControl(address(d.arena)),
            _two(d.arena.VERIFIER_ROLE(), cfg.verifier, d.arena.EVALUATOR_ROLE(), cfg.evaluator),
            deployer,
            cfg.admin
        );
        _setupRoles(
            IAccessControl(address(d.syndicateRegistry)),
            _two(
                d.syndicateRegistry.COORDINATOR_ROLE(),
                cfg.coordinator,
                d.syndicateRegistry.EVALUATOR_ROLE(),
                cfg.evaluator
            ),
            deployer,
            cfg.admin
        );
        _setupRoles(
            IAccessControl(address(d.prizeVault)),
            _one(d.prizeVault.POOL_OPERATOR_ROLE(), cfg.poolOperator),
            deployer,
            cfg.admin
        );
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length != 0, string.concat(label, " has no deployed bytecode"));
    }
}
