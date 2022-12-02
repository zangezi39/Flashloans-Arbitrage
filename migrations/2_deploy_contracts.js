const Flashloan = artifacts.require("Flashloan");
const { mainnet: addresses } = require('../addresses'); // index.js

module.exports = function (deployer, _network, [beneficiaryAddress, _]) {
  deployer.deploy(
    Flashloan,
    addresses.kyber.kyberNetworkProxy,
    addresses.uniswap.router,
    addresses.tokens.weth,
    addresses.tokens.dai,
    beneficiaryAddress
  );
};
