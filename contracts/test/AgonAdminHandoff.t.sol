// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonServiceRegistryV2 } from "../src/AgonServiceRegistryV2.sol";
import { AgonArenaV2 } from "../src/AgonArenaV2.sol";
import { AgonJobEscrowV2 } from "../src/AgonJobEscrowV2.sol";
import { DeployAgonServiceRegistryV2 } from "../script/DeployAgonServiceRegistryV2.s.sol";
import { DeployAgonJobEscrowV2 } from "../script/DeployAgonJobEscrowV2.s.sol";
import { DeployAgonProtocol } from "../script/DeployAgonProtocol.s.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { LocalAgentIdentity, LocalValidationRegistry } from "./AgonV2DeploymentFlow.t.sol";

/// @notice Proves the deploy scripts hand admin to a separate address (a Safe in
///         production) and leave the deployer with no role at all.
/// @dev Calls each script's deploy(config) directly so no process env is shared
///      with other suites running in parallel.
contract AgonAdminHandoffTest is Test {
    uint256 private constant DEPLOYER_KEY = 0xB0B;
    bytes32 private constant ADMIN_ROLE = 0x00;

    address private deployer;
    address private safe = makeAddr("safe");
    address private verifier = makeAddr("verifier");
    address private evaluator = makeAddr("evaluator");
    address private resolver = makeAddr("resolver");
    address private poolOperator = makeAddr("poolOperator");
    address private coordinator = makeAddr("coordinator");
    address private treasury = makeAddr("treasury");

    AgonProfileRegistry private profiles;
    AgonServiceRegistry private servicesV1;
    LocalValidationRegistry private validation;
    MockUSDC private usdc;

    function setUp() public {
        vm.chainId(5_042_002);
        deployer = vm.addr(DEPLOYER_KEY);
        LocalAgentIdentity identity = new LocalAgentIdentity();
        profiles = new AgonProfileRegistry(safe, address(identity));
        servicesV1 = new AgonServiceRegistry(safe, address(profiles));
        validation = new LocalValidationRegistry();
        usdc = new MockUSDC();
    }

    function _assertHandedOff(IAccessControl target) private view {
        assertTrue(target.hasRole(ADMIN_ROLE, safe), "safe is admin");
        assertFalse(target.hasRole(ADMIN_ROLE, deployer), "deployer renounced admin");
    }

    function test_registryV2AndArenaV2HandAdminToSafe() public {
        DeployAgonServiceRegistryV2 script = new DeployAgonServiceRegistryV2();
        (AgonServiceRegistryV2 registry, AgonArenaV2 arena) = script.deploy(
            DEPLOYER_KEY,
            DeployAgonServiceRegistryV2.Config({
                admin: safe,
                verifier: verifier,
                evaluator: evaluator,
                profileRegistry: address(profiles),
                validationRegistry: address(validation)
            })
        );
        _assertHandedOff(IAccessControl(address(registry)));
        _assertHandedOff(IAccessControl(address(arena)));
        assertTrue(registry.hasRole(registry.VERIFIER_ROLE(), verifier));
        assertTrue(arena.hasRole(arena.EVALUATOR_ROLE(), evaluator));
        assertTrue(arena.hasRole(arena.VERIFIER_ROLE(), verifier));
        assertFalse(arena.hasRole(arena.VERIFIER_ROLE(), deployer));
        assertFalse(registry.hasRole(registry.VERIFIER_ROLE(), safe));

        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(deployer);
        vm.expectRevert();
        registry.grantRole(verifierRole, deployer);
        vm.prank(safe);
        registry.revokeRole(verifierRole, verifier);
        assertFalse(registry.hasRole(verifierRole, verifier));
    }

    function test_jobEscrowV2HandsAdminToSafe() public {
        DeployAgonJobEscrowV2 script = new DeployAgonJobEscrowV2();
        AgonJobEscrowV2 escrow = script.deploy(
            DEPLOYER_KEY,
            DeployAgonJobEscrowV2.Config({
                admin: safe,
                pauser: safe,
                profileRegistry: address(profiles),
                serviceRegistry: address(servicesV1),
                usdc: address(usdc),
                disputeResolver: resolver,
                treasury: treasury,
                reviewHours: 24,
                initialFeeBps: 500
            })
        );
        _assertHandedOff(IAccessControl(address(escrow)));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), safe));
        assertFalse(escrow.hasRole(escrow.PAUSER_ROLE(), deployer));
        assertEq(escrow.disputeResolver(), resolver);

        vm.prank(deployer);
        vm.expectRevert();
        escrow.setTreasury(deployer);
        vm.prank(safe);
        escrow.pause();
        assertTrue(escrow.paused());
    }

    function test_protocolScriptHandsEveryContractToSafe() public {
        DeployAgonProtocol script = new DeployAgonProtocol();
        DeployAgonProtocol.Deployed memory d = script.deploy(
            DEPLOYER_KEY,
            DeployAgonProtocol.Config({
                admin: safe,
                verifier: verifier,
                evaluator: evaluator,
                coordinator: coordinator,
                poolOperator: poolOperator,
                pauser: safe,
                profileRegistry: address(profiles),
                serviceRegistry: address(servicesV1),
                usdc: address(usdc),
                validationRegistry: address(validation),
                disputeResolver: resolver,
                treasury: treasury,
                reviewHours: 24
            })
        );
        _assertHandedOff(IAccessControl(address(d.jobEscrow)));
        _assertHandedOff(IAccessControl(address(d.arena)));
        _assertHandedOff(IAccessControl(address(d.syndicateRegistry)));
        _assertHandedOff(IAccessControl(address(d.prizeVault)));
        assertTrue(d.prizeVault.hasRole(d.prizeVault.POOL_OPERATOR_ROLE(), poolOperator));
        assertFalse(d.prizeVault.hasRole(d.prizeVault.POOL_OPERATOR_ROLE(), deployer));
        assertFalse(d.prizeVault.hasRole(d.prizeVault.POOL_OPERATOR_ROLE(), safe));
        assertTrue(d.syndicateRegistry.hasRole(d.syndicateRegistry.COORDINATOR_ROLE(), coordinator));
        assertTrue(d.syndicateRegistry.hasRole(d.syndicateRegistry.EVALUATOR_ROLE(), evaluator));
        assertFalse(d.syndicateRegistry.hasRole(d.syndicateRegistry.COORDINATOR_ROLE(), deployer));
        assertTrue(d.arena.hasRole(d.arena.VERIFIER_ROLE(), verifier));
        assertFalse(d.arena.hasRole(d.arena.VERIFIER_ROLE(), deployer));
        assertFalse(d.jobEscrow.hasRole(d.jobEscrow.PAUSER_ROLE(), deployer));
    }

    function test_noAdminGivenKeepsDeployerAsAdmin() public {
        AgonProfileRegistry ownProfiles = new AgonProfileRegistry(deployer, address(new LocalAgentIdentity()));
        DeployAgonServiceRegistryV2 script = new DeployAgonServiceRegistryV2();
        (AgonServiceRegistryV2 registry,) = script.deploy(
            DEPLOYER_KEY,
            DeployAgonServiceRegistryV2.Config({
                admin: deployer,
                verifier: verifier,
                evaluator: evaluator,
                profileRegistry: address(ownProfiles),
                validationRegistry: address(validation)
            })
        );
        assertTrue(registry.hasRole(ADMIN_ROLE, deployer));
    }
}
