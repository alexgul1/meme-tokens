import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolAddress} from '../utils/addressExtractor';

import {EditedMessage, EditedMessageEvent} from 'telegram/events/EditedMessage';
import {SubscriberServiceV2} from '../../subscriber/service/SubscriberServiceV2';
// import {generateDetailedMemeTokenPromo} from '../../openai/utils/generateDetailedMemeTokenPromo';
import  {Cache, CacheClass} from 'memory-cache';
import long = Api.long;
import {Entity} from 'telegram/define';
import PeerUser = Api.PeerUser;

export type TelegramMessageInfo = {
	channelId: string,
	messageLink: string,
	isEdited?: boolean
}


export class TelegramUserServiceV2 {
	private client: TelegramClient;
	private readonly session: StoreSession;
	private readonly apiId: number;
	private readonly apiHash: string;
	private readonly chatIds: Set<string>;
	private readonly bannedChatIds: Set<string>;
	private readonly processedAddresses: Set<string>;
	// private callChannelEntity: Entity;
	// private callChannelEntity: any;
	private maestroBotEntity!: Entity;
	private memeTokensChannel!: Entity;

	private readonly channelsIdToNameMap: CacheClass<long, string>

	constructor() {
		this.apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		this.apiHash = process.env.TELEGRAM_API_HASH as string;
		this.chatIds = new Set((process.env.TELEGRAM_CHANNELS_LIST as string).split(','))
		this.bannedChatIds = new Set((process.env.TELEGRAM_BANNED_CHANNELS_LIST || '').split(','))

		if (!this.apiId || !this.apiId) {
			throw new Error('Environment variables TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
		}

		if (!this.chatIds.size) {
			throw new Error('Environment variables TELEGRAM_CHANNELS_LIST must be set');
		}

		console.log('SUBSCRIBED TO', this.chatIds)
		console.log('BANNED IDS', this.bannedChatIds)

		this.processedAddresses = new Set();


		this.session = new StoreSession(`my_session_${this.apiId}`)
		this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {connectionRetries: 5})

		this.channelsIdToNameMap = new Cache();
	}

	public async connect(): Promise<void> {
		await this.client.start({
			phoneNumber: async () => await input.text('number ?'),
			password: async () => await input.text('password?'),
			phoneCode: async () => await input.text('Code ?'),
			onError: (err) => console.log(err),
		})
	}

	private async handleUpdates() {
		this.client.addEventHandler(this.eventHandle.bind(this), new NewMessage({}))
		this.client.addEventHandler(this.editedMessageHandle.bind(this), new EditedMessage({}))
	}

	public async start(): Promise<void> {
		try {
			await this.connect();
			await this.handleUpdates()
			this.maestroBotEntity = await this.client.getEntity('MaestroSniperBot');
			this.memeTokensChannel = await this.client.getEntity('-1002367498352');

			// this.callChannelEntity = await this.client.getEntity('SaulSignals')
		} catch (e) {
			console.log(e)
		}

	}

	public async eventHandle(event: NewMessageEvent) {
		const message = event.message;
		const peerChannel = (message?.peerId as PeerChannel | PeerUser);

		if (!peerChannel) {
			return;
		}

		const isMaestroId = ((peerChannel as PeerUser).userId?.toString() || '') === this.maestroBotEntity.id?.toString();

		const channelId = (peerChannel as PeerChannel).channelId?.toString() || '';

		const isChatAllowed = this.chatIds.has(channelId) && !this.bannedChatIds.has(channelId);

		SubscriberServiceV2.putIntoDBInfoMessage(isChatAllowed, !!extractSolAddress(message.message))

		if (isMaestroId) {
			console.log(message.message)
			if (message.message.includes('Trade on Maestro')) {
				await message.forwardTo(this.memeTokensChannel)
			}
		}

		if (isChatAllowed) {
			const extractedData = extractSolAddress(message.message);

			if (!extractedData) {
				return;
			}

			if (this.processedAddresses.has(extractedData)) {
				console.log('Now we processed this address', extractedData);
				return
			}

			this.processedAddresses.add(extractedData);

			const messageId = message.id;
			const username = await this.getUsername(peerChannel as PeerChannel);

			await SubscriberServiceV2.subscribeToTokenV2(extractedData, {
				channelId,
				messageLink: `https://t.me/${username}/${messageId}`,
				isEdited: false
			});

			this.processedAddresses.delete(extractedData);
		}
	}

	public async editedMessageHandle(event: EditedMessageEvent) {
		const message = event.message;
		const peerChannel = (message?.peerId as PeerChannel | PeerUser);

		if (!peerChannel) {
			return;
		}

		const isMaestroId = ((peerChannel as PeerUser).userId?.toString() || '') === this.maestroBotEntity.id?.toString();

		if (isMaestroId) {
			console.log('edited', message.message)
			if (message.message.includes('You gained')) {
				await message.forwardTo(this.memeTokensChannel)
			}
		}
	}

	public async sendAddressToBot(address: string) {
		await this.client.sendMessage(this.maestroBotEntity, {
			message: address
		})
	}

	// 	public async sendMessageToCallChannel(ticker: string, tokenName:string, ca: string) {
	// 		const promoText = await generateDetailedMemeTokenPromo(ticker, tokenName) || 'aped some **$${ticker}**. Be safe with entries.'
	//
	// 		const messageText = `🔥 (SOL) **$${ticker}**
	// Saul Signals\n
	// ${promoText}\n
	// **CA:** \`${ca}\`\n
	// https://dexscreener.com/solana/${ca}\n
	// @SaulSignals
	//     `;
	//
	// 		await this.client.sendMessage(this.callChannelEntity,{
	// 			message: messageText,
	// 			file:resolve(__dirname, '../../images/saulSignal.jpeg'),
	// 		});
	//
	// 	}

	private async getUsername(peerChannel: PeerChannel): Promise<string> {
		const usernameInCache = this.channelsIdToNameMap.get(peerChannel.channelId)

		if (usernameInCache) {
			return usernameInCache;
		}

		const channel = await this.client.getEntity(peerChannel) as Api.Channel;

		if (channel.username != null) {
			this.channelsIdToNameMap.put(peerChannel.channelId, channel.username)
		}

		return channel.username || '';
	}
}
