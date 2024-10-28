import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolAddress} from '../utils/addressExtractor';

import { EditedMessageEvent} from 'telegram/events/EditedMessage';
import {SubscriberServiceV2} from '../../subscriber/service/SubscriberServiceV2';
// import {generateDetailedMemeTokenPromo} from '../../openai/utils/generateDetailedMemeTokenPromo';
import  {Cache, CacheClass} from 'memory-cache';
import long = Api.long;

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


		this.session = new StoreSession('my_session')
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
		// this.client.addEventHandler(this.editedMessageHandle.bind(this), new EditedMessage({}))
	}

	public async start(): Promise<void> {
		try {
			await this.connect();
			await this.handleUpdates()
			// this.callChannelEntity = await this.client.getEntity('SaulSignals')
		} catch (e) {
			console.log(e)
		}

	}

	public async eventHandle(event: NewMessageEvent) {
		const message = event.message;
		const peerChannel = (message?.peerId as PeerChannel);

		if (!peerChannel) {
			return;
		}

		const channelId = peerChannel.channelId?.toString() || '';

		const isChatAllowed = this.chatIds.has(channelId) && !this.bannedChatIds.has(channelId);

		SubscriberServiceV2.putIntoDBInfoMessage(isChatAllowed, !!extractSolAddress(message.message))

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
			const username = await this.getUsername(peerChannel);

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
		const peerChannel = (message?.peerId as PeerChannel);

		if (!peerChannel) {
			return;
		}

		const channelId = peerChannel.channelId?.toString() || '';

		const isChatAllowed = this.chatIds.has(channelId) && !this.bannedChatIds.has(channelId);

		SubscriberServiceV2.putIntoDBInfoMessage(isChatAllowed, !!extractSolAddress(message.message))

		if (isChatAllowed) {
			const editDateTimestamp = message.editDate;
			const originalDateTimestamp = message.date;

			if (!editDateTimestamp || !originalDateTimestamp) {
				return; // Ensure both dates are present
			}

			// Convert timestamps to Date objects
			const editDate = new Date(editDateTimestamp * 1000);
			const originalDate = new Date(originalDateTimestamp * 1000);

			// Calculate the difference in milliseconds
			const timeDifferenceInMilliseconds = editDate.getTime() - originalDate.getTime();

			// Check if the difference is less than 8 seconds (8888 milliseconds)
			if (timeDifferenceInMilliseconds < 8888) {
				const extractedData = extractSolAddress(message.message);

				if (!extractedData) {
					return;
				}

				if (this.processedAddresses.has(extractedData)) {
					console.log('Now we processed this address', extractedData)
					return;
				}

				const messageId = message.id;
				const username = await this.getUsername(peerChannel);

				// Handle based on whether it's a token or pair address
				await SubscriberServiceV2.subscribeToTokenV2(extractedData, {
					channelId,
					messageLink: `https://t.me/${username}/${messageId}`,
					isEdited: true
				});

				this.processedAddresses.delete(extractedData);
			}
		}
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
