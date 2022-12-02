require('dotenv').config();
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair, Fetcher } = require('@uniswap/sdk');
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);
const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

// specify the ABI and address of the smart contract to interact with
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
);

const AMOUNT_ETH = 100;         // adjust for optimal profit-slippage ratio
const RECENT_ETH_PRICE = 1850;  // most recent ether price
// pass AMOUNT_ETH as a string to avoid problems with very large numbers
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei((AMOUNT_ETH * RECENT_ETH_PRICE).toString());
const DIRECTION = {
  KYBER_TO_UNISWAP: 0,
  UNISWAP_TO_KYBER: 1
}
const init = async () => {
  // get chain network ID
  const networkId = await web3.eth.net.getId();
  // Uniswap exchanges ETH for WETH and uses that for trading
  const [dai, weth] = await Promise.all(
    [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
        Token.fetchData(
            ChainId.MAINNET,
            tokenAddress
        )
  )));
  // instantiate the trading pair
  const daiWeth = await Pair.fetchData(
    dai,
    weth
  );
  // all params must be in double quotes - single don't work
  web3.eth.subscribe("newBlockHeaders")
    .on("data", async block => {
  	   console.log(`New block received. Block # ${block.number}`);

       const kyberResults = await Promise.all([
         // get price of ether in DAI for the given AMOUNT_DAI_WEI
         kyber.methods.getExpectedRate(
           addresses.tokens.dai,
           '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // special kyber address for ether
           AMOUNT_DAI_WEI
         )
         .call(),
         kyber.methods.getExpectedRate(
           '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // special kyber address for ether
           addresses.tokens.dai,
           AMOUNT_ETH_WEI
          )
          .call()
       ]);

       // normalize kyber prices into decimals
       const kyberRates = {
         buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
         sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
       };

       console.log('Kyber ETH/DAI');
       console.log(kyberRates);

       const uniswapResults = await Promise.all([
         daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
         daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI))
       ]);

       // normalize Uniswap prices
       const uniswapRates = {
         buy: parseFloat(AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
         sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH),
       };

       console.log('Uniswap ETH/DAI');
       console.log(uniswapRates);

       // transaction costs
       const [tx1, tx2] = Object.keys(DIRECTION).map(direction => flashloan.methods.initiateFlashloan(
         addresses.dydx.solo,
         addresses.tokens.dai,
         AMOUNT_DAI_WEI,
         DIRECTION[direction]
       ));
       const [gasPrice, gasCost1, gasCost2] = await Promise.all([
         web3.eth.getGasPrice(),
         tx1.estimateGas({ from: admin }),
         tx2.estimateGas({ from: admin })
       ]);
       const txCost1 = parseInt(gasCost1) * parseInt(gasPrice);
       const txCost2 = parseInt(gasCost2) * parseInt(gasPrice);
       const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2;
       // profit1: buy kyber, sell uniswap
       const profit1 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (uniswapRates.sell - kyberRates.buy) - (txCost1 / 10 ** 18) * currentEthPrice;
       // profit2: buy uniswap, sell kyber
       const profit2 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (kyberRates.sell - uniswapRates.buy) - (txCost2 / 10 ** 18) * currentEthPrice;

       console.log(`Transaction cost ${(txCost / 10 ** 18) * currentEthPrice} DAI`)
       console.log(`Profit 1: buy K - sell U ${profit1} DAI`)
       console.log(`Profit 2: buy U - sell K ${profit2} DAI`)

       if(profit1 > 0) {
         console.log('Arbitrage opportunity found');
         console.log(`Buy ETH on Kyber at ${kyberRates.buy} DAI`);
         console.log(`and sell ETH on Uniswap at ${uniswapRates.sell} DAI`);
         console.log(`Expected profit: ${profit1} DAI`);
         const data = tx1.encodeABI();
         const txData = {
           from: admin,
           to: flashloan.options.address,
           data,
           gas: gasCost1,
           gasPrice
         };
         const receipt = await web3.eth.sendTransaction(txData);
         console.log(`Transaction hash: ${receipt.transactionHash}`);
       } else if(profit2 > 0) {
         console.log('Arbitrage opportunity found');
         console.log(`Buy ETH on Uniswap at ${uniswapRates.buy} DAI`);
         console.log(`and sell ETH on Kyber at ${kyberRates.sell} DAI`);
         console.log(`Expected profit: ${profit2} DAI`);
         const data = tx2.encodeABI();
         const txData = {
           from: admin,
           to: flashloan.options.address,
           data,
           gas: gasCost2,
           gasPrice
         };
         const receipt = await web3.eth.sendTransaction(txData);
         console.log(`Transaction hash: ${receipt.transactionHash}`);
       };
    })

    .on("error", error => {
  	   console.log(error);
    });
}
init();
