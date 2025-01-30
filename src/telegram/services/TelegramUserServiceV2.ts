import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolAddress} from '../utils/addressExtractor';

import {SubscriberServiceV2} from '../../subscriber/service/SubscriberServiceV2';
import {resolve} from 'path';
import  {Cache, CacheClass} from 'memory-cache';
import long = Api.long;

export type TelegramMessageInfo = {
	channelId: string,
	messageLink: string,
	isEdited?: boolean
}

console.log(resolve(__dirname, '../../images/saulSignal.jpeg'))


export class TelegramUserServiceV2 {
	private client: TelegramClient;
	private readonly session: StoreSession;
	private readonly apiId: number;
	private readonly apiHash: string;
	private readonly chatIds: Set<string>;
	private readonly bannedChatIds: Set<string>;
	private readonly processedAddresses: Set<string>;
	private readonly channelsIdToNameMap: CacheClass<long, string>
	private readonly forwardChatId: string;
	private readonly forwardTopicId: number;

	constructor() {
		this.apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		this.apiHash = process.env.TELEGRAM_API_HASH as string;
		this.chatIds = new Set((process.env.TELEGRAM_CHANNELS_LIST as string).split(','))
		this.bannedChatIds = new Set((process.env.TELEGRAM_BANNED_CHANNELS_LIST || '').split(','))
		this.forwardChatId = '-1002426306186';
		this.forwardTopicId = 3558

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
		await this.connect();
		await this.handleUpdates()
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
				isEdited: false,
			},
			message,
			channelId === '2212795949'
			);

			this.processedAddresses.delete(extractedData);
		}
	}

	public async forwardMessage(message: Api.Message, tokenMentions: string): Promise<void> {
		message.message += `\n\n${tokenMentions}`;

		console.log(message.message)

		await this.client.sendMessage(this.forwardChatId, {message: message, replyTo: this.forwardTopicId})
	}

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
