'use strict';

import dotenv from 'dotenv';
import {TelegramUserServiceV2} from './telegram/services/TelegramUserServiceV2';
import {SubscriberService} from './subscriber/service/SubscriberService';

dotenv.config();

// import { extractSolAddress } from './telegram/utils/addressExtractor';
// import { SolanaService } from './solana/services/SolanaService';
// import {DexscreenerService} from './dexscreener/services/DexscreenerService';
// import {IPair} from './dexscreener/services/IPair';
// // import { IRaydiumPrice, RaydiumService} from './dex/services/RaydiumService';
// // import {TokenAnalyze} from './analytics/services/TokenAnalyze';
// // import {IJupPrice, JupiterService} from './dex/services/JupiterService';
// import {BitQueryService} from './dex/services/BitQueryService';

// Example usage



// const setPriceToStorage = (message: IRaydiumPrice): void => {
// 	const data = message?.data;
//
// 	if (!data) {
// 		return;
// 	}
//
// 	Object.entries(data).forEach(([key, value]) => {
// 		TokenAnalyze.setCurrentPriceToToken(key, value)
// 	})
//
//
// 	console.log(TokenAnalyze.array)
// }
//
// const setPriceToStorageJup = (message: IJupPrice): void => {
// 	const data = message?.data;
//
// 	if (!data) {
// 		return;
// 	}
//
// 	Object.entries(data).forEach(([key, value]) => {
// 		TokenAnalyze.setCurrentPriceToToken(`jup::${key}`, value.price.toString())
// 	})
//
//
// 	console.log(TokenAnalyze.array)
// }

// const init = async () => {
// 	const message = 'this is sol address AnY3AsNqNHP2FKWUsjiBmYD2Hvc2yLAKRkPWgn5ipump';
// 	const solAddress = extractSolAddress(message);
//
// 	if (solAddress) {
// 		console.log('Extracted Solana Address:', solAddress);
// 		const solanaService = new SolanaService('https://api.mainnet-beta.solana.com');
// 		// solanaService.getTokenAccountsByOwner(solAddress);
//
// 		solanaService.getTokenInfo(solAddress);
//
// 		const pair = await DexscreenerService.getTokenPair(solAddress) as IPair
//
// 		// Fetching from Dexscreener
// 		console.log(pair);
//
// 		// RaydiumService.subscribeToTokenPrice([pair?.baseToken?.address],setPriceToStorage);
// 		// JupiterService.subscribeToTokenPrice([pair?.baseToken?.address],setPriceToStorageJup);
// 		BitQueryService.subscribeToToken(pair?.baseToken?.address);
// 	} else {
// 		console.log('No valid Solana address found in the message.');
// 	}
// }

const init = async () => {
	const telegramUserService = new TelegramUserServiceV2();



	try {
		await SubscriberService.initialization();
		await telegramUserService.start();

		// Add Telegram chat IDs to listen to
		telegramUserService.addChat(1234567890); // Replace with actual chat ID
		telegramUserService.addChat(9876543210); // Replace with actual chat ID

		// Start listening for updates
		await telegramUserService.start();

		console.log('Listening for new messages...');
	} catch (error) {
		console.error('Error:', error);
	}

}

init()
