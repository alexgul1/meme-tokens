import * as Sentry from '@sentry/node';

import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';
import { telegramUserService} from '../../index';
import {TelegramMessageInfo} from '../../telegram/services/TelegramUserServiceV2';
import {Api} from 'telegram';
import {TwitterService} from '../../twitter/TwitterService';

const processingAddresses = new Set();


export class SubscriberServiceV2 {
	private static mongoDBInstance: MongoService

	public static async initialization() {
		this.mongoDBInstance = new MongoService(2);
		await this.mongoDBInstance.connect();
	}

	public static async subscribeToTokenV2(tokenAddress: string, {
		channelId,
		messageLink,
		isEdited
	}: TelegramMessageInfo,
	message: Api.Message,
	shouldForward: boolean) {
		console.time('Get token info from dex')

		const tokenInfo = await DexscreenerService.getTokenFromSearch(tokenAddress) as IPair;

		console.timeEnd('Get token info from dex')

		if (!tokenInfo) {
			return
		}


		if (processingAddresses.has(tokenInfo.pairAddress)) {
			Sentry.captureMessage(`SubscriberServiceV2: We processing this token ${tokenInfo.pairAddress}`);
			console.log('SubscriberServiceV2: We processing this token', tokenInfo.pairAddress, channelId)

			return;
		}

		processingAddresses.add(tokenInfo.pairAddress)

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

		console.time('Check token in current collection')

		let tokenInfoFromDB = await this.mongoDBInstance.getEntity('address', tokenInfo.pairAddress);

		console.timeEnd('Check token in current collection')

		if (!tokenInfoFromDB) {
			tokenInfoFromDB = await this.generateNewTokenData(tokenInfo, {channelId, messageLink, isEdited});

			if (tokenInfoFromDB) {
				await this.putNewTokenToDB(tokenInfoFromDB)

				if (shouldForward) {
					const {result, tweetCount} = await TwitterService.getTokenMentions(tokenInfoFromDB.tokenAddress);

					await telegramUserService.forwardMessage(message, result)

					if (tweetCount > 10) {
						const postsTemplate = await TwitterService.getRecentTweets(tokenInfoFromDB.tokenAddress);

						await telegramUserService.sendAlertMentions(tokenInfoFromDB, result, postsTemplate);
					}
				}
			}
		}

		processingAddresses.delete(tokenInfo.pairAddress)

		if (tokenInfoFromDB) {
			// SolanaService.subscribeToPriceUpdates(tokenInfoFromDB.address, (price) => this.handlePriceChange(tokenInfoFromDB!, price))
			// this.getCallToChannel(tokenInfoFromDB, tokenInfo.baseToken.name)
		}
	}

	public static async putNewTokenToDB(data: Token) {
		try {
			await this.mongoDBInstance.createEntity({
				...data,
			});
		} catch (error) {
			Sentry.captureException({message: 'SubscriberServiceV2: Error when put new token to DB', error});
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
			provider: 'Solana',
			status: 'InProgress',
		}
	}

	public static async putIntoDBInfoMessage(isIncluded: boolean, hasTokenAddress: boolean): Promise<void> {
		await this.mongoDBInstance.insertTelegramMessageInfo(isIncluded, isIncluded && hasTokenAddress)
	}
}
