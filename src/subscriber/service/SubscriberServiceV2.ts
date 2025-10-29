/* ============================================================================
 *  SubscriberServiceV2.ts  –  full version with the **same console logs**
 *  you had in the original Raydium‑only implementation, now supporting Pump.
 * ========================================================================== */

import * as Sentry from '@sentry/node';

import { MongoService } from '../../mongo/services/MongoService';
import { Token, TokenInfo } from '../../mongo/types/Token';
import { IPair } from '../../dexscreener/services/IPair';
import { ITokenPairs } from '../../dexscreener/services/ITokenPairs';
import { DexscreenerService } from '../../dexscreener/services/DexscreenerService';
import { isCurrentDateGreaterThanStartDate } from '../utils/isCurrentDateGreaterThanEndDate';

import { SolanaService } from '../../solana/services/SolanaService';
import { PumpSwapService } from '../../solana/services/PumpSwapTrackService';

import RaydiumSwap, { sleep } from '../../swap/service/RaydiumSwap';
import { SHOULD_SWAP, telegramUserService } from '../../index';
import { TelegramMessageInfo } from '../../telegram/services/TelegramUserServiceV2';
import { TelegramBotService, MessageParams } from '../../telegram/services/TelegramServices';
import {SolanaServiceV2} from '../../solana/services/SolanaServiceV2';

const processingAddresses = new Set<string>();

export class SubscriberServiceV2 {
	/* ───────── static fields ───────── */
	private static mongoDBInstance: MongoService;
	private static maxPositiveROE: number;
	private static maxNegativeROE: number;

	/* ───────── helpers ───────── */
	private static svc(dexId = '', labels?: string[]) {
		if ( dexId.toLowerCase().includes('pump')) {
			return PumpSwapService;
		}

		if (labels?.includes('CPMM')) {
			return SolanaServiceV2
		}
		return SolanaService;
	}
	private static svcKey(dexId = '', pair: string, mint: string) {
		return dexId.toLowerCase().includes('pump') ? mint : pair;
	}

