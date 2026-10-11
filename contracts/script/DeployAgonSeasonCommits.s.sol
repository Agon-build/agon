// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { AgonSeasonCommits } from "../src/AgonSeasonCommits.sol";

/// @notice Deploys the Season commit registry on Arc Testnet or Arc mainnet.
/// @dev Without --broadcast this is a preflight only.
contract DeployAgonSeasonCommits is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;

    function run() external returns (AgonSeasonCommits commits) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        require(
            block.chainid == ARC_TESTNET_CHAIN_ID || block.chainid == ARC_MAINNET_CHAIN_ID, "wrong deployment chain"
        );
        console2.log("Arc chain ID", block.chainid);
        console2.log("Deployer", vm.addr(key));
        vm.startBroadcast(key);
        commits = new AgonSeasonCommits();
        vm.stopBroadcast();
        console2.log("AgonSeasonCommits", address(commits));
    }
}
