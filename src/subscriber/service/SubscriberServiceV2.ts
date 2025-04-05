import * as Sentry from '@sentry/node';

import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';
import {
	isCurrentDateGreaterThanStartDate
} from '../utils/isCurrentDateGreaterThanEndDate';
import {SolanaService} from '../../solana/services/SolanaService';
import RaydiumSwap, {sleep} from '../../swap/service/RaydiumSwap';
import {SHOULD_SWAP, telegramUserService} from '../../index';
import {TelegramMessageInfo} from '../../telegram/services/TelegramUserServiceV2';
import {MessageParams, TelegramBotService} from '../../telegram/services/TelegramServices';

const processingAddresses = new Set();
const parsedAddresses = new Set();

export const percentDiffBetweenTwoNumbers = (first: number, second: number): number => {
	return ((first - second) / second) * 100
}


export class SubscriberServiceV2 {
	private static mongoDBInstance: MongoService
	private static maxPositiveROE: number;
	private static maxNegativeROE: number

	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE as string) || 15
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE as string) || 10) * -1;

		this.mongoDBInstance = new MongoService(2);
		await this.mongoDBInstance.connect();

		this.subscribeToActiveFromDB();
	}

	public static async subscribeToTokenV2(tokenAddress: string, {channelId, messageLink, isEdited}: TelegramMessageInfo) {
		if (parsedAddresses.has(tokenAddress)) {
			console.log('SubscriberServiceV2: We processing this address from TG', tokenAddress)
			return;
		}

		parsedAddresses.add(tokenAddress);

		console.time('Get token info from dex')

		const tokenInfo = await DexscreenerService.getTokenFromSearch(tokenAddress) as IPair;

		console.timeEnd('Get token info from dex')

		if (!tokenInfo) {
			parsedAddresses.delete(tokenAddress);
			return
		}


		if (processingAddresses.has(tokenInfo.pairAddress)) {
			Sentry.captureMessage(`SubscriberServiceV2: We processing this token ${tokenInfo.pairAddress}`);
			console.log('SubscriberServiceV2: We processing this token', tokenInfo.pairAddress, channelId)

			return;
		}

		processingAddresses.add(tokenInfo.pairAddress)
		parsedAddresses.delete(tokenAddress);

		console.time('Check token in finished collection')

		const tokenInfoFromFinishedCollection = await this.mongoDBInstance.getEntityFromFinishedCollection({
			'address': tokenInfo.pairAddress,
			parsedLink: channelId,
		})

		console.timeEnd('Check token in finished collection')

		if (tokenInfoFromFinishedCollection) {
			processingAddresses.delete(tokenInfo.pairAddress)

			Sentry.captureMessage(`SubscriberServiceV2: We have this combination in finished collection ${tokenInfo.pairAddress} ${channelId}`);
			console.log('SubscriberServiceV2: We have this combination in finished collection', tokenInfo.pairAddress, channelId)

			return;
		}

		console.time('Check token in wallet')

		const tokensAmount = tokenInfo.chainId === 'solana' ? await RaydiumSwap.getTokensAmountInWallet(tokenInfo.baseToken.address) : 0;

		console.timeEnd('Check token in wallet')

		let tokenInfoFromDB;

		if (tokensAmount < 1) {
			tokenInfoFromDB = await this.generateNewTokenData(tokenInfo, {channelId, messageLink, isEdited});

			if (tokenInfoFromDB) {

				if (SHOULD_SWAP) {
					console.time('Buy token')

					await telegramUserService.sendAddressToBot(tokenInfoFromDB.tokenAddress);

					console.timeEnd('Buy token')

					sendMessageToGroup(tokenInfoFromDB, '', false)
				}

				await this.putNewTokenToDB(tokenInfoFromDB)
			}
		}

		processingAddresses.delete(tokenInfo.pairAddress)

		if (tokensAmount >= 1) {
			console.log(`Now we have this token in wallet ${tokenInfo.baseToken.address}`)
		}
	}

	public static async subscribeToActiveFromDB() {
		const activeSubsInDB = await this.mongoDBInstance.getEntitiesByValue('status', 'InProgress')
		console.log('SubscriberServiceV2:', activeSubsInDB)
	}

	public static async putNewTokenToDB(data: Token) {
		try {
			await this.mongoDBInstance.createEntity({
				...data,
			});

			await this.mongoDBInstance.finishTokenSubscription('address', data.address)
		} catch (error) {
			Sentry.captureException({message: 'SubscriberServiceV2: Error when put new token to DB', error});
		}
	}

	public static async handlePriceChange(token: Token, price: number) {
		const roe = percentDiffBetweenTwoNumbers(price, token.initialPrice)

		const shouldBeFinished = roe > this.maxPositiveROE || roe < this.maxNegativeROE
			|| isCurrentDateGreaterThanStartDate(new Date(token.startDate), 20);

		await this.updateTokenPriceInDB(token, price, roe, shouldBeFinished)

		if (shouldBeFinished && SHOULD_SWAP) {
			await this.initiateSellTransaction(token)
		}

	}

	private static async initiateSellTransaction(token: Token, retries = 5) {
		const defaultSolBalances = {
			preBalance: 0,
			postBalance: 0
		};

		for (let i = 0; i < retries; i++) {
			const [txId] = await RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true);

			sendMessageToGroup(token, txId, true)

			await sleep(15000);

			const [txStatus, balances] = txId ? await RaydiumSwap.checkTransactionStatus(txId) : [false, defaultSolBalances];
			const tokensAmount = await RaydiumSwap.getTokensAmountInWallet(token.tokenAddress);

			if (txStatus) {
				const receivedAmount  = balances?.postBalance - balances?.preBalance;

				const realRoe = percentDiffBetweenTwoNumbers(receivedAmount, RaydiumSwap.buyTokenAmount);

				await this.updateRealRoeInFinishedCollection(token, realRoe)

				return;
			}

			if (!tokensAmount) {
				console.log('Not found token in wallet', token.tokenAddress);

				await this.updateRealRoeInFinishedCollection(token, 0)

				return
			}
		}

		await this.updateRealRoeInFinishedCollection(token, 0)
	}

	public static async updateTokenPriceInDB(token: Token, price: number, roe: number, shouldBeFinished: boolean) {
		if (shouldBeFinished) {
			console.log(`initial - ${token.initialPrice}, last - ${price}, roe - ${roe}`)
		}

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		await this.mongoDBInstance.updateEntity('address', token.address, {
			currentPrice: price,
			roe,
			lastUpdateDate: new Date(),
			...(shouldBeFinished ? {
				endDate: new Date(),
				status: 'Finished',
				soldPrice: price,
			} : {})
		})

		if (shouldBeFinished) {
			await SolanaService.unsubscribeFromPriceUpdates(token.address)
			await this.mongoDBInstance.finishTokenSubscription('address', token.address)
		}
	}

	private static async generateNewTokenData(tokenInfo: IPair, messageInfo: TelegramMessageInfo): Promise<Token | null> {
		return {
			address: tokenInfo.pairAddress,
			tokenAddress: tokenInfo.baseToken.address,
			name: tokenInfo.baseToken.symbol,
			initialPrice:  0,
			currentPrice: 0,
			startDate: new Date(),
			lastUpdateDate: new Date(),
			parsedLink: messageInfo.channelId,
			messageLink: messageInfo.messageLink,
			isEdited: messageInfo.isEdited,
			provider: `${tokenInfo.chainId}_${tokenInfo.dexId}`,
			status: 'InProgress',
		}
	}

	private static async updateRealRoeInFinishedCollection(token: Token, realRoe: number) {
		const entityFromFinished = await this.mongoDBInstance.getEntityFromFinishedCollection({
			address: token.address,
			parsedLink: token.parsedLink
		})

		if (entityFromFinished && !entityFromFinished.realRoe) {
			await this.mongoDBInstance.updateEntityInFinishedCollection({
				address: token.address,
				parsedLink: token.parsedLink
			},
			{
				realRoe: realRoe
			})
		}
	}


	public static async putIntoDBInfoMessage(isIncluded: boolean, hasTokenAddress: boolean): Promise<void> {
		await this.mongoDBInstance.insertTelegramMessageInfo(isIncluded, isIncluded && hasTokenAddress)
	}

	// public static async getCallToChannel(token: Token, tokenName: string): Promise<void> {
	// 	const isExists = await this.mongoDBInstance.checkIsCallExists({address: token.address})
	//
	// 	if (isExists) {
	// 		console.log('Call Exists')
	// 		return;
	// 	}
	//
	// 	this.mongoDBInstance.addCallToDB(token)
	// 	telegramUserService.sendMessageToCallChannel(token.name, tokenName, token.address)
	// }
}

export const sendMessageToGroup = async (token: Token, trxId: string | undefined, isSold: boolean): Promise<void> => {
	const params = {
		token: token.name,
		action: isSold ? 'sell' : 'buy',
		signalLink: token.messageLink,
		transactionLink: trxId ? `https://solscan.io/tx/${trxId}` : '',
		purchaseTime: token.startDate,
		chartLink: `https://dexscreener.com/solana/${token.address}?maker=${RaydiumSwap.walletAddress}`,
		isEdited: token.isEdited
	} as MessageParams

	TelegramBotService.sendTransactionMessage(params)
}