	/* ───────── initialization ───────── */
	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE || '15');
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE || '10') * -1);

		this.mongoDBInstance = new MongoService(2);
		await this.mongoDBInstance.connect();

		console.log('SubscriberServiceV2: Mongo connected');

		this.subscribeToActiveFromDB();
	}

	/* ───────── Telegram trigger ───────── */
	public static async subscribeToTokenV2(addr: string, msg: TelegramMessageInfo) {
		const timerLabel = `Get token info from dex: ${addr}`;
		console.time(timerLabel);

		const tokenInfo = (await DexscreenerService.getTokenFromSearch(addr)) as IPair;
		const allPairs = await DexscreenerService.searchTokenByAddress(addr);
		console.log(addr, tokenInfo, msg);

		if (allPairs) this.setParsedTokenInfoToDB(allPairs, msg);
		console.timeEnd(timerLabel);
		if (!tokenInfo) return;

		if (processingAddresses.has(tokenInfo.pairAddress)) {
			Sentry.captureMessage(`SubscriberServiceV2: We processing this token ${tokenInfo.pairAddress}`);
			console.log('SubscriberServiceV2: We processing this token', tokenInfo.pairAddress, msg.channelId);
			return;
		}
		processingAddresses.add(tokenInfo.pairAddress);

		/* finished dupes */
		const finishedCheckLabel = `Check token in finished: ${tokenInfo.pairAddress}`;
		console.time(finishedCheckLabel);
		const finished = await this.mongoDBInstance.getEntityFromFinishedCollection({
			address: tokenInfo.pairAddress,
			parsedLink: msg.channelId,
		});
		console.timeEnd(finishedCheckLabel);
		if (finished) {
			processingAddresses.delete(tokenInfo.pairAddress);
			console.log('SubscriberServiceV2: We have this combination in finished collection', tokenInfo.pairAddress, msg.channelId);
			return;
		}

		/* current collection */
		const currentCheckLabel = `Check token in current: ${tokenInfo.pairAddress}`;
		console.time(currentCheckLabel);
		let doc = await this.mongoDBInstance.getEntity('address', tokenInfo.pairAddress);
		console.timeEnd(currentCheckLabel);

		if (!doc) {
			doc = await this.generateNewTokenData(tokenInfo, msg);
			if (doc) {
				let newPrice: number | null | undefined = null;

				if (SHOULD_SWAP) {
					const buyLabel = `Buy token: ${doc.tokenAddress}`;
					console.time(buyLabel);
					const [trx, price] = await RaydiumSwap.submitTransaction(doc.address, doc.tokenAddress, false);
					newPrice = price;
					console.timeEnd(buyLabel);
					sendMessageToGroup(doc, trx, false);
				}

				if (!newPrice) {
					if (!SHOULD_SWAP) await sleep(5000);
					newPrice = await this.svc(tokenInfo.dexId, tokenInfo.labels).getTokenPrice(this.svcKey(tokenInfo.dexId, doc.address, doc.tokenAddress));
				}

				doc.initialPrice = newPrice ?? 0;
				doc.currentPrice = newPrice ?? 0;

				this.putNewTokenToDB(doc);
			}
		}

		processingAddresses.delete(tokenInfo.pairAddress);

		if (doc) {
			console.log('SubscriberServiceV2: subscribe price updates', doc.address);
			this.svc(tokenInfo.dexId, tokenInfo.labels).subscribeToPriceUpdates(
				this.svcKey(tokenInfo.dexId, doc.address, doc.tokenAddress),
				(p) => this.handlePriceChange(doc!, p),
			);
		}
	}

	/* ───────── subscribe active from DB ───────── */
	private static async subscribeToActiveFromDB() {
		const active = await this.mongoDBInstance.getEntitiesByValue('status', 'InProgress');
		console.log('SubscriberServiceV2:', active);
		active.forEach((token) => {
			const [, dexId = ''] = (token.provider || '').split('_');
			this.svc(dexId, token.labels).subscribeToPriceUpdates(
				this.svcKey(dexId, token.address, token.tokenAddress),
				(p) => this.handlePriceChange(token, p),
			);
		});
	}

	/* ───────── handle price ───────── */
	public static async handlePriceChange(token: Token, price: number) {
		const roe = ((price - token.initialPrice) / token.initialPrice) * 100;

		const finish =
			roe > this.maxPositiveROE ||
			roe < this.maxNegativeROE ||
			isCurrentDateGreaterThanStartDate(new Date(token.startDate), 20);

		this.updateTokenPriceInDB(token, price, roe, finish);

		if (finish) console.log(`initial - ${token.initialPrice}, last - ${price}, roe - ${roe}`);

		if (finish && SHOULD_SWAP) {
			RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then(async ([trx]) => {
				sendMessageToGroup(token, trx, true);
				console.log('Sale of the remaining balance');
				await sleep(45000);
				RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then(([trx2]) => {
					sendMessageToGroup(token, trx2, true);
				});
			});
		}
	}

	/* ───────── DB update / finish ───────── */
	private static async updateTokenPriceInDB(token: Token, price: number, roe: number, finish: boolean) {
		await this.mongoDBInstance.updateEntity('address', token.address, {
			currentPrice: price,
			roe,
			lastUpdateDate: new Date(),
			...(finish ? { endDate: new Date(), status: 'Finished', soldPrice: price } : {}),
		} as Partial<TokenInfo>);

		if (finish) {
			const [, dexId = ''] = (token.provider || '').split('_');
			await this.svc(dexId, token.labels).unsubscribeFromPriceUpdates(this.svcKey(dexId, token.address, token.tokenAddress));
			await this.mongoDBInstance.finishTokenSubscription('address', token.address);
			console.log(`Unsubscribed from pool ${token.address}`);
		}
	}

	/* ───────── build new token doc ───────── */
	private static async generateNewTokenData(info: IPair, msg: TelegramMessageInfo): Promise<Token | null> {
		const key = this.svcKey(info.dexId, info.pairAddress, info.baseToken.address);
		const price = await this.svc(info.dexId, info.labels).getTokenPrice(key);
		if (!price) {
			Sentry.captureMessage(`SubscriberServiceV2: No price from service for ${info.pairAddress}`);
			console.log(`SubscriberServiceV2: No price from service for ${info.pairAddress}`);
			return null;
		}

		return {
			address: info.pairAddress,
			labels: info.labels,
			tokenAddress: info.baseToken.address,
			name: info.baseToken.symbol,
			initialPrice: price,
			currentPrice: price,
			startDate: new Date(),
			lastUpdateDate: new Date(),
			parsedLink: msg.channelId,
			messageLink: msg.messageLink,
			isEdited: msg.isEdited,
			provider: `${info.chainId}_${info.dexId}`,
			status: 'InProgress',
		};
	}

	/* ───────── misc unchanged helpers (logs inside) ───────── */
	private static async putNewTokenToDB(data: Token) {
		try {
			await this.mongoDBInstance.createEntity({ ...data });
			console.log('SubscriberServiceV2: New token inserted in DB', data.address);
		} catch (error) {
			Sentry.captureException({ message: 'DB insert error', error });
		}
	}

	public static async putIntoDBInfoMessage(isIncluded: boolean, hasAddr: boolean) {
		await this.mongoDBInstance.insertTelegramMessageInfo(isIncluded, isIncluded && hasAddr);
	}

	public static async getCallToChannel(token: Token, tokenName: string) {
		const exists = await this.mongoDBInstance.checkIsCallExists({ address: token.address });
		if (exists) {
			console.log('Call Exists');
			return;
		}
		this.mongoDBInstance.addCallToDB(token);
		telegramUserService.sendMessageToCallChannel(token.name, tokenName, token.address);
	}

	public static async setParsedTokenInfoToDB(pairs: ITokenPairs, msg: Partial<TelegramMessageInfo>) {
		const first = pairs?.pairs?.[0];
		if (!first) return;

		const present = await this.mongoDBInstance.getEntityFromTokensList({
			address: first.pairAddress,
			parsedLink: msg.channelId,
		});
		if (present) return;

		const doc = {
			address: first.pairAddress,
			tokenAddress: first.baseToken.address,
			name: first.baseToken.symbol,
			startDate: new Date(),
			parsedLink: msg.channelId,
			messageLink: msg.messageLink,
			isEdited: msg.isEdited,
			provider: `${first.chainId}_${first.dexId}`,
		} as TokenInfo;
		await this.mongoDBInstance.createEntityInTokensList(doc);
	}
}

/* ───────── helper for Telegram group ───────── */
export const sendMessageToGroup = async (token: Token, trxId: string | undefined, sold: boolean) => {
	const params = {
		token: token.name,
		action: sold ? 'sell' : 'buy',
		signalLink: token.messageLink,
		transactionLink: trxId ? `https://solscan.io/tx/${trxId}` : '',
		purchaseTime: token.startDate,
		chartLink: `https://dexscreener.com/solana/${token.address}?maker=73ErWrfKWaHXur3fsKyHxyC88DoBTVSM9j7bivJ3JPty`,
		isEdited: token.isEdited,
	} as MessageParams;
	TelegramBotService.sendTransactionMessage(params);
};
