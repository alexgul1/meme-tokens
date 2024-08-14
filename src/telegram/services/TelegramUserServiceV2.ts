/* eslint-disable */
// @ts-nocheck
import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolOrPairAddress} from '../utils/addressExtractor';

import {SubscriberService} from '../../subscriber/service/SubscriberService';
import {EditedMessage, EditedMessageEvent} from 'telegram/events/EditedMessage';
import long = Api.long;
import MessageEntityTextUrl = Api.MessageEntityTextUrl;
import Channel = Api.Channel;

export class TelegramUserServiceV2 {
	private client: TelegramClient;
	private readonly session: StoreSession;
	private readonly apiId: number;
	private readonly apiHash: string;
	private readonly chatIds: Set<string>;

	constructor() {
		this.apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		this.apiHash = process.env.TELEGRAM_API_HASH as string;
		this.chatIds = new Set()

		if (!this.apiId || !this.apiId) {
			throw new Error('Environment variables TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
		}

		// if (!this.chatIds.size) {
		// 	throw new Error('Environment variables TELEGRAM_CHANNELS_LIST must be set');
		// }

		console.log('SUBSCRIBED TO', this.chatIds)


		this.session = new StoreSession('my_session')
		this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {connectionRetries: 5})

	}

	public async connect(): Promise<void> {
		await this.client.start({
			phoneNumber: async () => await input.text('number ?'),
			password: async () => await input.text('password?'),
			phoneCode: async () => await input.text('Code ?'),
			onError: (err) => console.log(err),
		})
	}

	// eslint-disable-next-line
	private async handleUpdates() {
		this.client.addEventHandler(this.eventHandle.bind(this), new NewMessage({}))
		this.client.addEventHandler(this.editedMessageHandle.bind(this), new EditedMessage({}))

	}


	private async testMessagesFromChannel() {
		const chatIds = new Set<string>();
		const regex = /https:\/\/t\.me\/([^\/]+)\/(\d+)/;
		const targetMessages = 1000; // Total messages to fetch
		const batchSize = 10; // Number of messages to fetch per request
		let totalMessagesFetched = 0;

		// Define the channel link
		const channelLink = "https://t.me/CallAnalyserSol"; // Replace with your actual link

		// Retrieve the entity using the channel link
		const channelEntity = await this.client.getEntity(channelLink);



		while (totalMessagesFetched < targetMessages) {
			for await (const message of this.client.iterMessages(channelEntity, { limit: batchSize, addOffset: totalMessagesFetched})) {
				if (message?.entities) {
					const entity = message.entities.find((entity) => entity.className === 'MessageEntityTextUrl') as MessageEntityTextUrl;

					if (entity) {
						const channelRegexResult = entity.url.match(regex);
						const channelName = channelRegexResult?.[1];

						if (channelName) {
							console.log(totalMessagesFetched, channelName);


							try {
								const newChannelEntity = await this.client.getEntity(channelName) as Channel;

								try {
									// Join the public channel by username
									await this.client.invoke(
										new Api.channels.JoinChannel({
											channel: newChannelEntity.username,
										})
									);
									console.log(`Successfully joined the channel: ${newChannelEntity.username}`);
								} catch (error) {
									console.error(`Failed to join the channel: ${error}`);

									console.log(error)
								}
								chatIds.add(newChannelEntity.id.toString());
							} catch (error) {
								console.error(`Error retrieving entity for ${channelName}:`, error);
							}
						}
					}
				}

				totalMessagesFetched++;

				if (totalMessagesFetched >= targetMessages) {

					let string = '';

					chatIds.forEach(value => string += `${value},`)

					console.log("Collected Chat IDs:", string);
					return;
				}
			}
		}
		// Iterate over messages in the channel


		console.log("Finished fetching messages.");
	}
	public async start():Promise<void> {
		await this.connect();

		await this.testMessagesFromChannel();
		await this.handleUpdates()
	}

	public async eventHandle(event: NewMessageEvent) {
		const message = event.message;
		const channelId = (message?.peerId as PeerChannel)?.channelId?.toString() || '';

		if (this.chatIds.has(channelId)) {

			const extractedData = extractSolOrPairAddress(message.message);

			if (!extractedData) {
				return;
			}

			// Depending on whether it's a token or pair address, handle it appropriately
			if (extractedData.type === 'token') {
				await SubscriberService.subscribeToToken(extractedData.address, channelId);
			} else if (extractedData.type === 'pair') {
				// Handle the pair address if needed, or treat it the same as a token address
				await SubscriberService.subscribeToPair(extractedData.address, `${channelId}::pair`); // Example: different handling
			}
		}
	}

	public async editedMessageHandle(event: EditedMessageEvent) {
		const message = event.message;
		const channelId = (message?.peerId as PeerChannel)?.channelId?.toString() || '';

		if (this.chatIds.has(channelId)) {
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

			// Check if the difference is less than 3 minutes (180,000 milliseconds)
			if (timeDifferenceInMilliseconds < 180000) {
				const extractedData = extractSolOrPairAddress(message.message);

				if (!extractedData) {
					return;
				}

				// Handle based on whether it's a token or pair address
				if (extractedData.type === 'token') {
					await SubscriberService.subscribeToToken(extractedData.address, `${channelId}::edited`);
				} else if (extractedData.type === 'pair') {
					await SubscriberService.subscribeToPair(extractedData.address, `${channelId}::edited::pair`);
				}
			}
		}
	}
}
